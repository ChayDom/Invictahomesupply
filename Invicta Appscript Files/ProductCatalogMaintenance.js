/**
 * One reconciliation planner for maintenance and legacy preview. All matching
 * and duplicate checks finish before writes; established keys are never changed.
 */
function inventorySources_(table) {
  requireHeaders_(table.map, ['PRODUCT KEY', 'PRODUCT ID', 'RETAIL SKU', 'RETAILER'], 'Product Inventory');
  const itemHeader = table.map['ITEM'] !== undefined ? 'ITEM' : 'SOURCE ITEM';
  requireHeaders_(table.map, [itemHeader], 'Product Inventory');
  const value = function(row, header) { return catalogText_(row[table.map[header]]); };
  return table.rows.filter(function(row) { return row.some(function(v) { return catalogText_(v); }); })
    .map(function(row) {
      const retailer = value(row, 'RETAILER');
      const retailSku = value(row, 'RETAIL SKU');
      const productId = currentProductId_(retailer, retailSku) || value(row, 'PRODUCT ID') || value(row, 'PRODUCT KEY');
      const productKey = value(row, 'PRODUCT KEY') || productId;
      const item = value(row, itemHeader);
      if (!retailer || !item || !productId || !productKey) {
        throw new Error('Incomplete Product Inventory identity; retailer, item and product identity are required.');
      }
      const fields = {};
      // Optional structured source attributes, when supplied; manual publishing
      // controls/prices/images are deliberately outside source ownership.
      ['DISPLAY NAME', 'BRAND', 'MODEL', 'UNIT TYPE', 'SQ FT PER UNIT',
        'PRODUCT URL', 'DESCRIPTION', 'HIGHLIGHTS', 'THICKNESS MM', 'WEAR LAYER MIL',
        'UNDERLAYMENT ATTACHED', 'WATER RESISTANCE', 'CARD SPEC 1', 'CARD SPEC 2', 'CARD SPEC 3']
        .forEach(function(header) {
          if (table.map[header] !== undefined && catalogText_(row[table.map[header]])) {
            fields[header] = row[table.map[header]];
          }
        });
      return { retailer: retailer, retailSku: retailSku, productId: productId, fields: fields,
        quantityAvailable: table.map['QUANTITY AVAILABLE'] !== undefined ? row[table.map['QUANTITY AVAILABLE']] : undefined,
        productKey: productKey, item: item,
        category: value(row, 'WEBSITE CATEGORY') || value(row, 'CATEGORY'),
        subcategory: value(row, 'WEB SUBCATEGORY') || value(row, 'SUBCATEGORY') };
    });
}

function catalogIdentityFindings_(rows, map) {
  const findings = [];
  const groups = ['PRODUCT KEY', 'PRODUCT ID', 'RETAILER + RETAIL SKU'];
  const indexes = groups.map(function() { return new Map(); });
  rows.forEach(function(row, index) {
    // Formula-only spill rows are not products.
    if (!['PRODUCT KEY', 'PRODUCT ID', 'SOURCE ITEM', 'DISPLAY NAME'].some(function(h) {
      return catalogText_(row[map[h]]);
    })) return;
    const key = normalizeKey_(row[map['PRODUCT KEY']]);
    const id = normalizeKey_(row[map['PRODUCT ID']]);
    const skuId = currentProductId_(row[map['RETAILER']], row[map['RETAIL SKU']]);
    if (!key) findings.push({ type: 'MISSING PRODUCT KEY', rows: [index + 2] });
    if (!id && catalogText_(row[map['RETAIL SKU']])) {
      findings.push({ type: 'MISSING PRODUCT ID', rows: [index + 2] });
    }
    [key, id, skuId].forEach(function(value, n) {
      if (!value) return;
      if (!indexes[n].has(value)) indexes[n].set(value, []);
      indexes[n].get(value).push(index + 2);
    });
  });
  indexes.forEach(function(index, n) {
    index.forEach(function(rows, key) {
      if (rows.length > 1) findings.push({ type: 'DUPLICATE ' + groups[n], key: key, rows: rows });
    });
  });
  return findings;
}

