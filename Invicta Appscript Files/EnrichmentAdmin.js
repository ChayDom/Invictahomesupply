/**
 * Administrative controls and audit utilities for Gemini catalog enrichment.
 * The nightly trigger runs runCatalogEnrichment between 3–4 AM UTC.
 */

function auditCatalogEnrichment() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInventorySheetOrThrow_(
    spreadsheet,
    INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
  );
  const lastRow = getLastDataRowInColumn_(sheet, CATALOG_COLUMNS.PRODUCT_KEY);
  const audit = {
    totalProducts: 0,
    complete: 0,
    missingDisplayName: 0,
    missingDescription: 0,
    missingHighlights: 0,
    pending: 0,
    needsReview: 0,
    failed: 0,
    locked: 0,
    duplicateProductKeys: 0
  };

  if (lastRow < 2) return audit;
  const rows = sheet.getRange(2, 1, lastRow - 1, CATALOG_COLUMNS.LAST_ENRICHED_AT)
    .getValues();
  const keyCounts = {};

  rows.forEach(function(values) {
    const key = normalizeKey_(values[CATALOG_COLUMNS.PRODUCT_KEY - 1]);
    if (!key) return;

    audit.totalProducts++;
    keyCounts[key] = (keyCounts[key] || 0) + 1;

    const displayName = String(values[CATALOG_COLUMNS.DISPLAY_NAME - 1] || '').trim();
    const description = String(values[CATALOG_COLUMNS.DESCRIPTION - 1] || '').trim();
    const highlights = String(values[CATALOG_COLUMNS.HIGHLIGHTS - 1] || '').trim();
    const status = String(values[CATALOG_COLUMNS.ENRICHMENT_STATUS - 1] || '')
      .trim()
      .toUpperCase();

    if (displayName && description && highlights) audit.complete++;
    if (!displayName) audit.missingDisplayName++;
    if (!description) audit.missingDescription++;
    if (!highlights) audit.missingHighlights++;
    if (!status || status === 'PENDING' || status === 'STANDARD') audit.pending++;
    if (status === 'NEEDS REVIEW') audit.needsReview++;
    if (status === 'FAILED') audit.failed++;
    if (values[CATALOG_COLUMNS.CONTENT_LOCKED - 1] === true) audit.locked++;
  });

  Object.keys(keyCounts).forEach(function(key) {
    if (keyCounts[key] > 1) audit.duplicateProductKeys += keyCounts[key] - 1;
  });

  console.log(JSON.stringify(audit));
  return audit;
}

function queueMissingCatalogEnrichment() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInventorySheetOrThrow_(
    spreadsheet,
    INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
  );
  const lastRow = getLastDataRowInColumn_(sheet, CATALOG_COLUMNS.PRODUCT_KEY);
  if (lastRow < 2) return 0;

  const rows = sheet.getRange(2, 1, lastRow - 1, CATALOG_COLUMNS.LAST_ENRICHED_AT)
    .getValues();
  let queued = 0;

  rows.forEach(function(values, index) {
    const key = String(values[CATALOG_COLUMNS.PRODUCT_KEY - 1] || '').trim();
    const description = String(values[CATALOG_COLUMNS.DESCRIPTION - 1] || '').trim();
    const highlights = String(values[CATALOG_COLUMNS.HIGHLIGHTS - 1] || '').trim();
    const status = String(values[CATALOG_COLUMNS.ENRICHMENT_STATUS - 1] || '')
      .trim()
      .toUpperCase();
    const locked = values[CATALOG_COLUMNS.CONTENT_LOCKED - 1] === true;

    if (!key || locked || (description && highlights)) return;
    if (status === 'PROCESSING' || status === 'FAILED' ||
        status === 'NEEDS REVIEW') return;

    sheet.getRange(index + 2, CATALOG_COLUMNS.ENRICHMENT_STATUS)
      .setValue('PENDING');
    queued++;
  });

  return queued;
}

function setupCatalogEnrichmentTrigger() {
  const existing = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === ENRICHMENT_CONFIG.HANDLER;
  });
  if (existing) return 'Daily enrichment trigger already exists.';

  ScriptApp.newTrigger(ENRICHMENT_CONFIG.HANDLER)
    .timeBased()
    .everyDays(1).atHour(3)
    .create();
  return 'Daily enrichment trigger created.';
}

function hasGeminiApiKey() {
  return Boolean(
    PropertiesService.getScriptProperties()
      .getProperty(ENRICHMENT_CONFIG.API_KEY_PROPERTY)
  );
}