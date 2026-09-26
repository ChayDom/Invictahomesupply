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


/**
 * Read-only Product Catalog identity audit.
 *
 * Checks:
 * - Permanent Product Key
 * - Match Key
 * - Product ID
 * - Retailer + Retail SKU
 * - Missing identity values
 *
 * Important legacy rule:
 * A genuine legacy row may temporarily have no Product ID when it also
 * has no real Retail SKU yet. That is an allowed legacy state and should
 * not fail Product Catalog maintenance.
 *
 * This function does not modify the spreadsheet.
 */
function auditProductCatalogDuplicateKeys(options) {
  const opts = options || {};
  const throwOnIssues = opts.throwOnIssues === true;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const catalogSheet = getInventorySheetOrThrow_(
    spreadsheet,
    INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
  );

  const lastRow = getLastDataRowInColumn_(
    catalogSheet,
    CATALOG_COLUMNS.PRODUCT_KEY
  );

  if (lastRow < 2) {
    const message = 'Product Catalog is empty.';
    console.log(message);

    if (throwOnIssues) {
      throw new Error(message);
    }

    return [];
  }

  const data = catalogSheet
    .getRange(
      2,
      1,
      lastRow - 1,
      CATALOG_COLUMNS.PRODUCT_ID
    )
    .getValues();

  const rowsByProductKey = new Map();
  const rowsByMatchKey = new Map();
  const rowsByProductId = new Map();
  const rowsByRetailerSku = new Map();

  const missingProductKeyRows = [];
  const missingMatchKeyRows = [];
  const missingProductIdRows = [];

  /*
   * Informational only.
   *
   * These are legitimate legacy rows that still do not have a real
   * Retail SKU, so they cannot yet have a current Product ID.
   */
  const legacyWithoutProductIdRows = [];

  data.forEach(function(row, index) {
    const sheetRow = index + 2;

    const productKey = normalizeKey_(
      row[CATALOG_COLUMNS.PRODUCT_KEY - 1]
    );

    const matchKey = normalizeKey_(
      row[CATALOG_COLUMNS.MATCH_KEY - 1]
    );

    const productId = normalizeKey_(
      row[CATALOG_COLUMNS.PRODUCT_ID - 1]
    );

    const retailer = String(
      row[CATALOG_COLUMNS.RETAILER - 1] || ''
    )
      .trim()
      .toUpperCase();

    const retailSku = String(
      row[CATALOG_COLUMNS.RETAIL_SKU - 1] || ''
    )
      .trim()
      .toUpperCase();

    /*
     * A row is considered legacy when either its permanent Product Key
     * or its current Match Key still uses one of the supported legacy
     * identity formats.
     */
    const isLegacyIdentity =
      String(productKey || '')
        .toUpperCase()
        .startsWith('LEG-') ||
      String(productKey || '')
        .toUpperCase()
        .startsWith('LEGACY|') ||
      String(matchKey || '')
        .toUpperCase()
        .startsWith('LEG-') ||
      String(matchKey || '')
        .toUpperCase()
        .startsWith('LEGACY|');

    /*
     * Permanent Product Key.
     */
    if (!productKey) {
      missingProductKeyRows.push(sheetRow);
    } else {
      addCatalogAuditRow_(
        rowsByProductKey,
        productKey,
        sheetRow
      );
    }

    /*
     * Match Key.
     */
    if (!matchKey) {
      missingMatchKeyRows.push(sheetRow);
    } else {
      addCatalogAuditRow_(
        rowsByMatchKey,
        matchKey,
        sheetRow
      );
    }

    /*
     * Product ID.
     *
     * Allowed:
     *   legacy identity
     *   + no Retail SKU
     *   + no Product ID
     *
     * Not allowed:
     *   current/non-legacy identity with no Product ID
     *   OR
     *   legacy row that already has a Retail SKU but still has no
     *   Product ID
     */
    if (!productId) {
      if (
        isLegacyIdentity &&
        !retailSku
      ) {
        legacyWithoutProductIdRows.push(
          sheetRow
        );
      } else {
        missingProductIdRows.push(
          sheetRow
        );
      }
    } else {
      addCatalogAuditRow_(
        rowsByProductId,
        productId,
        sheetRow
      );
    }

    /*
     * Retailer + Retail SKU identity.
     */
    if (retailer && retailSku) {
      addCatalogAuditRow_(
        rowsByRetailerSku,
        retailer + '|' + retailSku,
        sheetRow
      );
    }
  });

  const findings = [];

  collectCatalogDuplicates_(
    findings,
    'PRODUCT KEY',
    rowsByProductKey
  );

  collectCatalogDuplicates_(
    findings,
    'MATCH KEY',
    rowsByMatchKey
  );

  collectCatalogDuplicates_(
    findings,
    'PRODUCT ID',
    rowsByProductId
  );

  collectCatalogDuplicates_(
    findings,
    'RETAILER + RETAIL SKU',
    rowsByRetailerSku
  );

  if (missingProductKeyRows.length > 0) {
    findings.push({
      type: 'MISSING PRODUCT KEY',
      key: '',
      rows: missingProductKeyRows
    });
  }

  if (missingMatchKeyRows.length > 0) {
    findings.push({
      type: 'MISSING MATCH KEY',
      key: '',
      rows: missingMatchKeyRows
    });
  }

  if (missingProductIdRows.length > 0) {
    findings.push({
      type: 'MISSING PRODUCT ID',
      key: '',
      rows: missingProductIdRows
    });
  }

  /*
   * Legitimate legacy rows should still be visible in the execution log,
   * but they are informational and do not count as audit findings.
   */
  if (legacyWithoutProductIdRows.length > 0) {
    console.log(
      'INFO: Legacy Product Catalog rows awaiting Retail SKU/Product ID: ' +
      legacyWithoutProductIdRows.join(', ')
    );
  }

  if (findings.length === 0) {
    console.log(
      'Product Catalog identity audit: CLEAN. ' +
      'Rows checked: ' + data.length +
      ' | Duplicate Product Keys: 0' +
      ' | Duplicate Match Keys: 0' +
      ' | Duplicate Product IDs: 0' +
      ' | Duplicate Retailer/SKU identities: 0' +
      ' | Invalid missing identity values: 0' +
      ' | Legacy rows awaiting Product ID: ' +
      legacyWithoutProductIdRows.length
    );
  } else {
    console.log(
      'WARNING: Product Catalog identity audit found ' +
      findings.length +
      ' issue group(s).'
    );

    findings.forEach(function(entry) {
      console.log(
        entry.type +
        (entry.key ? ': ' + entry.key : '') +
        ' | Rows: ' +
        entry.rows.join(', ')
      );
    });

    if (legacyWithoutProductIdRows.length > 0) {
      console.log(
        'INFO: Allowed legacy rows without Product ID: ' +
        legacyWithoutProductIdRows.join(', ')
      );
    }
  }

  if (findings.length > 0 && throwOnIssues) {
    throw new Error(
      'Product Catalog identity audit failed with ' +
      findings.length +
      ' issue group(s). Review the execution log for affected rows.'
    );
  }

  return findings;
}


/**
 * Adds a sheet row number to an identity map.
 */
function addCatalogAuditRow_(map, key, sheetRow) {
  if (!map.has(key)) {
    map.set(key, []);
  }

  map.get(key).push(sheetRow);
}


/**
 * Adds duplicate identity groups to the audit findings.
 */
function collectCatalogDuplicates_(
  findings,
  identityType,
  rowsByIdentity
) {
  rowsByIdentity.forEach(function(rows, key) {
    if (rows.length > 1) {
      findings.push({
        type: 'DUPLICATE ' + identityType,
        key: key,
        rows: rows
      });
    }
  });
}