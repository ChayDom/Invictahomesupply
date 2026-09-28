/**
 * Controlled active-merchandise cleanup. No history/source sheets are written.
 * One lightweight archive doubles as a durable, resumable cleanup journal.
 * Clearing catalog value segments (not deleting sheet rows) preserves K2/spills.
 */
const CATALOG_ARCHIVE_SHEET_ = 'Product Catalog Archive';
const CATALOG_RETENTION_MS_ = 10 * 24 * 60 * 60 * 1000;
const CATALOG_ARCHIVE_HEADERS_ = Object.freeze([
  'PRODUCT KEY', 'PRODUCT ID', 'RETAILER', 'RETAIL SKU', 'DISPLAY NAME', 'SOURCE ITEM',
  'CATEGORY', 'SUBCATEGORY', 'SOLD OUT SINCE', 'ARCHIVED AT', 'REMOVED AT',
  'FINAL SELL PRICE', 'FINAL COMPARABLE RETAIL PRICE', 'FINAL QUANTITY', 'PRODUCT URL',
  'CLEANUP STATE', 'AIRTABLE RECORD ID', 'SNAPSHOT HASH'
]);

function readCatalogArchive_(ss) {
  const sheet = ss.getSheetByName(CATALOG_ARCHIVE_SHEET_);
  if (!sheet) return { sheet: null, rows: [], map: buildHeaderMap_(CATALOG_ARCHIVE_HEADERS_) };
  const table = readSheetTable_(sheet, 'PRODUCT KEY');
  requireHeaders_(table.map, CATALOG_ARCHIVE_HEADERS_, CATALOG_ARCHIVE_SHEET_);
  const keys = new Set();
  table.rows.forEach(function(row) {
    const key = normalizeKey_(row[table.map['PRODUCT KEY']]);
    if (!key && row.some(function(v) { return v !== '' && v != null; })) throw new Error('Archive row missing permanent Product Key.');
    if (key && ['RETIRING', 'ARCHIVED', 'AIRTABLE REMOVED', 'COMPLETE', 'CANCELLED'].indexOf(row[table.map['CLEANUP STATE']]) < 0) throw new Error('Invalid archive cleanup state: ' + key);
    if (key && keys.has(key)) throw new Error('Duplicate archive Product Key: ' + key);
    if (key && row[table.map['SNAPSHOT HASH']] !== catalogArchiveHash_(row, table.map)) {
      throw new Error('Archive Snapshot Hash mismatch: ' + key + '. Restore from a verified backup; never silently rehash history.');
    }
    if (key) keys.add(key);
  });
  return { sheet: sheet, rows: table.rows, map: table.map };
}

function catalogLifecycleStock_(availableSqFt, quantity) {
  return [availableSqFt, quantity].find(function(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  });
}

function archivedCatalogKeys_(ss, removedOnly) {
  const archive = readCatalogArchive_(ss), keys = new Set();
  archive.rows.forEach(function(row) {
    const state = catalogText_(row[archive.map['CLEANUP STATE']]);
    if (state !== 'CANCELLED' && (!removedOnly || state === 'AIRTABLE REMOVED' || state === 'COMPLETE')) {
      keys.add(normalizeKey_(row[archive.map['PRODUCT KEY']]));
    }
  });
  return keys;
}

