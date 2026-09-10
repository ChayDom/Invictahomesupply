/**
 * Spreadsheet menu and read-only administrative checks.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Inventory Tools')
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

    if (!productKey) {
      missingProductKeyRows.push(sheetRow);
    } else {
      addCatalogAuditRow_(
        rowsByProductKey,
        productKey,
        sheetRow
      );
    }

    if (!matchKey) {
      missingMatchKeyRows.push(sheetRow);
    } else {
      addCatalogAuditRow_(
        rowsByMatchKey,
        matchKey,
        sheetRow
      );
    }

    if (!productId) {
      missingProductIdRows.push(sheetRow);
    } else {
      addCatalogAuditRow_(
        rowsByProductId,
        productId,
        sheetRow
      );
    }

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

  if (findings.length === 0) {
    console.log(
      'Product Catalog identity audit: CLEAN. ' +
      'Rows checked: ' + data.length +
      ' | Duplicate Product Keys: 0' +
      ' | Duplicate Match Keys: 0' +
      ' | Duplicate Product IDs: 0' +
      ' | Duplicate Retailer/SKU identities: 0' +
      ' | Missing identity values: 0'
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