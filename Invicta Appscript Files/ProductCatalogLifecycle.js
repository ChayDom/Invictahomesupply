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
    if (key && ['ARCHIVED', 'AIRTABLE REMOVED', 'COMPLETE', 'CANCELLED'].indexOf(row[table.map['CLEANUP STATE']]) < 0) throw new Error('Invalid archive cleanup state: ' + key);
    if (key && keys.has(key)) throw new Error('Duplicate archive Product Key: ' + key);
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
    if (matches.some(function(row) { return row[archive.map['CLEANUP STATE']] !== 'COMPLETE'; })) return [];
    if (!(typeof source.quantityAvailable === 'number' && Number.isFinite(source.quantityAvailable) && source.quantityAvailable > 0)) return [];
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const catalogSheet = getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  getCatalogColumns_(catalogSheet);
  let catalog = readSheetTable_(catalogSheet, 'PRODUCT KEY');
  if (catalogIdentityFindings_(catalog.rows, catalog.map).length) throw new Error('Unsafe catalog identities; cleanup aborted.');
  const inventorySheet = getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET);
  const inventory = readSheetTable_(inventorySheet, 'PRODUCT ID');
  requireHeaders_(inventory.map, ['QUANTITY AVAILABLE'], 'Product Inventory cleanup');
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
  const summary = { eligible: [], archived: 0, removed: 0, failures: [] };
  const now = Date.now();
  // Include journal-only work: execution may have stopped after clearing the
  // catalog, or after a successful remote delete but before its acknowledgement.
  const keys = new Set(catalog.rows.map(function(row) { return normalizeKey_(row[catalog.map['PRODUCT KEY']]); }));
  archive.rows.forEach(function(row) {
    if (['ARCHIVED', 'AIRTABLE REMOVED'].indexOf(row[archive.map['CLEANUP STATE']]) >= 0) keys.add(normalizeKey_(row[archive.map['PRODUCT KEY']]));
  });
  keys.forEach(function(key) {
    const cm = catalog.map;
    if (!key || (requested && !requested.has(key))) return;
    try {
      const archivedRow = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
      const state = archivedRow ? catalogText_(archivedRow[archive.map['CLEANUP STATE']]) : '';
      const snapshot = catalog.rows.find(function(row) { return normalizeKey_(row[cm['PRODUCT KEY']]) === key; });
      const get = function(h) { return snapshot ? snapshot[cm[h]] : archivedRow[archive.map[h]]; };
      if (state === 'COMPLETE') return;
      const sourceRows = inventory.rows.filter(function(row) {
        const sourceId = currentProductId_(row[inventory.map['RETAILER']], row[inventory.map['RETAIL SKU']]) || normalizeKey_(row[inventory.map['PRODUCT ID']]);
        return sourceId === normalizeKey_(get('PRODUCT ID')) ||
          normalizeKey_(row[inventory.map['PRODUCT KEY']]) === key;
      });
      const quantity = sourceRows.length === 1 ? sourceRows[0][inventory.map['QUANTITY AVAILABLE']] : undefined;
      const record = records.find(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
      const f = record ? record.fields : {};
      const savedSince = archivedRow ? archivedRow[archive.map['SOLD OUT SINCE']] : undefined;
      const sinceValue = record ? f['Sold Out Since'] : savedSince;
      const since = typeof sinceValue === 'string' ? Date.parse(sinceValue) : NaN;
      if (state !== 'AIRTABLE REMOVED') {
        // Destructive cleanup requires fresh source quantity, not stale display
        // status or disappeared export rows. Missing/ambiguous sources fail closed.
        const zero = quantity === 0 && (record
          ? catalogLifecycleStock_(get('WEBSITE CATEGORY') === 'Flooring' ? f['Available Sq Ft'] : undefined, f['Quantity Available']) === 0
          : state === 'ARCHIVED');
        if (!zero || !Number.isFinite(since) || now < since + CATALOG_RETENTION_MS_) {
          if (archivedRow && record && quantity !== 0) {
            if (opts.apply) setCatalogArchiveState_(archive, key, 'CANCELLED');
          }
          return;
        }
        if (!snapshot) throw new Error('Catalog missing before verified Airtable removal.');
      }
      summary.eligible.push(key);
      if (!opts.apply) return;
      // A cancelled attempt never removed anything. Re-arm that same journal
      // row only after a new confirmed-zero interval has completely elapsed.
      if (!archivedRow || state === 'CANCELLED' || (record && savedSince !== sinceValue)) {
        const values = [get('PRODUCT KEY'), get('PRODUCT ID'), get('RETAILER'), get('RETAIL SKU'),
          get('DISPLAY NAME'), get('SOURCE ITEM'), get('WEBSITE CATEGORY'), get('WEB SUBCATEGORY'),
          f['Sold Out Since'], new Date(now).toISOString(), '', get('SELL PRICE ($/SQ FT OR EACH)'),
          get('COMPARABLE RETAIL PRICE'), quantity, get('PRODUCT URL'), 'ARCHIVED', record.id];
        archive = writeCatalogArchive_(ss, archive, values, archivedRow ? key : null);
        summary.archived++;
      }
      verifyCatalogArchive_(archive, key);
      if (state !== 'AIRTABLE REMOVED') {
        // Re-read immediately before deletion to catch restock/uncertainty in a
        // source sheet that can recalculate independently of ScriptLock.
        const fresh = readSheetTable_(inventorySheet, 'PRODUCT ID');
        const freshRow = fresh.rows.filter(function(row) {
          return (currentProductId_(row[fresh.map['RETAILER']], row[fresh.map['RETAIL SKU']]) || normalizeKey_(row[fresh.map['PRODUCT ID']])) === normalizeKey_(get('PRODUCT ID'));
        });
        if (freshRow.length !== 1 || freshRow[0][fresh.map['QUANTITY AVAILABLE']] !== 0) throw new Error('Inventory changed before cleanup; retained for retry.');
        const current = iwaFetchAll_(token).filter(function(r) { return normalizeKey_(r.fields['Product Key']) === key; });
        if (current.length > 1) throw new Error('Duplicate Airtable cleanup identity.');
        if (current.length) {
          const cf = current[0].fields;
          const journal = archive.rows.find(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === key; });
          if (current[0].id !== journal[archive.map['AIRTABLE RECORD ID']] || cf['Sold Out Since'] !== sinceValue ||
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
      if (matches.length > 1) throw new Error('Duplicate active key before catalog removal.');
      if (matches.length) {
        const spill = catalog.map['AUTO BOX PRICE'];
        catalogSheet.getRange(matches[0].number, 1, 1, spill).clearContent();
        catalogSheet.getRange(matches[0].number, spill + 2, 1, catalog.width - spill - 1).clearContent();
      }
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

function writeCatalogArchive_(ss, archive, values, replaceKey) {
  if (!archive.sheet) {
    const sheet = ss.insertSheet(CATALOG_ARCHIVE_SHEET_);
    sheet.getRange(1, 1, 1, CATALOG_ARCHIVE_HEADERS_.length).setValues([CATALOG_ARCHIVE_HEADERS_.slice()]);
    archive = readCatalogArchive_(ss);
  }
  const existing = replaceKey ? archive.rows.findIndex(function(row) { return normalizeKey_(row[archive.map['PRODUCT KEY']]) === replaceKey; }) : -1;
  const row = existing >= 0 ? existing + 2 : archive.rows.length + 2;
  if (row > archive.sheet.getMaxRows()) archive.sheet.insertRowsAfter(archive.sheet.getMaxRows(), row - archive.sheet.getMaxRows());
  const ordered = new Array(archive.sheet.getLastColumn()).fill('');
  CATALOG_ARCHIVE_HEADERS_.forEach(function(header, i) { ordered[archive.map[header]] = values[i]; });
  ordered[archive.map['SNAPSHOT HASH']] = catalogArchiveHash_(ordered, archive.map);
  archive.sheet.getRange(row, 1, 1, ordered.length).setValues([ordered]);
  SpreadsheetApp.flush();
  const stored = archive.sheet.getRange(row, 1, 1, ordered.length).getValues()[0];
  if (ordered.some(function(v, i) { return String(v) !== String(stored[i]); })) throw new Error('Archive write readback mismatch.');
  return readCatalogArchive_(ss);
}

function verifyCatalogArchive_(archive, key) {
  const fresh = readCatalogArchive_(SpreadsheetApp.getActiveSpreadsheet());
  const rows = fresh.rows.filter(function(row) { return normalizeKey_(row[fresh.map['PRODUCT KEY']]) === key; });
  if (rows.length !== 1 || !catalogText_(rows[0][fresh.map['ARCHIVED AT']]) ||
      !catalogText_(rows[0][fresh.map['SOURCE ITEM']]) || !catalogText_(rows[0][fresh.map['AIRTABLE RECORD ID']]) ||
      !Number.isFinite(Date.parse(rows[0][fresh.map['SOLD OUT SINCE']])) ||
      rows[0][fresh.map['SNAPSHOT HASH']] !== catalogArchiveHash_(rows[0], fresh.map)) {
    throw new Error('Archive not verified; active product retained.');
  }
}

function catalogArchiveHash_(row, map) {
  const payload = CATALOG_ARCHIVE_HEADERS_.filter(function(h) {
    return ['REMOVED AT', 'CLEANUP STATE', 'SNAPSHOT HASH'].indexOf(h) < 0;
  }).map(function(h) { return row[map[h]]; });
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(payload), Utilities.Charset.UTF_8));
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
