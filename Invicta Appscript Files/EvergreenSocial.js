/** Content source only. Uses the existing 19-column queue and Buffer publisher. */
const EVERGREEN_SHEET_ = 'Evergreen Social Content';
const EVERGREEN_HEADERS_ = ['CONTENT ID','CONTENT TYPE','TITLE','CAPTION','SLIDE 1','SLIDE 2','SLIDE 3','SLIDE 4','STATUS','COOLDOWN DAYS','SOURCES'];
const EVERGREEN_TEMPLATE_ = 'evergreen-v1';
const EVERGREEN_ROTATION_ = ['Product','Educational','Product','Comparison','Product','Educational','Product','Brand/Tip'];

function evergreenIdentity_(key) {
  const match = /^EVERGREEN\|([A-Z][A-Z0-9-]{1,60})\|([1-9][0-9]{0,8})$/.exec(String(key));
  return match ? {id:match[1],occurrence:Number(match[2])} : null;
}

function evergreenContent_(row) {
  const text = function(value,max) {
    const s = String(value || '').trim();
    if (!s || s.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) throw new Error('Invalid/bounded evergreen copy required.');
    return s;
  };
  const item = {id:text(row[0],61),type:text(row[1],20),title:text(row[2],110),caption:text(row[3],1800),
    slides:row.slice(4,8).map(function(s) { return text(s,350); }),status:String(row[8] || '').trim(),
    cooldown:row[9] === '' || row[9] == null ? 120 : Number(row[9]),sources:text(row[10],2000)};
  if (!/^[A-Z][A-Z0-9-]{1,60}$/.test(item.id) || !['Educational','Comparison','Tip','Brand'].includes(item.type) ||
      !['Enabled','Disabled'].includes(item.status) || !Number.isInteger(item.cooldown) || item.cooldown < 90 || item.cooldown > 120 ||
      !item.sources.split(/\s+/).every(function(url) { return /^https:\/\/[^\s]+$/.test(url); })) throw new Error('Invalid evergreen library identity/type/status/cooldown/sources.');
  return item;
}

function evergreenReadLibrary_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVERGREEN_SHEET_);
  if (!sheet) return [];
  if (sheet.getLastColumn() !== EVERGREEN_HEADERS_.length ||
      JSON.stringify(sheet.getRange(1,1,1,EVERGREEN_HEADERS_.length).getValues()[0]) !== JSON.stringify(EVERGREEN_HEADERS_)) throw new Error('Evergreen library headers differ; no source mutation permitted.');
  const seen = new Set();
  return (sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,EVERGREEN_HEADERS_.length).getValues() : [])
    .filter(function(row) { return row.some(function(x) { return x !== ''; }); }).map(function(row) {
      const item = evergreenContent_(row);
      if (seen.has(item.id)) throw new Error('Duplicate evergreen Content ID.');
      seen.add(item.id); return item;
    });
}

function evergreenPlan_(item,occurrence) {
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > 999999999) throw new Error('Invalid content occurrence.');
  const renderHash = socialOperationKey_([EVERGREEN_TEMPLATE_,item.id,item.type,item.title,item.caption,item.slides,item.sources,
    {width:1080,height:1350,brand:'Invicta Home Supply',cta:'invictahomesupply.com | McKinney, TX',palette:'invicta-2026'}]);
  const hashes = item.slides.map(function(_,index) { return socialOperationKey_([renderHash,index]); });
  const key = 'EVERGREEN|' + item.id + '|' + occurrence;
  return {kind:'INVICTA_EVERGREEN_MEDIA_V1',sourceType:item.type,contentId:item.id,occurrence:occurrence,
    productKey:key,photoIds:[],type:'Carousel',resourceType:'image',templateVersion:EVERGREEN_TEMPLATE_,
    renderHash:renderHash,sourceHash:socialOperationKey_([key,renderHash]),hashes:hashes,
    publicIds:hashes.map(function(hash) { return 'invicta-social/' + EVERGREEN_TEMPLATE_ + '/' + hash; })};
}

function evergreenQueueRows_(queue) {
  return queue.getLastRow() > 1 ? queue.getRange(2,1,queue.getLastRow()-1,19).getValues() : [];
}

