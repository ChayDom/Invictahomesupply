/** Read-only observation, never an orchestrator or repair job. */
const INVICTA_HEALTH_HANDLERS_ = ['runProductCatalogMaintenance','syncWebsiteExportToAirtable',
  'runCatalogEnrichment','runDailySocialPreparation','sendReadySocialPostsToBuffer'];
const INVICTA_HEALTH_ALERT_HANDLER_ = 'runInvictaProductionHealthCheckAndAlert';
const INVICTA_HEALTH_K2_ = '=MAP(I2:I,J2:J,LAMBDA(sqft,price,IF(OR(sqft="",price=""),"",LET(x,sqft*price,w,INT(x),d,x-w,IF(d=0,w,IF(d<0.75,w+0.5,w+1))))))';
const INVICTA_HEALTH_EXPORT_HEADERS_ = ['PRODUCT KEY','DISPLAY NAME','CATEGORY','BRAND','MODEL','RETAIL SKU','RETAILER',
  'QUANTITY AVAILABLE','UNIT TYPE','SQ FT PER UNIT','AVAILABLE SQ FT','WEBSITE PRICE','DESCRIPTION','HIGHLIGHTS',
  'PRODUCT URL','STOCK IMAGE URL','POST TO WEBSITE','ENRICHMENT STATUS','IN STOCK','COMPARABLE RETAIL PRICE','BOX PRICE',
  'SUBCATEGORY','THICKNESS MM','WEAR LAYER MIL','UNDERLAYMENT ATTACHED','WATER RESISTANCE','CARD SPEC 1','CARD SPEC 2','CARD SPEC 3'];

