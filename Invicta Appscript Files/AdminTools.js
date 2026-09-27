/**
 * Spreadsheet menu and read-only administrative checks.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Inventory Tools')
    .addItem(
      'Run Product Catalog Maintenance',
      'runProductCatalogMaintenance'
    )
    .addSeparator()
    .addItem('Preview Sold-Out Catalog Cleanup', 'runSoldOutCatalogCleanup')
    .addSeparator()
    .addItem(
      'Audit Product Catalog Duplicates',
      'auditProductCatalogDuplicateKeys'
    )
    .addItem(
      'Run Legacy Identity Repair',
      'repairAndUpgradeLegacyCatalogRows'
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Social Media')
        .addItem('Sync Social Queue', 'syncSocialQueueFromCatalog')
        .addItem('Generate 1 Caption (Test)', 'generateOneSocialCaptionTest')
        .addItem('Generate Social Captions', 'generateSocialCaptions')
        .addSeparator()
        .addItem('Test Buffer Connection', 'testBufferConnection')
        .addItem('Discover Buffer Channels', 'setupBufferChannels')
        .addItem('Send Ready Posts to Buffer', 'sendReadySocialPostsToBuffer')
    )
    .addToUi();
}


/** Read-only audit. Legacy products may lack a current ID until a SKU is known. */
function auditProductCatalogDuplicateKeys(options) {
  const sheet = getInventorySheetOrThrow_(SpreadsheetApp.getActiveSpreadsheet(), INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET);
  getCatalogColumns_(sheet);
  const table = readSheetTable_(sheet, 'PRODUCT KEY');
  const findings = catalogIdentityFindings_(table.rows, table.map);
  console.log(JSON.stringify({ rowsChecked: table.rows.length, findings: findings }));
  if (options && options.throwOnIssues && findings.length) {
    throw new Error('Product Catalog identity audit failed: ' + JSON.stringify(findings));
  }
  return findings;
}