function planCatalogMaintenance_(sources, rows, map, width) {
  const problems = catalogIdentityFindings_(rows, map);
  if (problems.some(function(f) { return f.type.indexOf('DUPLICATE') === 0 || f.type === 'MISSING PRODUCT KEY'; })) {
    throw new Error('Unsafe catalog identities: ' + JSON.stringify(problems));
  }
  const byKey = new Map(), byId = new Map(), bySku = new Map(), byItem = new Map();
  const add = function(index, identity, rowIndex) {
    if (!identity) return;
    if (!index.has(identity)) index.set(identity, []);
    index.get(identity).push(rowIndex);
  };
  rows.forEach(function(row, i) {
    add(byKey, normalizeKey_(row[map['PRODUCT KEY']]), i);
    add(byId, normalizeKey_(row[map['PRODUCT ID']]), i);
    add(bySku, currentProductId_(row[map['RETAILER']], row[map['RETAIL SKU']]), i);
    add(byItem, catalogSourceIdentity_(row[map['RETAILER']], row[map['SOURCE ITEM']]), i);
  });
  const seenKey = new Set(), seenId = new Set(), claimed = new Set();
  const updates = [], additions = [];
  sources.forEach(function(source) {
    const key = normalizeKey_(source.productKey), id = normalizeKey_(source.productId);
    if (seenKey.has(key) || seenId.has(id)) throw new Error('Duplicate Product Inventory identity: ' + id);
    seenKey.add(key); seenId.add(id);
    const direct = new Set([].concat(byKey.get(key) || [], byId.get(id) || [],
      bySku.get(currentProductId_(source.retailer, source.retailSku)) || []));
    const fallback = byItem.get(catalogSourceIdentity_(source.retailer, source.item)) || [];
    if (direct.size > 1 || (!direct.size && fallback.length > 1)) {
      throw new Error('Ambiguous catalog reconciliation for ' + id + '; no catalog writes applied.');
    }
    const rowIndex = direct.size ? Array.from(direct)[0] : fallback[0];
    if (rowIndex !== undefined) {
      if (claimed.has(rowIndex)) throw new Error('Multiple source products claim catalog row ' + (rowIndex + 2));
      claimed.add(rowIndex);
      const row = rows[rowIndex];
      const changes = sourceCatalogChanges_(source, row, map);
      if (changes.length) updates.push({ rowNumber: rowIndex + 2,
        permanentKey: row[map['PRODUCT KEY']], changes: changes });
    } else {
      if (retailerCode_(source.retailer) && source.retailSku && !currentProductId_(source.retailer, source.retailSku)) {
        throw new Error('Unreliable Retail SKU for new product: ' + id);
      }
      additions.push(buildCatalogRow_(source, map, width));
    }
  });
  // Also catch collisions caused by SKU corrections before applying a plan.
  const projected = rows.map(function(row) { return row.slice(); });
  updates.forEach(function(update) {
    update.changes.forEach(function(change) { projected[update.rowNumber - 2][change.column] = change.value; });
  });
  const findings = catalogIdentityFindings_(projected.concat(additions), map);
  if (findings.length) throw new Error('Catalog plan failed identity audit: ' + JSON.stringify(findings));
  return { updates: updates, additions: additions };
}

function sourceCatalogChanges_(source, row, map) {
  const values = { RETAILER: source.retailer, 'RETAIL SKU': source.retailSku,
    'PRODUCT ID': source.productId, 'SOURCE ITEM': source.item };
  // Missing source SKU is not authority to erase an owner-populated Catalog SKU.
  // Preserve its current identity together; explicit nonblank corrections still apply.
  if (!catalogText_(source.retailSku) && catalogText_(row[map['RETAIL SKU']])) {
    delete values['RETAIL SKU'];
    delete values['PRODUCT ID'];
  }
  Object.keys(source.fields || {}).forEach(function(header) {
    if (!catalogText_(row[map[header]])) values[header] = source.fields[header];
  });
  // Categories are customer-facing. Fill missing ones from source, retain curated values.
  if (!catalogText_(row[map['WEBSITE CATEGORY']])) values['WEBSITE CATEGORY'] = source.category;
  if (!catalogText_(row[map['WEB SUBCATEGORY']])) values['WEB SUBCATEGORY'] = source.subcategory;
  return Object.keys(values).filter(function(header) {
    return catalogText_(row[map[header]]) !== catalogText_(values[header]);
  }).map(function(header) { return { header: header, column: map[header], value: values[header] }; });
}

