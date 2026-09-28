/** Photos-only social contract. Pure helpers also run in the preparation worker.
 * No queue schema changes; approval manifest lives in MEDIA URL's cell note.
 * Cloudinary upload/rendering belongs to the worker, NOT Apps Script/Netlify.
 */
const SOCIAL_MEDIA_VERSION_ = 'photos-v1';
const SOCIAL_REEL_VERSION_ = 'reel-v1';
const SOCIAL_HISTORY_HOLDS_ = ['HD-1004669158', 'HD-1007846436'];

function socialSelectText_(value) {
  return String(value && typeof value === 'object' ? value.name || '' : value || '').trim();
}

function socialPhotos_(fields) {
  const photos = fields.Photos;
  if (photos == null) return [];
  if (!Array.isArray(photos)) throw new Error('Malformed Airtable Photos.');
  const seen = new Set();
  return photos.map(function(photo) {
    if (!photo || !/^att[a-zA-Z0-9]+$/.test(photo.id || '') || seen.has(photo.id) ||
        !/^image\/(jpeg|png|webp)$/.test(photo.type || '') ||
        !Number.isFinite(photo.width) || !Number.isFinite(photo.height) ||
        photo.width < 300 || photo.height < 300 || !/^https:\/\//.test(photo.url || '')) {
      throw new Error('Unusable/duplicate Photos attachment; manual media review required.');
    }
    seen.add(photo.id);
    return {id:photo.id, url:photo.url, width:photo.width, height:photo.height, type:photo.type};
  });
}

function socialAirtableEligible_(fields) {
  const quantity = fields['Quantity Available'];
  return fields['Post to Website'] === true && socialSelectText_(fields.Status) === 'In Stock' &&
    typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0;
}

function socialRenderFacts_(fields) {
  const category = socialSelectText_(fields.Category), unit = socialSelectText_(fields['Unit Type']);
  const basis = socialSelectText_(fields['Price Basis']);
  const price = fields.Price;
  if (!String(fields.Name || '').trim() || typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw new Error('Missing verified product name/price.');
  }
  const specs = ['Card Spec 1', 'Card Spec 2', 'Card Spec 3'].map(function(key) {
    return String(fields[key] || '').trim();
  }).filter(Boolean);
  // Only actual mapped Airtable facts, never invented/AI product descriptions.
  return {name:String(fields.Name).trim().slice(0,100),
    price:'$' + (Number(price.toFixed(2)) === price ? price.toFixed(2) : String(price)) + (basis === 'Per Sq Ft' || !basis && category === 'Flooring' ? ' / sq ft' :
      basis === 'Per Box' || !basis && unit === 'Box' ? ' / box' : ' each'),
    specs:specs.slice(0,3).map(function(value) { return value.slice(0,100); }),
    brand:'Invicta Home Supply', cta:'McKinney, TX | invictahomesupply.com'};
}

function socialMediaPlan_(source, reels) {
  const ids = source.photos.map(function(photo) { return photo.id; });
  if (!ids.length) throw new Error('Airtable Photos required.');
  const reel = reels === true && ids.length >= 4;
  const selected = reel ? ids.slice(0,6) : ids.slice(0,10);
  const imageIds = selected.map(function(id) {
    return 'invicta-social/' + SOCIAL_MEDIA_VERSION_ + '/' + socialOperationKey_([source.productKey,id]);
  });
  const renderHash = socialOperationKey_([source.productKey, selected, SOCIAL_REEL_VERSION_, source.renderFacts,
    {width:1080,height:1920,seconds:12,silent:true}]);
  return {kind:'INVICTA_SOCIAL_MEDIA_V1', productKey:source.productKey, photoIds:ids,
    type:reel ? 'Reel' : ids.length === 1 ? 'Image' : 'Carousel',
    resourceType:reel ? 'video' : 'image',
    publicIds:reel ? ['invicta-social/' + SOCIAL_REEL_VERSION_ + '/' + renderHash] : imageIds,
    hashes:reel ? [renderHash] : selected.map(function(id) { return socialOperationKey_([source.productKey,id,SOCIAL_MEDIA_VERSION_]); }),
    renderHash:renderHash, sourceHash:buildSocialSourceHash_(source)};
}