/** One index over existing receipts, including uncertain durable intents. */
function evergreenHistory_(queue,rows) {
  const byId = new Map();
  rows.forEach(function(row,index) {
    const identity = evergreenIdentity_(row[0]);
    if (!identity) return;
    const state = byId.get(identity.id) || {posted:false,last:0,pending:false,held:false,maxOccurrence:0};
    state.maxOccurrence = Math.max(state.maxOccurrence,identity.occurrence);
    if (socialQueueHistory_(queue,index+2,row)) {
      state.posted = true;
      let dates = row[15] ? [new Date(row[15]).getTime()] : [];
      [14,15].forEach(function(col) {
        const note = queue.getRange(index+2,col).getNote();
        if (note) { try { dates.push(Date.parse(JSON.parse(note).startedAt)); } catch (_) { dates.push(NaN); } }
      });
      // Missing/invalid evidence never makes historical content reusable.
      state.last = Math.max(state.last,dates.length && dates.every(Number.isFinite) ? Math.max.apply(null,dates) : Infinity);
    } else if (String(row[12]) !== 'Skip') state.pending = true;
    else state.held = true; // Intentional owner Skip is not silently requeued.
    byId.set(identity.id,state);
  });
  return byId;
}

function evergreenCanPrepare_(item,history,library,now) {
  if (item.status !== 'Enabled') return false;
  const state = history.get(item.id);
  if (state && (state.pending || state.held)) return false;
  if (!state || !state.posted) return true;
  if (evergreenUnusedAvailable_(library,history)) return false;
  return now >= state.last + item.cooldown*86400000;
}

function evergreenUnusedAvailable_(library,history) {
  return library.some(function(other) {
    const state = history.get(other.id) || {};
    return other.status === 'Enabled' && !state.posted && !state.held;
  });
}

/** Existing receipts define slots; retry/reconciliation has priority over new work. */
function evergreenSelectReady_(queue,rows) {
  const ready = rows.map(function(row,index) { return {row:row,index:index}; }).filter(function(entry) { return String(entry.row[12]).trim() === 'Ready'; });
  const retry = ready.find(function(entry) { return socialQueueHistory_(queue,entry.index+2,entry.row); });
  if (retry) return retry.index;
  // Before the optional library is installed, preserve the PR19 product-only path.
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVERGREEN_SHEET_)) return ready.length ? ready[0].index : -1;
  let accepted = 0;
  rows.forEach(function(row,index) {
    if (row[13] || row[14] || row[15] || queue.getRange(index+2,14).getNote() || queue.getRange(index+2,15).getNote()) accepted++;
  });
  const slot = EVERGREEN_ROTATION_[accepted % EVERGREEN_ROTATION_.length];
  const matches = ready.filter(function(entry) {
    const identity = evergreenIdentity_(entry.row[0]), type = String(entry.row[7]);
    return slot === 'Product' ? !identity && ['Post','Reel'].includes(type) :
      !!identity && (slot === 'Brand/Tip' ? ['Brand','Tip'].includes(type) : type === slot);
  });
  const history = evergreenHistory_(queue,rows), library = evergreenReadLibrary_();
  const eligible = matches.filter(function(entry) {
    const identity = evergreenIdentity_(entry.row[0]);
    if (!identity) return true;
    const item = library.find(function(content) { return content.id === identity.id; });
    const state = history.get(identity.id);
    if (!item || item.status !== 'Enabled') return false;
    if (state && state.posted) {
      if (evergreenUnusedAvailable_(library,history)) return false;
      return Date.now() >= state.last + item.cooldown*86400000;
    }
    return true;
  });
  eligible.sort(function(a,b) { return String(a.row[0]).localeCompare(String(b.row[0])); });
  return eligible.length ? eligible[0].index : -1; // Wait for owner approval of this slot; never auto-Ready/fallback flood.
}

function assertEvergreenCurrent_(queue,rowNumber,row,plan) {
  const identity = evergreenIdentity_(row[0]);
  const library = evergreenReadLibrary_();
  const item = identity && library.find(function(content) { return content.id === identity.id; });
  const fail = function(status,message) {
    queue.getRange(rowNumber,13).setValue(status);queue.getRange(rowNumber,19).setValue(message);
    const error = new Error(message);error.socialEligibilityFailure = true;throw error;
  };
  if (!item || item.status !== 'Enabled') fail('Skip','Evergreen source missing/disabled; no publication.');
  if (row[7] !== item.type || row[5] !== 'Image' || row[9] !== item.caption || row[10] !== item.caption ||
      row[11] !== '' || row[17] !== plan.sourceHash ||
      JSON.stringify(evergreenPlan_(item,identity.occurrence)) !== JSON.stringify(plan) ||
      JSON.stringify(socialReadMediaPlan_(queue,rowNumber)) !== JSON.stringify(plan)) fail('Draft','Evergreen source/caption/media changed; prepare and approve again.');
  const rows = evergreenQueueRows_(queue);
  const others = rows.map(function(other,index) { return index+2 === rowNumber ? new Array(19).fill('') : other; });
  const history = evergreenHistory_(queue,others), state = history.get(item.id);
  if (state && state.pending) fail('Draft','Duplicate pending evergreen content; owner review required.');
  if (state && state.posted && Date.now() < state.last + item.cooldown*86400000) fail('Draft','Evergreen reuse cooldown active.');
  if (state && state.posted && evergreenUnusedAvailable_(library,history)) fail('Draft','Unused evergreen topics take priority; review rotation again.');
  return item;
}