function runInvictaProductionHealthCheck() {
  const now = Date.now(), ss = SpreadsheetApp.getActiveSpreadsheet(), props = PropertiesService.getScriptProperties();
  const result = {status:'GREEN',checkedAt:new Date(now).toISOString(),summary:{checksPassed:0,warnings:0,failures:0},sections:{}};
  const issue = function(section,severity,code,detail) {
    const entry = result.sections[section] || (result.sections[section] = {issues:[]});
    entry.issues.push({severity:severity,code:code,detail:detail || ''});
    result.summary[severity === 'FAIL' ? 'failures' : 'warnings']++;
  };
  // Never return exception text, API responses, property values, URLs or tokens.
  const check = function(section,fn) {
    result.sections[section] = {issues:[]};
    try { fn(result.sections[section]); result.summary.checksPassed++; }
    catch (_) { issue(section,'FAIL','READ_OR_VALIDATION_FAILED','Inspect this section with its existing read-only audit.'); }
  };
  let triggers = [], catalog, exported, archive, evidence, remote = new Map(), stocks = new Map(), active = new Map(), exportKeys = new Map(), retired = new Set();
  check('triggers',function(s) {
    triggers = ScriptApp.getProjectTriggers();
    const counts = {}; triggers.forEach(function(t) {
      const handler = t.getHandlerFunction(); counts[handler] = (counts[handler] || 0) + 1;
      if (String(t.getEventType()) !== 'CLOCK') issue('triggers','FAIL','NON_CLOCK_TRIGGER',handler);
      if (!INVICTA_HEALTH_HANDLERS_.includes(handler) && handler !== INVICTA_HEALTH_ALERT_HANDLER_) issue('triggers','FAIL','UNEXPECTED_TRIGGER',handler);
    });
    INVICTA_HEALTH_HANDLERS_.concat(INVICTA_HEALTH_ALERT_HANDLER_).forEach(function(handler) {
      const n = counts[handler] || 0;
      if (n !== 1) issue('triggers',handler === INVICTA_HEALTH_ALERT_HANDLER_ && n === 0 ? 'WARNING' : 'FAIL',n ? 'DUPLICATE_TRIGGER' : 'MISSING_TRIGGER',handler);
    });
    s.handlers = counts; s.ownerScope = 'Current execution owner; Apps Script cannot enumerate other owners';
    s.timezone = Session.getScriptTimeZone();
    if (s.timezone !== 'America/Chicago') issue('triggers','FAIL','TIMEZONE_DRIFT','Expected America/Chicago');
    s.timing = {verification:'NOT_EXPOSED_BY_TRIGGER_API; inspect native trigger settings',
      intent:{runProductCatalogMaintenance:'every 6 hours',syncWebsiteExportToAirtable:'existing approved cadence',
        runCatalogEnrichment:'existing approved cadence',runDailySocialPreparation:'daily 6–7 AM America/Chicago',
        sendReadySocialPostsToBuffer:'daily 9–10 AM America/Chicago',runInvictaProductionHealthCheckAndAlert:'daily 7–8 AM America/Chicago'}};
  });
  check('properties',function(s) {
    s.presence = {};
    ['AIRTABLE_TOKEN','AIRTABLE_BASE_ID','AIRTABLE_ENVIRONMENT','AIRTABLE_WORKBOOK_ID','GEMINI_API_KEY','BUFFER_API_KEY',
      'BUFFER_ORGANIZATION_ID','BUFFER_FACEBOOK_CHANNEL_ID','BUFFER_INSTAGRAM_CHANNEL_ID','CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','SOCIAL_REVIEW_EMAIL'].forEach(function(name) {
      const present = !!String(props.getProperty(name) || '').trim(); s.presence[name] = present ? 'PRESENT' : 'MISSING';
      if (!present) issue('properties','FAIL','MISSING_PROPERTY',name);
    });
    ['CATALOG_LIFECYCLE_CLEANUP_ENABLED','SOCIAL_PUBLISHING_ENABLED'].forEach(function(name) {
      s.presence[name] = props.getProperty(name) === 'true' ? 'EXPECTED_TRUE' : 'NOT_EXPECTED_TRUE';
      if (s.presence[name] !== 'EXPECTED_TRUE') issue('properties','FAIL','BOOLEAN_CONTRACT',name);
    });
    if (iwaApprovedConfiguration_().environment !== 'production') issue('properties','FAIL','NOT_PRODUCTION_CONFIGURATION');
  });
  check('sourceEvidence',function(s) {
    evidence = indexCatalogSourceEvidence_(readCatalogSourceEvidence_(ss)); s.rows = evidence.rows.length;
  });
  check('catalog',function(s) {
    const sheet = getInventorySheetOrThrow_(ss,INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET); getCatalogColumns_(sheet);
    if (sheet.getRange(2,11).getFormula() !== INVICTA_HEALTH_K2_) issue('catalog','FAIL','K2_CHANGED');
    catalog = readSheetTable_(sheet,'PRODUCT KEY');
    catalogIdentityFindings_(catalog.rows,catalog.map).forEach(function(f) { issue('catalog','FAIL',f.type,(f.key || '') + ' rows ' + f.rows.join(',')); });
    catalog.rows.forEach(function(row,i) {
      const rawKey = row[catalog.map['PRODUCT KEY']];
      if (rawKey !== '' && rawKey != null && typeof rawKey !== 'string') issue('catalog','FAIL','NON_TEXT_PRODUCT_KEY','Product Catalog row ' + (i+2));
      const key = normalizeKey_(row[catalog.map['PRODUCT KEY']]); if (!key) return;
      active.set(key,row);
      if (!evidence) throw new Error('Source read failed');
      const stock = catalogConfirmedStock_(ss,function(h) { return row[catalog.map[h]]; },evidence); stocks.set(key,stock);
      if (stock.state === 'CONFIRMED ZERO') issue('catalog','FAIL','ACTIVE_CONFIRMED_ZERO',key);
    });
    s.active = active.size;
  });
  check('export',function(s) {
    exported = readSheetTable_(getInventorySheetOrThrow_(ss,IWA_SYNC_HARDENED.EXPORT_SHEET),'PRODUCT KEY');
    requireHeaders_(exported.map,INVICTA_HEALTH_EXPORT_HEADERS_,'Website Export');
    if (Object.keys(exported.map).length !== 29) throw new Error('Wrong schema');
    exported.rows.forEach(function(row) {
      const key = normalizeKey_(row[exported.map['PRODUCT KEY']]);
      if (!key) { if (row.some(function(v) { return v !== '' && v != null; })) issue('export','FAIL','MISSING_PRODUCT_KEY'); return; }
      if (exportKeys.has(key)) issue('export','FAIL','DUPLICATE_PRODUCT_KEY',key); exportKeys.set(key,row);
      const stock = stocks.get(key);
      if (!active.has(key)) issue('export','FAIL','ORPHAN_ACTIVE_EXPORT',key);
      if (stock && stock.state === 'CONFIRMED ZERO') issue('export','FAIL',socialTruthy_(row[exported.map['IN STOCK']]) ? 'TRUE_STOCK_WITH_ZERO_SOURCE' : 'CONFIRMED_ZERO_EXPORT',key);
    });
    active.forEach(function(_,key) { if (!exportKeys.has(key)) issue('export','FAIL','ACTIVE_KEY_MISSING_EXPORT',key); }); s.active = exportKeys.size;
  });
  check('airtable',function(s) {
    iwaApprovedConfiguration_();
    const records = iwaFetchAll_(props.getProperty('AIRTABLE_TOKEN'),['Product Key','Name','Category','Quantity Available',
      'Available Sq Ft','Status','Post to Website','Sold Out Since','Photos','Price','Price Basis','Unit Type','Card Spec 1','Card Spec 2','Card Spec 3']);
    if (!Array.isArray(records)) throw new Error('Incomplete Airtable read');
    records.forEach(function(record) {
      const key = normalizeKey_(record.fields['Product Key']);
      if (!key || remote.has(key)) issue('airtable','FAIL','MISSING_OR_DUPLICATE_PRODUCT_KEY',key); remote.set(key,record);
      const f = record.fields, state = socialSelectText_(f.Status), stock = stocks.get(key);
      if (state === 'Sold Out' && typeof f['Quantity Available'] === 'number' && f['Quantity Available'] > 0) issue('airtable','FAIL','SOLD_OUT_WITH_POSITIVE_QUANTITY',key);
      if (stock && stock.state === 'UNKNOWN' && socialAirtableEligible_(f)) issue('airtable','WARNING','REMOTE_STOCK_NEEDS_SOURCE_REVIEW',key);
      if (stock && stock.state === 'CONFIRMED ZERO' && socialAirtableEligible_(f)) issue('airtable','FAIL','REMOTE_POSITIVE_WITH_ZERO_SOURCE',key);
    });
    if (!records.length && active.size) throw new Error('Unexpected empty remote'); s.records = records.length; s.readable = true;
  });
  check('lifecycle',function(s) {
    getInventorySheetOrThrow_(ss,CATALOG_ARCHIVE_SHEET_); archive = readCatalogArchive_(ss);
    s.confirmedPositive = 0; s.confirmedZero = 0; s.unknown = 0; s.pendingRetention = 0; s.eligibleDay10Cleanup = 0;
    s.journalStates = {RETIRING:0,ARCHIVED:0,'AIRTABLE REMOVED':0,COMPLETE:0,CANCELLED:0};
    stocks.forEach(function(stock) { s[stock.state === 'IN STOCK' ? 'confirmedPositive' : stock.state === 'CONFIRMED ZERO' ? 'confirmedZero' : 'unknown']++; });
    const archivedKeys = new Set();
    archive.rows.forEach(function(row) {
      const m = archive.map, key = normalizeKey_(row[m['PRODUCT KEY']]); if (!key) return;
      archivedKeys.add(key); const state = row[m['CLEANUP STATE']]; s.journalStates[state]++;
      if (state !== 'CANCELLED') retired.add(key);
      if (['COMPLETE','ARCHIVED','AIRTABLE REMOVED'].includes(state) && active.has(key)) issue('lifecycle','FAIL','RETIRED_KEY_ACTIVE_AGAIN',key);
      if (['COMPLETE','CANCELLED'].includes(state)) return;
      const stock = catalogArchivedStock_(ss,function(h) { return row[m[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; },row,m,evidence);
      const since = Date.parse(catalogArchiveValue_(row[m['SOLD OUT SINCE']])), elapsed = now - since;
      const record = remote.get(key), f = record && record.fields;
      const remoteMatches = !record ? !row[m['AIRTABLE RECORD ID']] || state !== 'RETIRING' :
        record.id === row[m['AIRTABLE RECORD ID']] && f['Sold Out Since'] === catalogArchiveValue_(row[m['SOLD OUT SINCE']]) &&
        catalogLifecycleStock_(row[m.CATEGORY] === 'Flooring' ? f['Available Sq Ft'] : undefined,f['Quantity Available']) === 0 && socialSelectText_(f.Status) === 'Sold Out';
      if (!Number.isFinite(since) || !remoteMatches) issue('lifecycle','FAIL','REMOTE_IDENTITY_OR_TIMER_MISMATCH',key);
      if (stock.state === 'UNKNOWN') issue('lifecycle','WARNING','RETIRED_SOURCE_REQUIRES_MANUAL_REVIEW',key);
      if (elapsed < CATALOG_RETENTION_MS_) s.pendingRetention++;
      if (stock.state === 'CONFIRMED ZERO' && Number.isFinite(since) && elapsed >= CATALOG_RETENTION_MS_ && remoteMatches &&
          !active.has(key) && !exportKeys.has(key) && ['ARCHIVED','AIRTABLE REMOVED'].includes(state)) s.eligibleDay10Cleanup++;
      const age = now - Date.parse(catalogArchiveValue_(row[m['ARCHIVED AT']]));
      if (state !== 'ARCHIVED' && age > 86400000 || state === 'ARCHIVED' && elapsed > CATALOG_RETENTION_MS_ + 86400000) issue('lifecycle','WARNING','STUCK_JOURNAL',key + ' ' + state);
    });
    remote.forEach(function(record,key) {
      if (!active.has(key) && record.fields['Post to Website'] === true && !archivedKeys.has(key)) issue('airtable','FAIL','PUBLISHED_WITHOUT_ACTIVE_OR_ARCHIVED_LIFECYCLE',key);
      const a = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
      if (a && a[archive.map['CLEANUP STATE']] === 'COMPLETE') issue('lifecycle','FAIL','COMPLETE_ARCHIVE_REMOTE_REAPPEARED',key);
    });
    s.incompleteJournals = s.journalStates.RETIRING + s.journalStates.ARCHIVED + s.journalStates['AIRTABLE REMOVED'];
  });
  let queue, rows = [], latestGenerated = 0, latestPosted = 0, eligibleCaptions = 0;
  check('socialQueue',function(s) {
    queue = getSocialQueueSheetOrThrow_(ss); assertSocialQueueHeaders_(queue); rows = evergreenQueueRows_(queue);
    s.counts = {Draft:0,Ready:0,Queued:0,'Needs Image':0,'Needs Copy':0,Skip:0,Error:0}; s.productRows = 0; s.evergreenRows = 0;
    const sources = readSocialExportMap_(getInventorySheetOrThrow_(ss,IWA_SYNC_HARDENED.EXPORT_SHEET));
    const library = evergreenReadLibrary_(), seen = new Set();
    rows.forEach(function(row,i) {
      const key = String(row[0] || '').trim(); if (!key) return;
      if (seen.has(key)) issue('socialQueue','FAIL','DUPLICATE_OCCURRENCE',key); seen.add(key);
      const status = String(row[12]).trim(); if (s.counts[status] !== undefined) s.counts[status]++; else issue('socialQueue','WARNING','UNKNOWN_STATUS',key);
      const posted = row[15] ? new Date(row[15]).getTime() : 0;
      // LAST POSTED AT is an accepted hand-off timestamp, not proof of public delivery.
      if (row[13] || row[14]) latestPosted = Math.max(latestPosted,Number.isFinite(posted) ? posted : 0);
      if (status === 'Queued' && !(row[13] || row[14])) issue('socialQueue','WARNING','QUEUED_WITHOUT_RECEIPT',key);
      if (status === 'Queued' && (row[13] || row[14]) && (!posted || !Number.isFinite(posted))) issue('socialQueue','WARNING','RECEIPT_TIMESTAMP_MISSING',key);
      const evergreen = evergreenIdentity_(key);
      if (key.startsWith('EVERGREEN|') && !evergreen) issue('socialQueue','FAIL','INVALID_EVERGREEN_IDENTITY');
      // Collect totals/timestamps before per-row validation; a bad approval must
      // not truncate subsequent observations or hide recent draft generation.
      if (evergreen) s.evergreenRows++;
      else {
        s.productRows++;
        const generated = row[16] ? new Date(row[16]).getTime() : 0;
        latestGenerated = Math.max(latestGenerated,Number.isFinite(generated) ? generated : 0);
        if (generated > now) issue('socialQueue','WARNING','FUTURE_PRODUCT_GENERATION_TIMESTAMP',key);
      }
      try {
      if (evergreen) {
        const item = library.find(function(item) { return item.id === evergreen.id; });
        if (!item || item.type !== row[7]) issue('socialQueue','FAIL','INVALID_EVERGREEN_SOURCE',key);
        if (status === 'Ready') {
          const plan = item && evergreenPlan_(item,evergreen.occurrence);
          if (!item || item.status !== 'Enabled' || row[5] !== 'Image' || row[11] !== '' || row[9] !== item.caption || row[10] !== item.caption ||
              row[17] !== plan.sourceHash || JSON.stringify(socialReadMediaPlan_(queue,i+2)) !== JSON.stringify(plan)) issue('socialQueue','FAIL','STALE_EVERGREEN_APPROVAL',key);
        }
        return;
      }
      const source = sources.get(key), stock = stocks.get(normalizeKey_(key)), record = remote.get(normalizeKey_(key));
      let eligible = !!source && source.eligible && !!stock && stock.state === 'IN STOCK' && stock.quantity > 0 &&
        !!record && socialAirtableEligible_(record.fields) && socialTruthy_(active.get(normalizeKey_(key))[catalog.map['POST TO WEBSITE']]);
      if (source && record) {
        source.photos = []; try { source.photos = socialPhotos_(record.fields); source.renderFacts = socialRenderFacts_(record.fields); } catch (_) { eligible = false; }
      }
      eligible = eligible && source.photos.length > 0 && !SOCIAL_HISTORY_HOLDS_.includes(key);
      if ((retired.has(normalizeKey_(key)) || stock && stock.state === 'CONFIRMED ZERO') && status !== 'Skip' && status !== 'Queued') issue('socialQueue','FAIL','ACTIONABLE_SOLD_OUT_PRODUCT',key);
      if (status === 'Ready') {
        if (!eligible) issue('socialQueue','FAIL','INELIGIBLE_READY_PRODUCT',key);
        else {
          const plan = socialReadMediaPlan_(queue,i+2);
          if (!String(row[9]).trim() || !String(row[10]).trim() ||
              row[5] !== (plan.type === 'Reel' ? 'Video' : 'Image') || row[7] !== (plan.type === 'Reel' ? 'Reel' : 'Post') ||
              JSON.stringify(plan) !== JSON.stringify(socialMediaPlan_(source,plan.type === 'Reel')) || row[17] !== buildSocialSourceHash_(source)) issue('socialQueue','FAIL','STALE_PRODUCT_APPROVAL',key);
        }
      }
      if (eligible && !socialQueueHistory_(queue,i+2,row) && (status === 'Needs Copy' || status === 'Draft' && !String(row[9]).trim() && !String(row[10]).trim())) eligibleCaptions++;
      } catch (_) {
        issue('socialQueue','FAIL',status === 'Ready' ? 'READY_VALIDATION_FAILED' : 'ROW_VALIDATION_FAILED',key + ' row ' + (i+2));
      }
    });
  });
  check('socialPreparation',function(s) {
    s.latestProductGeneratedAt = latestGenerated ? new Date(latestGenerated).toISOString() : null;
    s.hoursSinceProductGeneration = latestGenerated ? (now - latestGenerated)/3600000 : null;
    s.eligibleCaptionRows = eligibleCaptions; s.triggerPresent = triggers.some(function(t) { return t.getHandlerFunction() === 'runDailySocialPreparation'; });
    s.reviewEmailPresent = !!props.getProperty('SOCIAL_REVIEW_EMAIL'); s.emailHelperAvailable = typeof sendSocialReviewEmail_ === 'function' && typeof runDailySocialPreparation === 'function';
    s.emailDeliveryVerified = false; // Product timestamps cannot prove MailApp delivery or no-op preparation runs.
    if (eligibleCaptions && (!latestGenerated || now - latestGenerated > 72*3600000)) issue('socialPreparation','WARNING','STALE_PRODUCT_DRAFT_GENERATION','Eligible caption rows: ' + eligibleCaptions);
    if (!s.emailHelperAvailable) issue('socialPreparation','FAIL','EMAIL_PATH_UNAVAILABLE');
  });
  check('socialPublishing',function(s) {
    s.triggerPresent = triggers.some(function(t) { return t.getHandlerFunction() === 'sendReadySocialPostsToBuffer'; });
    s.latestReceiptedHandoffAt = latestPosted ? new Date(latestPosted).toISOString() : null; s.publicDeliveryVerified = false;
    s.ready = rows.filter(function(row) { return row[12] === 'Ready'; }).length;
    s.gate48HoursBlocked = hasSocialPostQueuedWithinHours_(48);
    const connection = bufferGraphql_(props.getProperty('BUFFER_API_KEY'),'query InvictaHealth { account { id } }',{});
    if (!connection.account || !connection.account.id) throw new Error('Buffer unreadable'); s.bufferReadable = true;
    s.historicalQueuedAreNotRemotePending = true;
  });
  check('website',function(s) {
    const response = UrlFetchApp.fetch('https://invictahomesupply.com/api/inventory',{method:'get',muteHttpExceptions:true});
    if (response.getResponseCode() !== 200) throw new Error('Endpoint unavailable');
    const data = JSON.parse(response.getContentText());
    if (!Array.isArray(data.records) || data.records.some(function(r) { return !r.fields || !r.fields['Product Key']; })) throw new Error('Malformed public inventory');
    s.readable = true; s.publicRecords = data.records.length;
  });
  result.status = result.summary.failures ? 'FAIL' : result.summary.warnings ? 'WARNING' : 'GREEN';
  result.summary.checksPassed = Object.values(result.sections).filter(function(s) { return !s.issues.length; }).length;
  result.elapsedMs = Date.now() - now;
  console.log(JSON.stringify(result)); return result;
}

/** Only this wrapper may send health alerts; no business writes/property state. */
function runInvictaProductionHealthCheckAndAlert() {
  const result = runInvictaProductionHealthCheck();
  if (result.status === 'GREEN') return result;
  const email = PropertiesService.getScriptProperties().getProperty('SOCIAL_REVIEW_EMAIL');
  if (!email) return result; // Already reported as a failure; no alternate recipient.
  const findings = Object.keys(result.sections).flatMap(function(name) {
    return result.sections[name].issues.map(function(issue) { return name + ': ' + issue.severity + ' ' + issue.code + (issue.detail ? ' — ' + issue.detail : ''); });
  }).sort();
  const id = socialOperationKey_(['health-alert-v1',result.status,findings]), cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock(); if (!lock.tryLock(1000)) return result;
  try {
    if (cache.get(id)) return result;
    MailApp.sendEmail({to:email,subject:'Invicta production health ' + result.status,
      body:'Checked at ' + result.checkedAt + '\n\n' + findings.join('\n') + '\n\nRead-only check; no automatic repair performed.'});
    cache.put(id,'sent',21600); // Best effort six-hour dedupe; never Script Properties.
  } finally { lock.releaseLock(); }
  return result;
}