// Active match always wins while its lifecycle is live (including SKU corrections).
// Historical source rows cannot resurrect a completed key; only positive stock
// can open a new cycle, with a newly allocated permanent key, never the old one.
function catalogSourcesForLifecycle_(sources, catalog, archive) {
  const retired = archive.rows.filter(function(row) {
    return catalogText_(row[archive.map['CLEANUP STATE']]) !== 'CANCELLED';
  });
  const used = new Set(catalog.rows.map(function(row) { return normalizeKey_(row[catalog.map['PRODUCT KEY']]); }));
  retired.forEach(function(row) { used.add(normalizeKey_(row[archive.map['PRODUCT KEY']])); });
  return sources.flatMap(function(source) {
    const matches = retired.filter(function(row) {
      return normalizeKey_(row[archive.map['PRODUCT KEY']]) === normalizeKey_(source.productKey) ||
        normalizeKey_(row[archive.map['PRODUCT ID']]) === normalizeKey_(source.productId) ||
        currentProductId_(row[archive.map['RETAILER']], row[archive.map['RETAIL SKU']]) === source.productId;
    });
    if (!matches.length) return [source];
    const active = catalog.rows.find(function(row) {
      return normalizeKey_(row[catalog.map['PRODUCT KEY']]) === normalizeKey_(source.productKey) ||
        normalizeKey_(row[catalog.map['PRODUCT ID']]) === normalizeKey_(source.productId) ||
        catalogSourceIdentity_(row[catalog.map['RETAILER']], row[catalog.map['SOURCE ITEM']]) === catalogSourceIdentity_(source.retailer, source.item);
    });
    if (active) {
      const pending = retired.find(function(row) {
        return normalizeKey_(row[archive.map['PRODUCT KEY']]) === normalizeKey_(active[catalog.map['PRODUCT KEY']]);
      });
      // Do not reconcile partially-cleared rows while cleanup is unfinished.
      return pending ? [] : [source];
    }
    // A verified retired A need not wait for its Airtable grace period to finish
    // before a confidently later acquisition opens B.
    if (matches.some(function(row) { return row[archive.map['CLEANUP STATE']] === 'RETIRING'; })) return [];
    if (!(typeof source.quantityAvailable === 'number' && Number.isFinite(source.quantityAvailable) && source.quantityAvailable > 0)) return [];
    if (!catalogSourceHasLaterPurchase_(SpreadsheetApp.getActiveSpreadsheet(), source, matches, archive.map)) {
      console.warn('Archived SKU positive without confident later purchase; manual review: ' + source.productId);
      return [];
    }
    let key;
    do { key = 'ACQ-' + Utilities.getUuid().toUpperCase(); } while (used.has(normalizeKey_(key)));
    used.add(normalizeKey_(key));
    return [Object.assign({}, source, { productKey: key })];
  });
}

function catalogCleanupEnabled_() {
  return PropertiesService.getScriptProperties().getProperty('CATALOG_LIFECYCLE_CLEANUP_ENABLED') === 'true';
}

// Explicit manual handler; preview by default. Existing maintenance can invoke
// the locked implementation only after the operator opts in via Script Property.
function runSoldOutCatalogCleanup(options) {
  const opts = options || {}, lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (opts.apply && !catalogCleanupEnabled_()) throw new Error('Catalog lifecycle cleanup is disabled.');
    return cleanupSoldOutCatalogLocked_({ apply: opts.apply === true, productKeys: opts.productKeys });
  } finally { lock.releaseLock(); }
}