function buildCatalogRow_(source, map, width) {
  const row = new Array(width).fill('');
  const fields = { 'DISPLAY NAME': source.item, RETAILER: source.retailer,
    'RETAIL SKU': source.retailSku, 'WEBSITE CATEGORY': source.category,
    'WEB SUBCATEGORY': source.subcategory, 'PRODUCT KEY': source.productKey,
    'PRODUCT ID': source.productId, 'SOURCE ITEM': source.item, 'ENRICHMENT STATUS': 'PENDING' };
  Object.keys(fields).forEach(function(header) { row[map[header]] = fields[header]; });
  Object.keys(source.fields || {}).forEach(function(header) { row[map[header]] = source.fields[header]; });
  return row;
}

function readCatalogMaintenancePlan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  getCatalogColumns_(sheet); // Fail on an unexpected schema before writing anything.
  const catalog = readSheetTable_(sheet, 'PRODUCT KEY');
  const inventory = readSheetTable_(getInventorySheetOrThrow_(ss, INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET), 'PRODUCT ID');
  const sources = catalogSourcesForLifecycle_(inventorySources_(inventory), catalog, readCatalogArchive_(ss));
  const plan = planCatalogMaintenance_(sources, catalog.rows, catalog.map, catalog.width);
  plan.normalMaintenanceUpdates = plan.updates.length;
  planCatalogZeroStockPublishingGuard_(ss, catalog, plan);
  return { sheet: sheet, catalog: catalog, plan: plan };
}

// One-way safety override on existing products, using the authoritative source
// confirmation rules. Restock/unknown never grant publishing permission.
function planCatalogZeroStockPublishingGuard_(ss, catalog, plan) {
  const byRow = new Map(plan.updates.map(function(update) { return [update.rowNumber, update]; }));
  const candidates = catalog.rows.map(function(row, index) { return { row: row, number: index + 2 }; })
    .filter(function(entry) {
      return catalogText_(entry.row[catalog.map['PRODUCT KEY']]) &&
        catalogText_(entry.row[catalog.map['POST TO WEBSITE']]).toUpperCase() === 'YES';
    });
  plan.zeroStockPublishingCorrections = [];
  if (!candidates.length) return;
  const evidence = indexCatalogSourceEvidence_(readCatalogSourceEvidence_(ss));
  candidates.forEach(function(entry) {
    const update = byRow.get(entry.number);
    const projected = entry.row.slice();
    if (update) update.changes.forEach(function(change) { projected[change.column] = change.value; });
    const stock = catalogConfirmedStock_(ss, function(header) { return projected[catalog.map[header]]; }, evidence);
    if (stock.state !== 'CONFIRMED ZERO') return;
    const target = update || { rowNumber: entry.number, permanentKey: entry.row[catalog.map['PRODUCT KEY']], changes: [] };
    target.changes.push({ header: 'POST TO WEBSITE', column: catalog.map['POST TO WEBSITE'], value: 'No' });
    if (!update) plan.updates.push(target);
    plan.zeroStockPublishingCorrections.push(target.permanentKey);
  });
}