function socialReadMediaPlan_(queue, rowNumber) {
  let plan;
  try { plan = JSON.parse(queue.getRange(rowNumber,5).getNote()); } catch (_) {
    throw new Error('Photos approval manifest missing; prepare media and approve again.');
  }
  if (!plan || plan.kind !== 'INVICTA_SOCIAL_MEDIA_V1' || !Array.isArray(plan.photoIds) || !plan.photoIds.length) {
    throw new Error('Invalid Photos approval manifest.');
  }
  return plan;
}

/** Bounded, read-only Airtable lookup. Existing explicit base/workbook checks apply. */
function socialReadAirtable_(productKey) {
  const token = PropertiesService.getScriptProperties().getProperty('AIRTABLE_TOKEN');
  if (!token) throw new Error('Explicit Airtable credential required.');
  iwaApprovedConfiguration_();
  if (productKey && !/^[A-Za-z0-9|_-]{1,150}$/.test(productKey)) throw new Error('Invalid Product Key.');
  const fields = ['Product Key','Name','Category','Price','Price Basis','Unit Type','Quantity Available','Post to Website','Status',
    'Photos','Card Spec 1','Card Spec 2','Card Spec 3'];
  const query = fields.map(function(field) { return 'fields%5B%5D=' + encodeURIComponent(field); }).join('&') +
    (productKey ? '&filterByFormula=' + encodeURIComponent('{Product Key}="' + productKey + '"') : '');
  const records = [], offsets = new Set();
  let offset = '';
  for (let page = 0; page < 20; page++) {
    let response;
    try { response = iwaRequest_(token, 'get', '?' + query + '&pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '')); }
    catch (_) { throw new Error('Social Airtable read failed; publishing blocked.'); }
    if (!response || !Array.isArray(response.records)) throw new Error('Incomplete social Airtable read.');
    records.push.apply(records, response.records);
    if (!response.offset) return records;
    if (offsets.has(response.offset)) throw new Error('Repeated Airtable pagination cursor.');
    offsets.add(response.offset); offset = response.offset;
  }
  throw new Error('Social Airtable pagination limit; fail closed.');
}

function readSocialSourceMap_(exportSheet, productKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = readSocialExportMap_(exportSheet);
  if (!map.size || productKey && !map.has(productKey)) return new Map();
  const catalog = readSheetTable_(getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET), 'PRODUCT KEY');
  const evidence = indexCatalogSourceEvidence_(readCatalogSourceEvidence_(ss));
  const catalogByKey = new Map(), remoteByKey = new Map();
  catalog.rows.forEach(function(row) {
    const key = String(row[catalog.map['PRODUCT KEY']] || '').trim();
    if (!key) return;
    if (catalogByKey.has(key)) throw new Error('Duplicate Product Catalog Product Key.');
    catalogByKey.set(key,row);
  });
  socialReadAirtable_(productKey).forEach(function(record) {
    const key = String(record.fields['Product Key'] || '').trim();
    if (!key || remoteByKey.has(key)) throw new Error('Missing/duplicate Airtable Product Key.');
    remoteByKey.set(key,record.fields);
  });
  map.forEach(function(source,key) {
    const row = catalogByKey.get(key), fields = remoteByKey.get(key);
    const stock = row ? catalogConfirmedStock_(ss, function(header) { return row[catalog.map[header]]; }, evidence) : {state:'UNKNOWN'};
    source.eligible = source.eligible && !!row && socialTruthy_(row[catalog.map['POST TO WEBSITE']]) &&
      stock.state === 'IN STOCK' && stock.quantity > 0 && !!fields && socialAirtableEligible_(fields);
    source.photos = [];
    source.mediaError = '';
    if (fields) {
      try { source.photos = socialPhotos_(fields); source.renderFacts = socialRenderFacts_(fields); }
      catch (_) { source.mediaError = 'Airtable Photos/product facts require manual review.'; }
    }
    source.confirmedStock = stock.state;
  });
  if (productKey) return new Map(map.has(productKey) ? [[productKey,map.get(productKey)]] : []);
  return map;
}

function socialQueueHistory_(queue, rowNumber, row) {
  return !!(row[13] || row[14] || row[15] || SOCIAL_HISTORY_HOLDS_.includes(String(row[0])) ||
    queue.getRange(rowNumber,14).getNote() || queue.getRange(rowNumber,15).getNote() ||
    /Buffer (send failed|RECONCILE|PUBLISHING)/i.test(String(row[18] || '')));
}

/** Reconcile every existing row, including absent/zero sources, before appending. */
function reconcileSocialQueue_(queue, sources) {
  const rows = queue.getLastRow() > 1 ? queue.getRange(2,1,queue.getLastRow()-1,19).getValues() : [];
  const seen = new Set(), summary = {added:0,refreshed:0,retired:0,held:0,needsImage:0};
  rows.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key && seen.has(key)) throw new Error('Duplicate Social Queue Product Key; no reconciliation permitted.');
    if (key) seen.add(key);
  });
  rows.forEach(function(row,index) {
    const rowNumber = index+2, key = String(row[0] || '').trim(), source = sources.get(key);
    if (!key) return;
    const history = socialQueueHistory_(queue,rowNumber,row);
    let status = String(row[12] || '').trim(), reason = '';
    if (!source || !source.eligible) { status = 'Skip'; reason = 'Retired: no confirmed active positive inventory.'; summary.retired++; }
    else if (history) {
      // NEVER refresh operational identity/copy/media on historical or uncertain sends.
      if (status === 'Ready' || SOCIAL_HISTORY_HOLDS_.includes(key)) status = 'Skip';
      reason = 'Historical/uncertain Buffer operation preserved; no new publication without owner review.'; summary.held++;
    } else if (!source.photos.length || source.mediaError) {
      status = 'Needs Image'; reason = 'Owner Airtable Photos required; no reference/stock/manual fallback.'; summary.needsImage++;
    } else if (status !== 'Skip') {
      const reels = PropertiesService.getScriptProperties().getProperty('SOCIAL_REELS_ENABLED') === 'true';
      const plan = socialMediaPlan_(source,reels), hash = plan.sourceHash;
      let previous = null;
      try { previous = socialReadMediaPlan_(queue,rowNumber); } catch (_) { /* Old Ready is not approved for new media. */ }
      const changed = !previous || JSON.stringify(previous) !== JSON.stringify(plan) || String(row[17]) !== hash;
      queue.getRange(rowNumber,2,1,3).setValues([[source.displayName,source.category,source.priceLabel]]);
      queue.getRange(rowNumber,5).setValue(''); // URL is an informational mirror, never publishing authority.
      queue.getRange(rowNumber,5).setNote(JSON.stringify(plan));
      queue.getRange(rowNumber,6,1,3).setValues([[plan.type === 'Reel' ? 'Video' : 'Image',
        SOCIAL_CONFIG_.WEBSITE_BASE_URL + encodeURIComponent(key),plan.type === 'Reel' ? 'Reel' : 'Post']]);
      queue.getRange(rowNumber,18).setValue(hash);
      if (changed || !['Draft','Ready','Needs Copy'].includes(status)) {
        status = previous && String(row[17]) !== hash ? 'Needs Copy' : 'Draft';
        reason = 'New Photos/strategy/facts require media preparation and intentional Ready approval.';
      }
      summary.refreshed++;
    }
    queue.getRange(rowNumber,13).setValue(status);
    if (reason) queue.getRange(rowNumber,13).setNote(reason);
  });
  sources.forEach(function(source,key) {
    if (seen.has(key) || !source.eligible) return;
    const rowNumber = queue.getLastRow()+1;
    if (rowNumber > queue.getMaxRows()) queue.insertRowsAfter(queue.getMaxRows(),rowNumber-queue.getMaxRows());
    const hasPhotos = source.photos.length && !source.mediaError;
    const plan = hasPhotos ? socialMediaPlan_(source,PropertiesService.getScriptProperties().getProperty('SOCIAL_REELS_ENABLED') === 'true') : null;
    queue.getRange(rowNumber,1,1,19).setValues([[key,source.displayName,source.category,source.priceLabel,'',
      plan && plan.type === 'Reel' ? 'Video' : 'Image',SOCIAL_CONFIG_.WEBSITE_BASE_URL + encodeURIComponent(key),
      plan && plan.type === 'Reel' ? 'Reel' : 'Post','','','','',hasPhotos ? 'Draft' : 'Needs Image',
      '','','','',buildSocialSourceHash_(source),'']]);
    if (plan) queue.getRange(rowNumber,5).setNote(JSON.stringify(plan));
    summary.added++;
  });
  return summary;
}

