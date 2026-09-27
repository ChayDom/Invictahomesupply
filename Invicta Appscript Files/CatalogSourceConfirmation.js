/** Read-only source confirmation; not an accounting engine or batch registry.
 * Source Evidence mirrors the full retailer/Master evidence, NOT Current Inventory.
 * Lifecycle Inventory is a disposable catalog-keyed observation view for Export.
 */
const CATALOG_SOURCE_SHEET_ = 'Inventory Source Evidence';
const CATALOG_OBSERVATION_SHEET_ = 'Lifecycle Inventory';
const CATALOG_OBSERVATION_HEADERS_ = ['PRODUCT KEY', 'PRODUCT ID', 'QUANTITY AVAILABLE', 'STATE', 'EVIDENCE'];

function readCatalogSourceEvidence_(ss) {
  const sheet = getInventorySheetOrThrow_(ss, CATALOG_SOURCE_SHEET_);
  const table = readSheetTable_(sheet, 'PRODUCT ID');
  requireHeaders_(table.map, ['ITEM', 'RETAILER', 'RETAIL SKU', 'PRODUCT ID', 'BUY QUANTITY', 'BALANCE', 'BUY DATE'], CATALOG_SOURCE_SHEET_);
  const inventory = readSheetTable_(getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET), 'PRODUCT ID');
  table.positiveInventory = inventory.rows.filter(function(row) { return row[inventory.map['QUANTITY AVAILABLE']] > 0; })
    .map(function(row) { return { id: currentProductId_(row[inventory.map.RETAILER], row[inventory.map['RETAIL SKU']]) || normalizeKey_(row[inventory.map['PRODUCT ID']]),
      item: catalogSourceIdentity_(row[inventory.map.RETAILER], row[inventory.map.ITEM]) }; });
  return table;
}

function catalogConfirmedStock_(ss, get, evidence) {
  const table = evidence || readCatalogSourceEvidence_(ss), map = table.map;
  const retailer = retailerCode_(get('RETAILER')) || normalizeKey_(get('RETAILER'));
  const id = normalizeKey_(get('PRODUCT ID'));
  const item = catalogSourceIdentity_(get('RETAILER'), get('SOURCE ITEM'));
  const candidates = table.rows.filter(function(row) {
    return (retailerCode_(row[map.RETAILER]) || normalizeKey_(row[map.RETAILER])) === retailer;
  }).map(function(row) {
    const skuId = currentProductId_(row[map.RETAILER], row[map['RETAIL SKU']]);
    const stored = normalizeKey_(row[map['PRODUCT ID']]);
    return { row: row, id: skuId || stored, stored: stored,
      conflict: !!(skuId && stored && !/^(LEG-|LEGACY\|)/.test(stored) && skuId !== stored) };
  });
  let matches = candidates.filter(function(entry) { return entry.id === id || entry.stored === id; });
  if (!matches.length && item) {
    matches = candidates.filter(function(entry) {
      return catalogSourceIdentity_(entry.row[map.RETAILER], entry.row[map.ITEM]) === item;
    });
    if (new Set(matches.map(function(entry) { return entry.id; })).size !== 1) {
      return { state: 'UNKNOWN', quantity: '', reason: 'Missing or ambiguous source identity' };
    }
  }
  if (!matches.length || matches.some(function(entry) { return !entry.id || entry.conflict; })) {
    return { state: 'UNKNOWN', quantity: '', reason: 'Missing/conflicting source identity' };
  }
  let total = 0, unreliable = false;
  matches.forEach(function(entry) {
    const balance = entry.row[map.BALANCE], purchased = entry.row[map['BUY QUANTITY']];
    if (typeof purchased !== 'number' || !Number.isFinite(purchased) || purchased <= 0 ||
        typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0 || balance > purchased) unreliable = true;
    else total += balance;
  });
  // A known positive row safely proves stock exists, but incomplete aggregation
  // must not publish a fabricated exact available quantity/material sufficiency.
  if (unreliable) return { state: 'UNKNOWN', quantity: '', reason: 'Unreliable matching balance; no exact total' };
  if (total === 0 && table.positiveInventory.some(function(entry) { return entry.id === id || entry.item === item; })) {
    return { state: 'UNKNOWN', quantity: '', reason: 'Positive inventory contradicts zero source; reconcile before lifecycle' };
  }
  return { state: total > 0 ? 'IN STOCK' : 'CONFIRMED ZERO', quantity: total,
    reason: matches.length + ' matching valid source rows', rows: matches.map(function(entry) { return entry.row; }), map: map };
}

function refreshCatalogLifecycleInventory_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  const catalog = readSheetTable_(getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET), 'PRODUCT KEY');
  const evidence = readCatalogSourceEvidence_(ss); // One bounded read per refresh.
  const rows = catalog.rows.filter(function(row) { return catalogText_(row[catalog.map['PRODUCT KEY']]); }).map(function(row) {
    const get = function(header) { return row[catalog.map[header]]; };
    const stock = catalogConfirmedStock_(ss, get, evidence);
    return [get('PRODUCT KEY'), get('PRODUCT ID'), stock.quantity, stock.state, stock.reason];
  });
  let sheet = ss.getSheetByName(CATALOG_OBSERVATION_SHEET_);
  if (!sheet) sheet = ss.insertSheet(CATALOG_OBSERVATION_SHEET_);
  const previous = sheet.getLastRow();
  const needed = rows.length + 1;
  if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  sheet.getRange(1, 1, 1, CATALOG_OBSERVATION_HEADERS_.length).setValues([CATALOG_OBSERVATION_HEADERS_]);
  if (rows.length) sheet.getRange(2, 1, rows.length, CATALOG_OBSERVATION_HEADERS_.length).setValues(rows);
  if (previous > needed) sheet.getRange(needed + 1, 1, previous - needed, CATALOG_OBSERVATION_HEADERS_.length).clearContent();
  SpreadsheetApp.flush();
  return rows;
}

function catalogSourceHasLaterPurchase_(ss, source, retired, archiveMap) {
  const stock = catalogConfirmedStock_(ss, function(header) {
    return { RETAILER: source.retailer, 'PRODUCT ID': source.productId, 'SOURCE ITEM': source.item }[header];
  });
  const lastArchive = Math.max.apply(null, retired.map(function(row) { return Date.parse(catalogArchiveValue_(row[archiveMap['ARCHIVED AT']])); }));
  if (stock.state !== 'IN STOCK' || !Number.isFinite(lastArchive)) return false;
  return stock.rows.some(function(row) {
    const raw = row[stock.map['BUY DATE']];
    const date = raw instanceof Date ? raw.getTime() : typeof raw === 'number' ? (raw - 25569) * 86400000 : Date.parse(raw);
    return row[stock.map.BALANCE] > 0 && Number.isFinite(date) && date > lastArchive;
  });
}