function applyCatalogMaintenancePlan_(context, includeNew) {
  const sheet = context.sheet, map = context.catalog.map, plan = context.plan;
  plan.updates.forEach(function(update) {
    update.changes.forEach(function(change) {
      sheet.getRange(update.rowNumber, change.column + 1).setValue(change.value);
    });
  });
  if (includeNew && plan.additions.length) {
    const start = context.catalog.rows.length + 2;
    const needed = start + plan.additions.length - 1 - sheet.getMaxRows();
    if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    // Formatting includes the spill column; PASTE_FORMAT cannot overwrite K2 or values.
    if (start > 2) sheet.getRange(start - 1, 1, 1, context.catalog.width)
      .copyTo(sheet.getRange(start, 1, plan.additions.length, context.catalog.width),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    // Only value writes skip the workbook-owned spill column.
    const spillColumn = map['AUTO BOX PRICE'];
    const segments = catalogNonspillSegments_(context.catalog.width, spillColumn);
    segments.forEach(function(segment) {
      if (!segment[1]) return;
      const target = sheet.getRange(start, segment[0] + 1, plan.additions.length, segment[1]);
      target.setValues(plan.additions.map(function(row) { return row.slice(segment[0], segment[0] + segment[1]); }));
    });
    applyNewCatalogValidation_(sheet, start, plan.additions.length, map);
  }
  return { updated: plan.updates.length, added: includeNew ? plan.additions.length : 0 };
}

function applyNewCatalogValidation_(sheet, start, count, map) {
  // Row 2 is the workbook's formatting template when no existing product precedes us.
  const formatRow = start > 2 ? start - 1 : 2;
  ['SELL PRICE ($/SQ FT OR EACH)', 'AUTO BOX PRICE', 'COMPARABLE RETAIL PRICE']
    .forEach(function(header) {
      const column = map[header] + 1;
      const candidates = [sheet.getRange(formatRow, column).getNumberFormat(),
        sheet.getRange(2, column).getNumberFormat(),
        sheet.getRange(formatRow, map['AUTO BOX PRICE'] + 1).getNumberFormat(),
        sheet.getRange(2, map['AUTO BOX PRICE'] + 1).getNumberFormat()];
      const format = candidates.find(catalogCurrencyFormat_) || '$0.00';
      sheet.getRange(start, column, count, 1).setNumberFormat(format);
    });
  ['SQ FT PER UNIT', 'THICKNESS MM', 'WEAR LAYER MIL'].forEach(function(header) {
      sheet.getRange(start, map[header] + 1, count, 1).setNumberFormat('0.00');
    });
  const rules = { 'POST TO WEBSITE': ['Yes', 'No'], 'UNDERLAYMENT ATTACHED': ['Yes', 'No'],
    'WATER RESISTANCE': ['Waterproof', 'Water Resistant', 'Not Water Resistant', 'Unknown'],
    'ENRICHMENT STATUS': ['PENDING', 'PROCESSING', 'ENRICHED - VERIFIED', 'NEEDS REVIEW', 'FAILED', 'STANDARD'] };
  Object.keys(rules).forEach(function(header) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(rules[header], true).setAllowInvalid(false).build();
    sheet.getRange(start, map[header] + 1, count, 1).setDataValidation(rule);
  });
}

function catalogCurrencyFormat_(format) {
  return typeof format === 'string' && /[$€£¥]|USD|EUR|GBP/i.test(format) && /[0#]/.test(format);
}

// Zero-based offset / positive width pairs shared by append and cleanup.
function catalogNonspillSegments_(width, spill) {
  return [[0, spill], [spill + 1, width - spill - 1]].filter(function(segment) { return segment[1] > 0; });
}

// Public handlers retained for existing menus/triggers. One lock and one planner.
function syncProductCatalogKeys() { return runProductCatalogMaintenance(); }
function refreshProductCatalogSourceFields() { return runCatalogMaintenance_(false); }

function runProductCatalogMaintenance() {
  return runCatalogMaintenance_(true);
}

function runCatalogMaintenance_(includeNew) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (catalogCleanupEnabled_()) {
      const cleanup = cleanupSoldOutCatalogLocked_({ apply: true });
      console.log(JSON.stringify({ cleanup: cleanup }));
    }
    const context = readCatalogMaintenancePlan_();
    const summary = applyCatalogMaintenancePlan_(context, includeNew);
    console.log(JSON.stringify({ zeroStockPublishingCorrections: context.plan.zeroStockPublishingCorrections,
      normalMaintenanceUpdates: context.plan.normalMaintenanceUpdates }));
    SpreadsheetApp.flush();
    auditProductCatalogDuplicateKeys({ throwOnIssues: true });
    console.log(JSON.stringify(summary));
    return summary;
  } finally { lock.releaseLock(); }
}

// Compatibility for an old manually selected handler: read-only; never writes K2 or its spill.
function ensureProductCatalogAutoBoxPriceFormulas_() {
  const sheet = getInventorySheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet(), INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  const columns = getCatalogColumns_(sheet);
  if (!sheet.getRange(2, columns.AUTO_BOX_PRICE).getFormula()) {
    throw new Error('AUTO BOX PRICE spill formula is missing. Restore the approved K2 formula manually.');
  }
  return 'AUTO BOX PRICE is workbook-managed; no formulas written.';
}