function assertSocialMediaCurrent_(queue, rowNumber, row, plan) {
  assertSocialSendRowUnchanged_(queue,rowNumber,row);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = readSocialSourceMap_(getInventorySheetOrThrow_(ss,SOCIAL_CONFIG_.EXPORT_SHEET),String(row[0])).get(String(row[0]));
  let status = '', reason = '';
  if (!source || !source.eligible || SOCIAL_HISTORY_HOLDS_.includes(String(row[0]))) {
    status = 'Skip'; reason = 'Current active, authoritative positive inventory required.';
  } else if (!source.photos.length || source.mediaError) {
    status = 'Needs Image'; reason = 'Airtable Photos unavailable/invalid; no fallback.';
  } else if (JSON.stringify(socialMediaPlan_(source,plan.type === 'Reel')) !== JSON.stringify(plan) ||
      JSON.stringify(socialReadMediaPlan_(queue,rowNumber)) !== JSON.stringify(plan) ||
      String(row[17]) !== buildSocialSourceHash_(source) ||
      row[5] !== (plan.type === 'Reel' ? 'Video' : 'Image') || row[7] !== (plan.type === 'Reel' ? 'Reel' : 'Post')) {
    status = 'Draft'; reason = 'Approved Photos/strategy/facts changed; intentional reapproval required.';
  }
  if (status) {
    queue.getRange(rowNumber,13).setValue(status);
    queue.getRange(rowNumber,13).setNote(reason);
    const error = new Error(reason); error.socialEligibilityFailure = true; throw error;
  }
  return source;
}