function cleanupSoldOutCatalogLocked_(opts) {
  if (opts.apply && !catalogCleanupEnabled_()) throw new Error('Catalog lifecycle cleanup is disabled.');
  if (!opts.apply) return previewSoldOutCatalogLocked_(opts);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  iwaApprovedConfiguration_();
  const catalogSheet = getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  getCatalogColumns_(catalogSheet);
  let catalog = readSheetTable_(catalogSheet, 'PRODUCT KEY');
  if (catalogIdentityFindings_(catalog.rows, catalog.map).length) throw new Error('Unsafe catalog identities; cleanup aborted.');
  // Initial eligibility uses one snapshot; destructive rechecks below remain fresh.
  const evidence = indexCatalogSourceEvidence_(readCatalogSourceEvidence_(ss));
  const token = PropertiesService.getScriptProperties().getProperty(IWA_SYNC_HARDENED.TOKEN_PROPERTY);
  if (!token) throw new Error('Missing Airtable token.');
  let records = iwaFetchAll_(token), archive = readCatalogArchive_(ss);
  const seen = new Set();
  records.forEach(function(record) {
    const key = normalizeKey_((record.fields || {})['Product Key']);
    if (!key || seen.has(key)) throw new Error('Unsafe Airtable Product Keys; cleanup aborted.');
    seen.add(key);
  });
  const requested = opts.productKeys ? new Set(opts.productKeys.map(normalizeKey_)) : null;
  const summary = { eligible: [], archived: 0, cleared: 0, socialRetired: 0, removed: 0, failures: [] };
  const now = Date.now();
  // Include journal-only work: execution may have stopped after clearing the
  // catalog, or after a successful remote delete but before its acknowledgement.
  const keys = new Set(catalog.rows.map(function(row) { return normalizeKey_(row[catalog.map['PRODUCT KEY']]); }));
  archive.rows.forEach(function(row) {
    if (['RETIRING', 'ARCHIVED', 'AIRTABLE REMOVED'].indexOf(row[archive.map['CLEANUP STATE']]) >= 0) keys.add(normalizeKey_(row[archive.map['PRODUCT KEY']]));
  });
  keys.forEach(function(key) {
    const cm = catalog.map;
    if (!key || (requested && !requested.has(key))) return;
    try {
      let archivedRow = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
      let state = archivedRow ? catalogText_(archivedRow[archive.map['CLEANUP STATE']]) : '';
      let snapshot = catalog.rows.find(function(row) { return normalizeKey_(row[cm['PRODUCT KEY']]) === key; });
      const get = function(h) { return snapshot ? snapshot[cm[h]] : archivedRow[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; };
      if (state === 'COMPLETE') {
        if (snapshot) throw new Error('Completed Product Key re-entered active Catalog; manual recovery required.');
        return;
      }
      if (snapshot && state === 'ARCHIVED' && archivedRow[archive.map['SOURCE EVIDENCE']]) {
        throw new Error('Finalized retired Product Key re-entered Catalog; manual recovery required.');
      }
      if (snapshot && state !== 'AIRTABLE REMOVED') {
        // Do not re-read the whole Catalog for obviously ineligible products.
        // Only the small confirmed-zero transition set needs fresh row checks.
        const initial = archivedRow && archivedRow[archive.map['SOURCE EVIDENCE']] ?
          catalogArchivedStock_(ss, function(h) { return archivedRow[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; }, archivedRow, archive.map, evidence) :
          catalogConfirmedStock_(ss, get, evidence);
        if (initial.state !== 'CONFIRMED ZERO') {
          if (state === 'RETIRING' && catalogConfirmedStock_(ss, get, evidence).state === 'IN STOCK') {
            setCatalogArchiveState_(archive, key, 'CANCELLED');
          }
          return;
        }
        const transitioned = transitionCatalogSoldOut_(ss, catalogSheet, key, archive, token, evidence, summary);
        if (!transitioned) return;
        archive = transitioned;
        archivedRow = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
        state = catalogText_(archivedRow[archive.map['CLEANUP STATE']]);
        snapshot = null;
        records = iwaFetchAll_(token);
      }
      const stock = archivedRow ? catalogArchivedStock_(ss, get, archivedRow, archive.map, evidence) :
        catalogConfirmedStock_(ss, get, evidence);
      if (stock.state === 'UNKNOWN' && archivedRow) throw new Error(stock.reason);
      const quantity = stock.quantity;
      if (!snapshot && archivedRow) {
        SpreadsheetApp.flush();
        verifyCatalogRetiredExport_(ss, key);
        if (state === 'RETIRING') { setCatalogArchiveState_(archive, key, 'ARCHIVED'); state = 'ARCHIVED'; }
      }
      const record = records.find(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
      const f = record ? record.fields : {};
      const savedSince = archivedRow ? catalogArchiveValue_(archivedRow[archive.map['SOLD OUT SINCE']]) : undefined;
      const sinceValue = archivedRow ? savedSince : record ? f['Sold Out Since'] : undefined;
      const since = typeof sinceValue === 'string' ? Date.parse(sinceValue) : NaN;
      if (record && archivedRow && (record.id !== archivedRow[archive.map['AIRTABLE RECORD ID']] ||
          f['Sold Out Since'] !== savedSince)) throw new Error('Airtable archived identity/timer changed; manual review required.');
      if (state !== 'AIRTABLE REMOVED') {
        // Destructive cleanup requires fresh source quantity, not stale display
        // status or disappeared export rows. Missing/ambiguous sources fail closed.
        const zero = quantity === 0 && (record
          ? catalogLifecycleStock_(get('WEBSITE CATEGORY') === 'Flooring' ? f['Available Sq Ft'] : undefined, f['Quantity Available']) === 0
          : state === 'ARCHIVED');
        if (!zero || !Number.isFinite(since) || now < since + CATALOG_RETENTION_MS_) {
          return;
        }
      }
      if (summary.eligible.indexOf(key) < 0) summary.eligible.push(key);
      if (!opts.apply) return;
      if (!archivedRow || state === 'CANCELLED') throw new Error('Verified sold-out archive required before cleanup.');
      verifyCatalogArchive_(archive, key);
      verifyCatalogRetiredExport_(ss, key);
      if (state !== 'AIRTABLE REMOVED') {
        // Re-read immediately before deletion to catch restock/uncertainty in a
        // source sheet that can recalculate independently of ScriptLock.
        if (catalogArchivedStock_(ss, get, archivedRow, archive.map).quantity !== 0) throw new Error('Inventory changed before cleanup; retained for retry.');
        const active = readSheetTable_(catalogSheet, 'PRODUCT KEY');
        if (active.rows.some(function(row) { return normalizeKey_(row[active.map['PRODUCT KEY']]) === key; })) {
          throw new Error('Retired Product Key re-entered Catalog; deletion blocked.');
        }
        const current = iwaFetchAll_(token).filter(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
        if (current.length > 1) throw new Error('Duplicate Airtable cleanup identity.');
        if (current.length) {
          const cf = current[0].fields;
          const journal = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
          if (current[0].id !== journal[archive.map['AIRTABLE RECORD ID']] ||
              cf['Sold Out Since'] !== catalogArchiveValue_(journal[archive.map['SOLD OUT SINCE']]) ||
              catalogLifecycleStock_(get('WEBSITE CATEGORY') === 'Flooring' ? cf['Available Sq Ft'] : undefined, cf['Quantity Available']) !== 0) {
            throw new Error('Airtable lifecycle changed before cleanup.');
          }
          iwaRequest_(token, 'delete', '?records[]=' + encodeURIComponent(current[0].id));
          if (iwaFetchAll_(token).some(function(r) { return normalizeKey_(r.fields['Product Key']) === key; })) throw new Error('Airtable removal could not be verified.');
        }
        setCatalogArchiveState_(archive, key, 'AIRTABLE REMOVED');
      }
      // Re-find by key; do not trust cached row positions or shift workbook rows.
      if (iwaFetchAll_(token).some(function(r) { return normalizeKey_(r.fields['Product Key']) === key; })) throw new Error('Airtable product reappeared; catalog retained.');
      catalog = readSheetTable_(catalogSheet, 'PRODUCT KEY');
      const matches = catalog.rows.map(function(row, i) { return { row: row, number: i + 2 }; })
        .filter(function(entry) { return normalizeKey_(entry.row[catalog.map['PRODUCT KEY']]) === key; });
      if (matches.length) throw new Error('Retired Product Key re-entered Catalog; manual recovery required.');
      SpreadsheetApp.flush();
      const remaining = readSheetTable_(catalogSheet, 'PRODUCT KEY');
      if (remaining.rows.some(function(row) { return normalizeKey_(row[remaining.map['PRODUCT KEY']]) === key; })) throw new Error('Active catalog removal not verified.');
      setCatalogArchiveState_(archive, key, 'COMPLETE', new Date().toISOString());
      summary.removed++;
    } catch (error) {
      summary.failures.push({ productKey: key, error: String(error.message || error) });
      console.error('Catalog cleanup retained/retriable: ' + key + ': ' + String(error.message || error));
    }
  });
  return summary;
}

// First phase: retire active merchandise immediately, without deleting remote
// records. The same archive journal resumes interrupted transitions.
function transitionCatalogSoldOut_(ss, sheet, key, archive, token, evidence, summary) {
  const table = readSheetTable_(sheet, 'PRODUCT KEY');
  const matches = table.rows.map(function(row, i) { return { row: row, number: i + 2 }; })
    .filter(function(entry) { return normalizeKey_(entry.row[table.map['PRODUCT KEY']]) === key; });
  if (matches.length !== 1) throw new Error('Ambiguous immediate Catalog identity.');
  const entry = matches[0], get = function(h) { return entry.row[table.map[h]]; };
  let archived = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
  const pending = archived && archived[archive.map['CLEANUP STATE']] === 'RETIRING' && archived[archive.map['SOURCE EVIDENCE']];
  const stock = pending ? catalogArchivedStock_(ss, function(h) {
    return archived[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]];
  }, archived, archive.map, evidence) : catalogConfirmedStock_(ss, get, evidence);
  if (stock.state !== 'CONFIRMED ZERO') {
    if (pending && catalogConfirmedStock_(ss, get, evidence).state === 'IN STOCK') setCatalogArchiveState_(archive, key, 'CANCELLED');
    return null;
  }
  const post = table.map['POST TO WEBSITE'];
  if (entry.row[post] !== 'No') sheet.getRange(entry.number, post + 1).setValue('No');
  entry.row[post] = 'No';
  if (!pending) {
    // Fresh exact-key lookup immediately before the narrow remote observation.
    const records = iwaFetchAll_(token).filter(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
    if (records.length > 1) throw new Error('Duplicate Airtable transition identity.');
    const remote = records[0], fields = remote ? remote.fields : {};
    const previousSince = fields['Sold Out Since'];
    if (previousSince != null && previousSince !== '' && !Number.isFinite(Date.parse(previousSince))) {
      throw new Error('Invalid Sold Out Since; manual review required.');
    }
    const since = previousSince || new Date().toISOString();
    if (remote) {
      const observed = { 'Quantity Available': 0, Status: 'Sold Out', 'Sold Out Since': since };
      if (get('WEBSITE CATEGORY') === 'Flooring') observed['Available Sq Ft'] = 0;
      // Preserve Photos, pricing and current display permission. Never create a
      // record for merchandise the owner has never published.
      if (iwaOwnedFieldsChanged_(observed, fields)) iwaRequest_(token, 'patch', '', { records: [{ id: remote.id, fields: observed }] });
      const readback = iwaFetchAll_(token).filter(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
      if (readback.length !== 1 || readback[0].id !== remote.id || iwaOwnedFieldsChanged_(observed, readback[0].fields)) {
        throw new Error('Sold-out Airtable observation not verified.');
      }
    }
    const values = [key, get('PRODUCT ID'), get('RETAILER'), get('RETAIL SKU'), get('DISPLAY NAME'), get('SOURCE ITEM'),
      get('WEBSITE CATEGORY'), get('WEB SUBCATEGORY'), since, new Date().toISOString(), '',
      get('SELL PRICE ($/SQ FT OR EACH)'), get('COMPARABLE RETAIL PRICE'), 0, get('PRODUCT URL'), 'RETIRING', remote ? remote.id : ''];
    const manifest = JSON.stringify({ version: 1, rows: catalogSourceRowsSnapshot_(stock), remoteAbsent: !remote,
      catalogValues: entry.row.map(function(value, i) { return i === table.map['AUTO BOX PRICE'] ? null : catalogArchiveValue_(value); }) });
    if (manifest.length > 45000) throw new Error('Source snapshot too large; manual review required.');
    archive = writeCatalogArchive_(ss, archive, values, archived ? key : null, manifest);
    summary.archived++;
    archived = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
  }
  verifyCatalogArchive_(archive, key);
  const frozen = JSON.parse(archived[archive.map['SOURCE EVIDENCE']]);
  const archivedGet = function(h) { return archived[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; };
  // Before clearing, a source correction can cancel; after clearing, recovery
  // is manual and must never resurrect this key.
  if (catalogArchivedStock_(ss, archivedGet, archived, archive.map).state !== 'CONFIRMED ZERO') {
    const freshStock = catalogConfirmedStock_(ss, archivedGet);
    if (freshStock.state === 'IN STOCK') setCatalogArchiveState_(archive, key, 'CANCELLED');
    throw new Error('Source changed before active retirement; Catalog retained.');
  }
  const fresh = readSheetTable_(sheet, 'PRODUCT KEY');
  const current = fresh.rows.map(function(row, i) { return { row: row, number: i + 2 }; })
    .filter(function(item) { return normalizeKey_(item.row[fresh.map['PRODUCT KEY']]) === key; });
  if (current.length !== 1) throw new Error('Active identity changed before retirement.');
  const segments = catalogNonspillSegments_(fresh.width, fresh.map['AUTO BOX PRICE']);
  segments.forEach(function(segment) {
    const actual = current[0].row.slice(segment[0], segment[0] + segment[1]);
    const saved = frozen.catalogValues.slice(segment[0], segment[0] + segment[1]);
    if (actual.some(function(value) { return value !== '' && value != null; }) &&
        JSON.stringify(actual.map(catalogArchiveValue_)) !== JSON.stringify(saved)) {
      throw new Error('Catalog changed after archive; owner edits retained for manual review.');
    }
  });
  summary.socialRetired += retireCatalogSocialKey_(ss, key);
  if (catalogArchivedStock_(ss, archivedGet, archived, archive.map).state !== 'CONFIRMED ZERO') {
    throw new Error('Source changed after social retirement; active Catalog retained for retry.');
  }
  segments.forEach(function(segment) { sheet.getRange(current[0].number, segment[0] + 1, 1, segment[1]).clearContent(); });
  SpreadsheetApp.flush();
  const remaining = readSheetTable_(sheet, 'PRODUCT KEY');
  if (remaining.rows.some(function(row) { return normalizeKey_(row[remaining.map['PRODUCT KEY']]) === key; })) {
    throw new Error('Immediate Catalog retirement not verified.');
  }
  verifyCatalogRetiredExport_(ss, key);
  setCatalogArchiveState_(archive, key, 'ARCHIVED');
  summary.cleared++;
  summary.eligible.push(key);
  return readCatalogArchive_(ss);
}

function verifyCatalogRetiredExport_(ss, key) {
  const table = readSheetTable_(getInventorySheetOrThrow_(ss, IWA_SYNC_HARDENED.EXPORT_SHEET), 'PRODUCT KEY');
  if (table.rows.some(function(row) { return normalizeKey_(row[table.map['PRODUCT KEY']]) === key; })) {
    throw new Error('Retired Product Key still in Export; wait for formula recalculation and retry.');
  }
}

// Complete read-only migration/cleanup snapshot. Fresh source, archive and
// identity checks remain mandatory before Catalog retirement/remote deletion.
function previewSoldOutCatalogLocked_(opts) {
  const started = Date.now();
  const stageMs = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  iwaApprovedConfiguration_();
  const catalogSheet = getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  getCatalogColumns_(catalogSheet);
  const catalog = readSheetTable_(catalogSheet, 'PRODUCT KEY');
  if (catalogIdentityFindings_(catalog.rows, catalog.map).length) throw new Error('Unsafe catalog identities; cleanup aborted.');
  stageMs.catalogReadAndIdentity = Date.now() - started;
  const archive = readCatalogArchive_(ss); // Validate every snapshot hash, including completed history.
  stageMs.archiveReadAndHash = Date.now() - started - stageMs.catalogReadAndIdentity;
  const evidence = indexCatalogSourceEvidence_(readCatalogSourceEvidence_(ss));
  stageMs.sourceAndInventoryReadAndIndex = Date.now() - started - stageMs.catalogReadAndIdentity - stageMs.archiveReadAndHash;
  const token = PropertiesService.getScriptProperties().getProperty(IWA_SYNC_HARDENED.TOKEN_PROPERTY);
  if (!token) throw new Error('Missing Airtable token.');
  iwaRequest_.callCount_ = 0;
  const records = iwaFetchAll_(token, ['Product Key', 'Sold Out Since', 'Available Sq Ft', 'Quantity Available']);
  stageMs.airtableFetch = Date.now() - started - stageMs.catalogReadAndIdentity -
    stageMs.archiveReadAndHash - stageMs.sourceAndInventoryReadAndIndex;
  const remoteByKey = new Map();
  records.forEach(function(record) {
    const key = normalizeKey_((record.fields || {})['Product Key']);
    if (!key || remoteByKey.has(key)) throw new Error('Unsafe Airtable Product Keys; cleanup aborted.');
    remoteByKey.set(key, record);
  });
  const catalogByKey = new Map();
  catalog.rows.forEach(function(row) {
    const key = normalizeKey_(row[catalog.map['PRODUCT KEY']]);
    if (key) catalogByKey.set(key, row);
  });
  const archiveByKey = new Map();
  archive.rows.forEach(function(row) {
    const key = normalizeKey_(row[archive.map['PRODUCT KEY']]);
    if (key) archiveByKey.set(key, row);
  });
  const requested = opts.productKeys ? new Set(opts.productKeys.map(normalizeKey_)) : null;
  const keys = new Set(catalogByKey.keys());
  archiveByKey.forEach(function(row, key) {
    if (['RETIRING', 'ARCHIVED', 'AIRTABLE REMOVED'].indexOf(row[archive.map['CLEANUP STATE']]) >= 0) keys.add(key);
  });
  const now = Date.now();
  const queue = ss.getSheetByName('Social Queue');
  const socialRows = queue && queue.getLastRow() > 1 ? queue.getRange(2, 1, queue.getLastRow() - 1, 19).getValues() : [];
  const summary = { eligible: [], archived: 0, removed: 0, failures: [],
    eligibleDetails: [], rejected: [],
    counts: { active: catalogByKey.size, confirmedPositive: 0, confirmedZero: 0,
      unknown: 0, withSoldOutSince: 0, expired: 0, rejected: 0 },
    metrics: { airtableApiCalls: 0, elapsedMs: 0, complete: false, stageMs: stageMs } };
  keys.forEach(function(key) {
    if (!key || (requested && !requested.has(key))) return;
    try {
      const snapshot = catalogByKey.get(key);
      const archivedRow = archiveByKey.get(key);
      const state = archivedRow ? catalogText_(archivedRow[archive.map['CLEANUP STATE']]) : '';
      const get = function(h) { return snapshot ? snapshot[catalog.map[h]] : archivedRow[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; };
      const stock = archivedRow && archivedRow[archive.map['SOURCE EVIDENCE']] ?
        catalogArchivedStock_(ss, function(h) { return archivedRow[archive.map[h === 'WEBSITE CATEGORY' ? 'CATEGORY' : h]]; }, archivedRow, archive.map, evidence) :
        catalogConfirmedStock_(ss, get, evidence);
      if (snapshot) {
        if (stock.state === 'IN STOCK') summary.counts.confirmedPositive++;
        else if (stock.state === 'CONFIRMED ZERO') summary.counts.confirmedZero++;
        else summary.counts.unknown++;
      }
      const record = remoteByKey.get(key);
      const fields = record ? record.fields : {};
      const savedSince = archivedRow ? catalogArchiveValue_(archivedRow[archive.map['SOLD OUT SINCE']]) : undefined;
      const sinceValue = record ? fields['Sold Out Since'] : savedSince;
      const since = typeof sinceValue === 'string' ? Date.parse(sinceValue) : NaN;
      if (snapshot && sinceValue !== '' && sinceValue != null) summary.counts.withSoldOutSince++;
      if (snapshot && Number.isFinite(since) && now >= since + CATALOG_RETENTION_MS_) summary.counts.expired++;
      let reason = '';
      let action = snapshot ? 'ARCHIVE AND RETIRE ACTIVE' : 'DELETE EXPIRED AIRTABLE';
      if (state === 'COMPLETE') reason = 'ARCHIVE COMPLETE';
      else if (snapshot && state !== 'AIRTABLE REMOVED') {
        if (stock.state !== 'CONFIRMED ZERO') reason = stock.state === 'UNKNOWN' ? 'UNKNOWN SOURCE OR INVENTORY' : 'POSITIVE SOURCE';
        else if (sinceValue != null && sinceValue !== '' && !Number.isFinite(since)) reason = 'MISSING OR INVALID SOLD OUT SINCE';
      }
      else if (state !== 'AIRTABLE REMOVED') {
        const zero = stock.quantity === 0 && (record
          ? catalogLifecycleStock_(get('WEBSITE CATEGORY') === 'Flooring' ? fields['Available Sq Ft'] : undefined,
              fields['Quantity Available']) === 0
          : state === 'ARCHIVED');
        if (!zero) reason = stock.state === 'UNKNOWN' ? 'UNKNOWN SOURCE OR INVENTORY' :
          stock.state === 'IN STOCK' ? 'POSITIVE SOURCE' : 'NO CONFIRMED ZERO REMOTE';
        else if (!Number.isFinite(since)) reason = 'MISSING OR INVALID SOLD OUT SINCE';
        else if (now < since + CATALOG_RETENTION_MS_) reason = 'TEN DAY RETENTION NOT ELAPSED';
        else if (!archivedRow) reason = 'VERIFIED ARCHIVE MISSING';
        else if (record && (record.id !== archivedRow[archive.map['AIRTABLE RECORD ID']] || sinceValue !== savedSince)) reason = 'AIRTABLE IDENTITY OR TIMER CHANGED';
      }
      if (reason) {
        summary.rejected.push({ productKey: key, reason: reason });
        summary.counts.rejected++;
        return;
      }
      summary.eligible.push(key);
      summary.eligibleDetails.push({ productKey: key, displayName: get('DISPLAY NAME'),
        action: action, archiveState: state || 'NONE', soldOutSince: sinceValue || 'FIRST CONFIRMED ZERO OBSERVATION ON APPLY',
        reason: snapshot ? 'Confirmed zero; immediate active retirement' : 'Verified archive and ten-day retention elapsed',
        remoteIdentity: record ? 'MATCHED' : 'ABSENT — NEVER CREATE', airtableRecordId: record ? record.id : '',
        socialOccurrences: socialRows.filter(function(row) { return normalizeKey_(row[0]) === key; })
          .map(function(row) { return { status: row[12], receiptBearing: !!(row[13] || row[14] || row[15]) }; }),
        laterAcquisitions: stock.laterAcquisitions || 0 });
    } catch (error) {
      summary.failures.push({ productKey: key, error: String(error.message || error) });
      summary.counts.rejected++;
    }
  });
  summary.metrics.airtableApiCalls = iwaRequest_.callCount_ || 0;
  summary.metrics.elapsedMs = Date.now() - started;
  stageMs.indexAndMatch = summary.metrics.elapsedMs - stageMs.catalogReadAndIdentity -
    stageMs.archiveReadAndHash - stageMs.sourceAndInventoryReadAndIndex - stageMs.airtableFetch;
  summary.metrics.complete = true;
  console.log('Cleanup preview (read-only): ' + JSON.stringify({ counts: summary.counts,
    eligible: summary.eligibleDetails, failures: summary.failures,
    metrics: summary.metrics }));
  return summary;
}

function writeCatalogArchive_(ss, archive, values, replaceKey, sourceEvidence) {
  if (!archive.sheet) {
    const sheet = ss.insertSheet(CATALOG_ARCHIVE_SHEET_);
    sheet.getRange(1, 1, 1, CATALOG_ARCHIVE_HEADERS_.length).setValues([CATALOG_ARCHIVE_HEADERS_.slice()]);
    archive = readCatalogArchive_(ss);
  }
  if (sourceEvidence && archive.map['SOURCE EVIDENCE'] === undefined) {
    // Additive archive metadata only; Catalog/Export remain exactly 29 columns.
    archive.sheet.getRange(1, CATALOG_ARCHIVE_HEADERS_.length + 1).setValue('SOURCE EVIDENCE');
    archive = readCatalogArchive_(ss);
  }
  const existing = replaceKey ? archive.rows.findIndex(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === replaceKey; }) : -1;
  const row = existing >= 0 ? existing + 2 : archive.rows.length + 2;
  if (row > archive.sheet.getMaxRows()) archive.sheet.insertRowsAfter(archive.sheet.getMaxRows(), row - archive.sheet.getMaxRows());
  const ordered = new Array(archive.sheet.getLastColumn()).fill('');
  CATALOG_ARCHIVE_HEADERS_.forEach(function(header, i) { ordered[archive.map[header]] = values[i]; });
  if (sourceEvidence) ordered[archive.map['SOURCE EVIDENCE']] = sourceEvidence;
  ordered[archive.map['SNAPSHOT HASH']] = catalogArchiveHash_(ordered, archive.map);
  archive.sheet.getRange(row, 1, 1, ordered.length).setValues([ordered]);
  SpreadsheetApp.flush();
  const stored = archive.sheet.getRange(row, 1, 1, ordered.length).getValues()[0];
  if (ordered.some(function(v, i) { return String(catalogArchiveValue_(v)) !== String(catalogArchiveValue_(stored[i])); })) throw new Error('Archive write readback mismatch.');
  return readCatalogArchive_(ss);
}

function verifyCatalogArchive_(archive, key) {
  const fresh = readCatalogArchive_(SpreadsheetApp.getActiveSpreadsheet());
  const rows = fresh.rows.filter(function(row) { return normalizeKey_(row[fresh.map['PRODUCT KEY']]) === key; });
  if (rows.length !== 1 || !catalogText_(rows[0][fresh.map['ARCHIVED AT']]) ||
      !catalogText_(rows[0][fresh.map['SOURCE ITEM']]) ||
      (!catalogText_(rows[0][fresh.map['AIRTABLE RECORD ID']]) &&
        !(fresh.map['SOURCE EVIDENCE'] !== undefined && rows[0][fresh.map['SOURCE EVIDENCE']] &&
          JSON.parse(rows[0][fresh.map['SOURCE EVIDENCE']]).remoteAbsent === true)) ||
      !Number.isFinite(Date.parse(rows[0][fresh.map['SOLD OUT SINCE']])) ||
      rows[0][fresh.map['SNAPSHOT HASH']] !== catalogArchiveHash_(rows[0], fresh.map)) {
    throw new Error('Archive not verified; active product retained.');
  }
}

function catalogArchiveHash_(row, map) {
  const payload = CATALOG_ARCHIVE_HEADERS_.filter(function(h) {
    return ['REMOVED AT', 'CLEANUP STATE', 'SNAPSHOT HASH'].indexOf(h) < 0;
  }).map(function(h) {
    const value = row[map[h]];
    // Native Sheets may return dates as Date objects; hash the same UTC ISO value.
    return catalogArchiveValue_(value);
  });
  // Backward-compatible hashes: legacy snapshots have no source manifest.
  if (map['SOURCE EVIDENCE'] !== undefined && row[map['SOURCE EVIDENCE']]) payload.push(row[map['SOURCE EVIDENCE']]);
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payload), Utilities.Charset.UTF_8));
}

function catalogArchiveValue_(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function setCatalogArchiveState_(archive, key, state, removedAt) {
  const fresh = readCatalogArchive_(SpreadsheetApp.getActiveSpreadsheet());
  const index = fresh.rows.findIndex(function(row) { return normalizeKey_(row[fresh.map['PRODUCT KEY']]) === key; });
  if (index < 0) throw new Error('Archive state target missing.');
  if (removedAt) fresh.sheet.getRange(index + 2, fresh.map['REMOVED AT'] + 1).setValue(removedAt);
  fresh.sheet.getRange(index + 2, fresh.map['CLEANUP STATE'] + 1).setValue(state);
  SpreadsheetApp.flush();
  if (fresh.sheet.getRange(index + 2, fresh.map['CLEANUP STATE'] + 1).getValue() !== state) throw new Error('Archive state not persisted.');
}
