/**
 * Shared configuration and helpers for Product Catalog maintenance.
 * Website Export is formula-driven and is not written by Apps Script.
 */
const INVENTORY_CONFIG = Object.freeze({
  PRODUCT_INVENTORY_SHEET: 'Product Inventory',
  PRODUCT_CATALOG_SHEET: 'Product Catalog',
  PRODUCT_KEY_COLUMN: 20,
  MATCH_KEY_COLUMN: 21,
  PRODUCT_ID_COLUMN: 22
});



/**
 * Approved broad website categories. Keep product-specific detail in
 * Display Name / Subcategory rather than inventing new top-level categories.
 */
const WEBSITE_CATEGORY_VALUES = Object.freeze([
  'Flooring',
  'Water Heaters',
  'Appliances',
  'Plumbing & Bath',
  'Lawn & Outdoor',
  'Tools',
  'Electrical & Lighting',
  'Electronics & Smart Home',
  'Paint & Supplies',
  'Building Materials',
  'Doors & Windows',
  'Heating & Cooling',
  'Home & Furniture',
  'Cleaning & Household',
  'Health & Personal Care',
  'Automotive',
  'Sports & Fitness',
  'Toys & Collectibles',
  'Other'
]);

const CATALOG_COLUMNS = Object.freeze({
  DISPLAY_NAME: 1,
  WEBSITE_CATEGORY: 2,
  RETAILER: 3,
  RETAIL_SKU: 4,
  BRAND: 5,
  MODEL: 6,
  SQ_FT_PER_UNIT: 7,
  SELL_PRICE: 8,
  AUTO_BOX_PRICE: 9,
  POST_TO_WEBSITE: 10,
  STOCK_IMAGE_URL: 11,
  PRODUCT_URL: 12,
  DESCRIPTION: 13,
  HIGHLIGHTS: 14,
  ENRICHMENT_STATUS: 15,
  NOTES: 16,
  UNIT_TYPE: 17,
  SOURCE_ITEM: 18,
  SOURCE_CATEGORY: 19,
  PRODUCT_KEY: 20,
  MATCH_KEY: 21,
  PRODUCT_ID: 22,
  CURRENT_SYNC_HASH: 23,
  LAST_SYNCED_HASH: 24,
  CONTENT_LOCKED: 25,
  ENRICHMENT_CONFIDENCE: 26,
  LAST_ENRICHED_AT: 27
});

const ENRICHMENT_CONFIG = Object.freeze({
  MODEL: 'gemini-3.5-flash-lite',
  BATCH_SIZE: 5,
  API_KEY_PROPERTY: 'GEMINI_API_KEY',
  HANDLER: 'runCatalogEnrichment'
});

function getInventorySheetOrThrow_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Required sheet missing: "' + sheetName + '".');
  }
  return sheet;
}

function getLastDataRowInColumn_(sheet, columnNumber) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < 1) return 1;

  const values = sheet
    .getRange(1, columnNumber, maxRows, 1)
    .getDisplayValues()
    .flat();

  for (let index = values.length - 1; index >= 0; index--) {
    if (String(values[index] || '').trim() !== '') {
      return index + 1;
    }
  }
  return 1;
}

function normalizeKey_(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanIdValue_(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildLegacyKey_(retailer, item) {
  const cleanRetailer = cleanIdValue_(retailer);
  const cleanItem = cleanIdValue_(item);
  if (!cleanRetailer || !cleanItem) return '';
  return 'LEGACY|' + cleanRetailer + '|' + cleanItem;
}