/** Explicit owner invocation; no triggers, Gemini, Buffer or inventory changes. */
function evergreenQueueTypeValidation_(queue,rowNumber,type) {
  const cell = queue.getRange(rowNumber,8), rule = cell.getDataValidation();
  if (!rule) return;
  if (rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) throw new Error('Unexpected queue content-type validation; owner review required.');
  const criteria = rule.getCriteriaValues(), options = criteria[0];
  const supported = ['Post','Reel','Educational','Comparison','Tip','Brand'];
  if (!Array.isArray(options) || !options.includes('Post') || !options.includes('Reel') ||
      options.some(function(value) { return !supported.includes(value); })) throw new Error('Unknown queue content-type options; owner review required.');
  if (options.includes(type)) return;
  // Only this editorial row: preserve strictness/UI and all product-row validation.
  cell.setDataValidation(rule.copy().requireValueInList(supported,criteria[1]).build());
}

function prepareEvergreenSocialQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another social/maintenance operation is active.');
  try {
    const queue = getSocialQueueSheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet());assertSocialQueueHeaders_(queue);
    const library = evergreenReadLibrary_(), rows = evergreenQueueRows_(queue), history = evergreenHistory_(queue,rows);
    const summary = {added:0,refreshed:0,manifests:[]};
    library.forEach(function(item) {
      if (item.status !== 'Enabled') return;
      const pending = rows.map(function(row,index) { return {row:row,index:index}; }).filter(function(entry) {
        const identity = evergreenIdentity_(entry.row[0]);
        return identity && identity.id === item.id && !socialQueueHistory_(queue,entry.index+2,entry.row) && entry.row[12] !== 'Skip';
      });
      if (pending.length > 1) throw new Error('Duplicate pending evergreen source.');
      if (!pending.length && !evergreenCanPrepare_(item,history,library,Date.now())) return;
      const existing = pending[0];
      const occurrence = existing ? evergreenIdentity_(existing.row[0]).occurrence : (history.get(item.id) || {maxOccurrence:0}).maxOccurrence+1;
      const plan = evergreenPlan_(item,occurrence);
      // Immutable public, non-secret copy snapshot bridges Sheets to the existing worker.
      evergreenPublishSnapshot_(item,plan);
      const rowNumber = existing ? existing.index+2 : queue.getLastRow()+1;
      if (rowNumber > queue.getMaxRows()) queue.insertRowsAfter(queue.getMaxRows(),rowNumber-queue.getMaxRows());
      evergreenQueueTypeValidation_(queue,rowNumber,item.type);
      const unchanged = existing && existing.row[17] === plan.sourceHash && existing.row[9] === item.caption && existing.row[10] === item.caption &&
        existing.row[7] === item.type && existing.row[5] === 'Image' && existing.row[11] === '' &&
        queue.getRange(rowNumber,5).getNote() === JSON.stringify(plan);
      if (!unchanged) {
        queue.getRange(rowNumber,1,1,19).setValues([[plan.productKey,item.title,'Evergreen','','','Image',
          'https://invictahomesupply.com',item.type,item.title,item.caption,item.caption,'','Draft','','','',new Date(),plan.sourceHash,'']]);
        queue.getRange(rowNumber,5).setNote(JSON.stringify(plan));
      }
      summary[existing ? 'refreshed' : 'added']++;
      summary.manifests.push({contentId:item.id,renderHash:plan.renderHash});
    });
    return summary;
  } finally { lock.releaseLock(); }
}

/** Only provably owned earlier occurrence receipts may be excluded on intentional reuse.
 * Unrecognized remote matches still block; product V1/V2 reconciliation is unchanged.
 */