/** Only derived immutable public IDs; no arbitrary URL accepted by the sender. */
function socialResolveCloudinary_(plan) {
  const props = PropertiesService.getScriptProperties();
  const cloud = props.getProperty('CLOUDINARY_CLOUD_NAME'), key = props.getProperty('CLOUDINARY_API_KEY'), secret = props.getProperty('CLOUDINARY_API_SECRET');
  if (!cloud || !/^[a-z0-9_-]+$/i.test(cloud) || !key || !secret) throw new Error('Cloudinary secure configuration required; publishing blocked.');
  const urls = plan.publicIds.map(function(id,index) {
    if (!/^invicta-social\/(photos-v1|reel-v1)\/[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid derived media identity.');
    let response;
    try {
      response = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/' + cloud + '/resources/' + plan.resourceType + '/upload/' + encodeURIComponent(id) + '?context=true',
        {method:'get',headers:{Authorization:'Basic ' + Utilities.base64Encode(key + ':' + secret)},muteHttpExceptions:true});
    } catch (_) { throw new Error('Cloudinary lookup failed; publishing blocked.'); }
    if (response.getResponseCode() !== 200) throw new Error('Prepared Cloudinary asset unavailable (HTTP ' + response.getResponseCode() + ').');
    let asset;
    try { asset = JSON.parse(response.getContentText()); } catch (_) { throw new Error('Malformed Cloudinary asset response.'); }
    const fingerprint = asset.context && asset.context.custom && asset.context.custom.source_hash;
    const video = plan.resourceType === 'video';
    if (asset.public_id !== id || asset.resource_type !== plan.resourceType || asset.type !== 'upload' ||
        fingerprint !== plan.hashes[index] || !Number.isInteger(asset.version) || asset.version <= 0 ||
        asset.format !== (video ? 'mp4' : 'jpg') || !Number.isFinite(asset.bytes) || asset.bytes <= 0 ||
        asset.bytes > (video ? 100*1024*1024 : 8*1024*1024) || asset.width !== 1080 ||
        asset.height !== (video ? 1920 : 1350) ||
        (video && (!Number.isFinite(asset.duration) || Math.abs(asset.duration-12) > 0.5 ||
          !asset.video || asset.video.codec !== 'h264' || asset.audio && Object.keys(asset.audio).length))) {
      throw new Error('Prepared asset fingerprint/format does not match approval.');
    }
    // Immutable version pinned. No on-demand paid transformations.
    return 'https://res.cloudinary.com/' + cloud + '/' + plan.resourceType + '/upload/v' + asset.version + '/' + id + '.' + asset.format;
  });
  return {plan:plan,urls:urls,cloud:cloud};
}

function socialMediaPayload_(row, channelId, text, media, options) {
  if (!media || !media.plan || !Array.isArray(media.urls) || media.urls.length !== media.plan.publicIds.length) {
    throw new Error('Prepared Photos-only media required, not a manual URL.');
  }
  return {productKey:String(row[0]).trim(), channelId:String(channelId), text:text,
    sourceHash:String(row[17] || ''), cloud:media.cloud, mediaType:media.plan.type,
    publicIds:media.plan.publicIds, photoIds:media.plan.photoIds, renderHash:media.plan.renderHash,
    saveToDraft:!!(options && options.saveToDraft === true), mode:options && options.saveToDraft === true ? 'addToQueue' : 'shareNow'};
}

function socialBufferInput_(channelId,text,media,service,options) {
  if (!['facebook','instagram'].includes(service)) throw new Error('Unsupported social channel.');
  const reel = media.plan.type === 'Reel';
  const input = {channelId:channelId,text:text,schedulingType:'automatic',
    mode:options && options.saveToDraft === true ? 'addToQueue' : 'shareNow',aiAssisted:true,
    assets:media.urls.map(function(url) { return reel ? {video:{url:url,metadata:{thumbnailOffset:2000}}} : {image:{url:url}}; }),
    metadata:service === 'facebook' ? {facebook:{type:reel ? 'reel' : 'post'}} :
      {instagram:{type:reel ? 'reel' : 'post',shouldShareToFeed:true}},source:'invicta-google-sheets'};
  if (options && options.saveToDraft === true) input.saveToDraft = true;
  return input;
}

/** shareNow reduces, but cannot atomically eliminate, stock/publication races. */
function sendReadySocialMedia_() {
  const props = PropertiesService.getScriptProperties();
  const summary = {processed:0,queued:0,partial:0,failed:0,skipped:false,reason:''};
  if (props.getProperty('SOCIAL_PUBLISHING_ENABLED') !== 'true') {
    summary.skipped = true; summary.reason = 'Social publishing disabled.'; return summary;
  }
  const apiKey = props.getProperty(SOCIAL_CONFIG_.BUFFER_API_KEY_PROPERTY);
  const channels = [props.getProperty(SOCIAL_CONFIG_.BUFFER_FB_CHANNEL_PROPERTY),props.getProperty(SOCIAL_CONFIG_.BUFFER_IG_CHANNEL_PROPERTY)];
  if (!apiKey || channels.some(function(id) { return !id; }) || channels[0] === channels[1]) throw new Error('Explicit distinct Buffer channels required.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another Apps Script maintenance/social run is active.');
  try {
    const queue = getSocialQueueSheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet());
    assertSocialQueueHeaders_(queue);
    const rows = queue.getLastRow() > 1 ? queue.getRange(2,1,queue.getLastRow()-1,19).getValues() : [];
    const index = rows.findIndex(function(row) { return String(row[12]).trim() === 'Ready'; });
    if (index < 0) return summary;
    const row = rows[index], rowNumber = index+2;
    // Existing journal may ONLY reconcile. It cannot create an unsent sibling on retry.
    const history = socialQueueHistory_(queue,rowNumber,row);
    if (!history && hasSocialPostQueuedWithinHours_(48)) {
      summary.skipped = true; summary.reason = 'Rolling 48-hour cadence active.'; return summary;
    }
    summary.processed = 1;
    try {
      const plan = socialReadMediaPlan_(queue,rowNumber);
      assertSocialMediaCurrent_(queue,rowNumber,row,plan);
      if (!String(row[9]).trim() || !String(row[10]).trim()) throw new Error('Both approved captions required.');
      const media = socialResolveCloudinary_(plan);
      assertSocialMediaCurrent_(queue,rowNumber,row,plan);
      for (let serviceIndex = 0; serviceIndex < 2; serviceIndex++) {
        const idColumn = serviceIndex+14;
        if (row[idColumn-1]) continue;
        const text = String(row[serviceIndex+9]).trim() + (String(row[11]).trim() ? '\n\n' + String(row[11]).trim() : '');
        createOrReconcileSocialPost_(queue,rowNumber,row,apiKey,channels[serviceIndex],text,media,
          serviceIndex === 0 ? 'facebook' : 'instagram', {reconcileOnly:history});
        // First successful channel counts toward cadence, even if sibling fails.
        queue.getRange(rowNumber,16).setValue(new Date());
      }
      queue.getRange(rowNumber,13).setValue('Queued'); // Receipt/hand-off, NOT proof of platform publication.
      queue.getRange(rowNumber,19).clearContent(); summary.queued++;
    } catch (error) {
      if (!error.socialEligibilityFailure) {
        queue.getRange(rowNumber,13).setValue('Error');
        // Errors intentionally exclude transport bodies, signed URLs and secrets.
        queue.getRange(rowNumber,19).setValue('Buffer RECONCILE required (preserve ID-cell notes): ' + String(error.message || 'Social operation failed').slice(0,350));
      }
      const now = queue.getRange(rowNumber,14,1,2).getValues()[0];
      if (now.some(Boolean)) summary.partial++; else summary.failed++;
    }
    return summary;
  } finally { lock.releaseLock(); }
}
