/**
 * Administrative controls and audit utilities for Gemini catalog enrichment.
 * The nightly trigger runs runCatalogEnrichment at approximately 3 AM in the project timezone (America/Chicago).
 */

function auditCatalogEnrichment() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInventorySheetOrThrow_(
    spreadsheet,
    INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
  );
  const columns = getCatalogColumns_(sheet);
  const lastRow = getLastDataRowInColumn_(sheet, columns.PRODUCT_KEY);
  const audit = {
    totalProducts: 0,
    complete: 0,
    missingDisplayName: 0,
    missingDescription: 0,
    missingHighlights: 0,
    pending: 0,
    needsReview: 0,
    failed: 0,
    duplicateProductKeys: 0
  };

  if (lastRow < 2) return audit;
  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .getValues();
  const keyCounts = {};

  rows.forEach(function(values) {
    const key = normalizeKey_(values[columns.PRODUCT_KEY - 1]);
    if (!key) return;

    audit.totalProducts++;
    keyCounts[key] = (keyCounts[key] || 0) + 1;

    const displayName = String(values[columns.DISPLAY_NAME - 1] || '').trim();
    const description = String(values[columns.DESCRIPTION - 1] || '').trim();
    const highlights = String(values[columns.HIGHLIGHTS - 1] || '').trim();
    const status = String(values[columns.ENRICHMENT_STATUS - 1] || '')
      .trim()
      .toUpperCase();

    if (displayName && description && highlights) audit.complete++;
    if (!displayName) audit.missingDisplayName++;
    if (!description) audit.missingDescription++;
    if (!highlights) audit.missingHighlights++;
    if (isCatalogRowEligibleForEnrichment_(values, columns)) audit.pending++;
    if (status === 'NEEDS REVIEW') audit.needsReview++;
    if (status === 'FAILED') audit.failed++;
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
  const columns = getCatalogColumns_(sheet);
  const lastRow = getLastDataRowInColumn_(sheet, columns.PRODUCT_KEY);
  if (lastRow < 2) return 0;

  const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .getValues();
  let queued = 0;

  rows.forEach(function(values, index) {
    // Intentional bulk requeue, not a legacy/excluded-status override. Share the
    // nightly eligibility gate so this helper cannot accidentally broaden it.
    if (!isCatalogRowEligibleForEnrichment_(values, columns)) return;

    sheet.getRange(index + 2, columns.ENRICHMENT_STATUS)
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