function evergreenPriorReceipts_(plan) {
  const queue = getSocialQueueSheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet()), ids = new Set();
  evergreenQueueRows_(queue).forEach(function(row,index) {
    const identity = evergreenIdentity_(row[0]);
    if (!identity || identity.id !== plan.contentId || identity.occurrence >= plan.occurrence) return;
    [14,15].forEach(function(column) {
      const value = row[column-1];if (value) ids.add(String(value));
      const intent = readSocialBufferIntent_(queue.getRange(index+2,column));
      if (intent && intent.remoteId) ids.add(String(intent.remoteId));
    });
  });
  return Array.from(ids).sort();
}

/** Signed immutable raw JSON; contains only reviewed public copy, never workbook data/secrets. */
function evergreenPublishSnapshot_(item,plan) {
  try { return evergreenUploadSnapshot_(item,plan); }
  catch (_) { throw new Error('Evergreen immutable snapshot preparation failed; inspect configuration/source without exposing API responses.'); }
}

function evergreenUploadSnapshot_(item,plan) {
  const props = PropertiesService.getScriptProperties();
  const cloud = props.getProperty('CLOUDINARY_CLOUD_NAME'), key = props.getProperty('CLOUDINARY_API_KEY'), secret = props.getProperty('CLOUDINARY_API_SECRET');
  if (!cloud || !/^[a-z0-9_-]+$/i.test(cloud) || !key || !secret) throw new Error('Secure Cloudinary configuration required.');
  const id = 'invicta-social/evergreen-sources-v1/' + plan.renderHash + '.json';
  const lookup = function() {
    const r = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/'+cloud+'/resources/raw/upload/'+encodeURIComponent(id)+'?context=true',
      {headers:{Authorization:'Basic '+Utilities.base64Encode(key+':'+secret)},muteHttpExceptions:true});
    if (r.getResponseCode() === 404) return null;
    if (r.getResponseCode() !== 200) throw new Error('Evergreen snapshot lookup failed.');
    const asset = JSON.parse(r.getContentText());
    if (asset.public_id !== id || asset.resource_type !== 'raw' || asset.type !== 'upload' ||
        !asset.context || !asset.context.custom || asset.context.custom.source_hash !== plan.renderHash ||
        !Number.isInteger(asset.version) || asset.version < 1 || !(asset.bytes > 0 && asset.bytes < 20000)) throw new Error('Snapshot identity conflict.');
    return asset;
  };
  if (lookup()) return;
  const params = {public_id:id,overwrite:'false',context:'source_hash='+plan.renderHash,timestamp:String(Math.floor(Date.now()/1000))};
  const signing = Object.keys(params).sort().map(function(name) { return name+'='+params[name]; }).join('&')+secret;
  const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,signing,Utilities.Charset.UTF_8)
    .map(function(b) { return ('0'+((b+256)%256).toString(16)).slice(-2); }).join('');
  const body = JSON.stringify({kind:'INVICTA_EVERGREEN_SOURCE_V1',templateVersion:EVERGREEN_TEMPLATE_,renderHash:plan.renderHash,
    content:{id:item.id,type:item.type,title:item.title,caption:item.caption,slides:item.slides,sources:item.sources}});
  const response = UrlFetchApp.fetch('https://api.cloudinary.com/v1_1/'+cloud+'/raw/upload',
    {method:'post',payload:Object.assign({},params,{api_key:key,signature:signature,file:Utilities.newBlob(body,'application/json','content.json')}),muteHttpExceptions:true});
  if (response.getResponseCode() !== 200 || !lookup()) throw new Error('Snapshot upload not verified; no queue approval.');
}

/** Manual, additive seed; never overwrites an existing library. Not an activation function. */
function initializeEvergreenSocialLibrary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(EVERGREEN_SHEET_)) throw new Error('Evergreen library exists; edit intentionally, never reseed/overwrite.');
  const sheet = ss.insertSheet(EVERGREEN_SHEET_), rows = evergreenSeedRows_();
  if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
  sheet.getRange(1,1,rows.length+1,EVERGREEN_HEADERS_.length).setValues([EVERGREEN_HEADERS_].concat(rows));
  evergreenFormatLibrary_(sheet,rows.length+1);
  return {sheet:EVERGREEN_SHEET_,topics:rows.length,queueRowsAdded:0,publishingEnabled:false};
}

/** Readable owner review area only; no inventory/queue formatting changes. */
function evergreenFormatLibrary_(sheet,rowCount) {
  sheet.getRange(1,1,rowCount,11).setWrap(true).setVerticalAlignment('top');
  sheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#eeeeee');
  [110,140,220,360,260,260,260,260,100,140,300].forEach(function(width,index) {
    sheet.setColumnWidth(index+1,width);
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeRows(1,rowCount);
}
