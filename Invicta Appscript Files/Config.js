/**
 * Shared workbook contracts. Catalog offsets are resolved from headers,
 * never inferred from the previous layout. Website Export stays formula-driven.
 */
const INVENTORY_CONFIG = Object.freeze({
  PRODUCT_INVENTORY_SHEET: 'Product Inventory',
  PRODUCT_CATALOG_SHEET: 'Product Catalog'
});

const CATALOG_HEADERS = Object.freeze({
  DISPLAY_NAME: 'DISPLAY NAME', RETAILER: 'RETAILER', RETAIL_SKU: 'RETAIL SKU',
  BRAND: 'BRAND', MODEL: 'MODEL', WEBSITE_CATEGORY: 'WEBSITE CATEGORY',
  WEB_SUBCATEGORY: 'WEB SUBCATEGORY', UNIT_TYPE: 'UNIT TYPE',
  SQ_FT_PER_UNIT: 'SQ FT PER UNIT', SELL_PRICE: 'SELL PRICE ($/SQ FT OR EACH)',
  AUTO_BOX_PRICE: 'AUTO BOX PRICE', COMPARABLE_RETAIL_PRICE: 'COMPARABLE RETAIL PRICE',
  POST_TO_WEBSITE: 'POST TO WEBSITE', STOCK_IMAGE_URL: 'STOCK IMAGE URL',
  PRODUCT_URL: 'PRODUCT URL', DESCRIPTION: 'DESCRIPTION', HIGHLIGHTS: 'HIGHLIGHTS',
  THICKNESS_MM: 'THICKNESS MM', WEAR_LAYER_MIL: 'WEAR LAYER MIL',
  UNDERLAYMENT_ATTACHED: 'UNDERLAYMENT ATTACHED', WATER_RESISTANCE: 'WATER RESISTANCE',
  CARD_SPEC_1: 'CARD SPEC 1', CARD_SPEC_2: 'CARD SPEC 2', CARD_SPEC_3: 'CARD SPEC 3',
  ENRICHMENT_STATUS: 'ENRICHMENT STATUS', NOTES: 'NOTES',
  PRODUCT_KEY: 'PRODUCT KEY', PRODUCT_ID: 'PRODUCT ID', SOURCE_ITEM: 'SOURCE ITEM'
});

const ENRICHMENT_CONFIG = Object.freeze({
  MODEL: 'gemini-3.5-flash-lite', BATCH_SIZE: 5,
  API_KEY_PROPERTY: 'GEMINI_API_KEY', HANDLER: 'runCatalogEnrichment'
});

function normalizeHeader_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
}

// Zero-based indexes for row arrays. Reject duplicate headers before any writes.
function buildHeaderMap_(headers) {
  const map = Object.create(null);
  headers.forEach(function(value, index) {
    const header = normalizeHeader_(value);
    if (!header) return;
    if (map[header] !== undefined) throw new Error('Duplicate header: ' + header);
    map[header] = index;
  });
  return map;
}

function requireHeaders_(map, required, name) {
  const missing = required.filter(function(header) { return map[header] === undefined; });
  if (missing.length) throw new Error(name + ' missing required headers: ' + missing.join(', '));
}

function getHeaderMap_(sheet) {
  return buildHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);
}

// One-based indexes exclusively for SpreadsheetApp ranges / existing enrichment helpers.
function getCatalogColumns_(sheet) {
  const map = getHeaderMap_(sheet);
  requireHeaders_(map, Object.values(CATALOG_HEADERS), 'Product Catalog');
  if (Object.keys(map).length !== 29) throw new Error('Product Catalog must have exactly 29 named columns.');
  const columns = {};
  Object.keys(CATALOG_HEADERS).forEach(function(key) { columns[key] = map[CATALOG_HEADERS[key]] + 1; });
  return columns;
}

function readSheetTable_(sheet, identityHeader) {
  const map = getHeaderMap_(sheet);
  // Exclude formula-only tails, but include partially populated product rows so
  // an orphan identity cannot be ignored and overwritten during append.
  const anchors = [identityHeader, 'SOURCE ITEM', 'ITEM', 'DISPLAY NAME', 'PRODUCT ID']
    .filter(function(header) { return header && map[header] !== undefined; });
  const lastRow = anchors.length
    ? Math.max.apply(null, anchors.map(function(header) {
        return getLastDataRowInColumn_(sheet, map[header] + 1);
      }))
    : sheet.getLastRow();
  return {
    map: map,
    rows: lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues() : [],
    width: sheet.getLastColumn()
  };
}

function getInventorySheetOrThrow_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Required sheet missing: "' + name + '".');
  return sheet;
}

function getLastDataRowInColumn_(sheet, column) {
  const values = sheet.getRange(1, column, sheet.getMaxRows(), 1).getDisplayValues().flat();
  for (let index = values.length - 1; index >= 0; index--) {
    if (String(values[index] || '').trim() !== '') return index + 1;
  }
  return 1;
}

function normalizeKey_(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
function catalogText_(value) { return String(value == null ? '' : value).trim(); }
function cleanIdValue_(value) {
  return normalizeKey_(value).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function retailerCode_(value) {
  const name = normalizeKey_(value).replace(/[^A-Z0-9]/g, '');
  const codes = { HD: 'HD', HOMEDEPOT: 'HD', THEHOMEDEPOT: 'HD',
    LOW: 'LOW', LOWES: 'LOW', WM: 'WM', WALMART: 'WM' };
  return codes[name] || '';
}
function currentProductId_(retailer, sku) {
  const code = retailerCode_(retailer);
  const cleanSku = catalogText_(sku);
  // Do not silently mutate an unreliable SKU into an apparently reliable one.
  return code && /^[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*$/.test(cleanSku)
    ? code + '-' + cleanSku.toUpperCase() : '';
}
function catalogSourceIdentity_(retailer, item) {
  const code = retailerCode_(retailer) || normalizeKey_(retailer);
  return code && catalogText_(item)
    ? code + '\u001f' + catalogText_(item).toLowerCase().replace(/\s+/g, ' ') : '';
}
