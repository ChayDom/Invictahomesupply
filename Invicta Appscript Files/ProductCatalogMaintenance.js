/**
 * Production Product Catalog synchronization and maintenance.
 *
 * Normal operation: runProductCatalogMaintenance().
 * The scheduled six-hour trigger calls that function.
 *
 * Processing order:
 * 1. Reconcile unambiguous legacy catalog identities.
 * 2. Add genuinely new Product Inventory keys.
 * 3. Ensure Auto Box Price formulas exist.
 * 4. Refresh source-controlled catalog fields.
 * 5. Audit permanent Product Keys for duplicates.
 *
 * Permanent Product Catalog Product Keys and manually managed
 * website/enrichment fields are preserved.
 */

/**
 * Refreshes Product Catalog fields owned by Product Inventory.
 *
 * Updated fields:
 * - Retailer
 * - Retail SKU
 * - Source Item
 * - Source Category
 * - Product ID
 *
 * Matching is performed using Product Catalog Match Key.
 */
function refreshProductCatalogSourceFields() {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const inventorySheet =
    getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET
    );

  const catalogSheet =
    getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
    );

  const inventoryLastRow =
    getLastDataRowInColumn_(
      inventorySheet,
      1
    );

  const catalogLastRow =
    getLastDataRowInColumn_(
      catalogSheet,
      CATALOG_COLUMNS.PRODUCT_KEY
    );

  if (
    inventoryLastRow < 2 ||
    catalogLastRow < 2
  ) {
    console.log(
      'Nothing to refresh.'
    );
    return;
  }

  /*
   * Product Inventory columns A:F:
   * A Product Key
   * B Product ID
   * C Retail SKU
   * D Item
   * E Category
   * F Retailer
   */
  const inventoryData = inventorySheet
    .getRange(
      2,
      1,
      inventoryLastRow - 1,
      6
    )
    .getValues();

  /*
   * Read Product Catalog columns from A through Product ID.
   * Fields beyond Product ID are not needed for this operation.
   */
  const catalogData = catalogSheet
    .getRange(
      2,
      1,
      catalogLastRow - 1,
      CATALOG_COLUMNS.PRODUCT_ID
    )
    .getValues();

  const inventoryByKey = new Map();

  inventoryData.forEach(function(row) {
    const key =
      normalizeKey_(row[0]);

    if (!key) {
      return;
    }

    /*
     * A duplicate Product Inventory key is unsafe because the
     * catalog would not know which source row to use.
     */
    if (inventoryByKey.has(key)) {
      console.log(
        'WARNING: duplicate Product Inventory key skipped: ' +
          key
      );
      return;
    }

    inventoryByKey.set(key, {
      productId:
        String(row[1] || '').trim(),

      retailSku:
        String(row[2] || '').trim(),

      item:
        String(row[3] || '').trim(),

      category:
        String(row[4] || '').trim(),

      retailer:
        String(row[5] || '').trim()
    });
  });

  let changed = 0;
  let alreadyCurrent = 0;
  let noMatch = 0;

  catalogData.forEach(function(row) {
    const matchKey =
      normalizeKey_(
        row[
          CATALOG_COLUMNS.MATCH_KEY - 1
        ]
      );

    const source = matchKey
      ? inventoryByKey.get(matchKey)
      : null;

    /*
     * Catalog-only products and historical products without a
     * current Product Inventory match are preserved unchanged.
     */
    if (!source) {
      noMatch++;
      return;
    }

    const isCurrent =
      String(
        row[
          CATALOG_COLUMNS.RETAILER - 1
        ] || ''
      ).trim() === source.retailer &&

      String(
        row[
          CATALOG_COLUMNS.RETAIL_SKU - 1
        ] || ''
      ).trim() === source.retailSku &&

      String(
        row[
          CATALOG_COLUMNS.SOURCE_ITEM - 1
        ] || ''
      ).trim() === source.item &&

      String(
        row[
          CATALOG_COLUMNS.SOURCE_CATEGORY - 1
        ] || ''
      ).trim() === source.category &&

      String(
        row[
          CATALOG_COLUMNS.PRODUCT_ID - 1
        ] || ''
      ).trim() === source.productId;

    if (isCurrent) {
      alreadyCurrent++;
      return;
    }

    /*
     * Update only fields owned by Product Inventory.
     */
    row[
      CATALOG_COLUMNS.RETAILER - 1
    ] = source.retailer;

    row[
      CATALOG_COLUMNS.RETAIL_SKU - 1
    ] = source.retailSku;

    row[
      CATALOG_COLUMNS.SOURCE_ITEM - 1
    ] = source.item;

    row[
      CATALOG_COLUMNS.SOURCE_CATEGORY - 1
    ] = source.category;

    row[
      CATALOG_COLUMNS.PRODUCT_ID - 1
    ] = source.productId;

    changed++;
  });

  /*
   * Write Retailer and Retail SKU.
   */
  catalogSheet
    .getRange(
      2,
      CATALOG_COLUMNS.RETAILER,
      catalogData.length,
      2
    )
    .setValues(
      catalogData.map(function(row) {
        return row.slice(
          CATALOG_COLUMNS.RETAILER - 1,
          CATALOG_COLUMNS.RETAIL_SKU
        );
      })
    );

  /*
   * Write Source Item and Source Category.
   */
  catalogSheet
    .getRange(
      2,
      CATALOG_COLUMNS.SOURCE_ITEM,
      catalogData.length,
      2
    )
    .setValues(
      catalogData.map(function(row) {
        return row.slice(
          CATALOG_COLUMNS.SOURCE_ITEM - 1,
          CATALOG_COLUMNS.SOURCE_CATEGORY
        );
      })
    );

  /*
   * Write Product ID.
   */
  catalogSheet
    .getRange(
      2,
      CATALOG_COLUMNS.PRODUCT_ID,
      catalogData.length,
      1
    )
    .setValues(
      catalogData.map(function(row) {
        return [
          row[
            CATALOG_COLUMNS.PRODUCT_ID - 1
          ]
        ];
      })
    );

  console.log(
    'Product Catalog source refresh complete. ' +
      'Changed: ' +
      changed +
      ' | Already current: ' +
      alreadyCurrent +
      ' | No current match: ' +
      noMatch
  );
}

/**
 * Adds Product Inventory keys that are genuinely missing from
 * Product Catalog.
 *
 * Both permanent Product Keys and Match Keys are considered
 * existing identities. Legacy reconciliation must run before
 * this function.
 */
function syncProductCatalogKeys() {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const inventorySheet =
    getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET
    );

  const catalogSheet =
    getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
    );

  const inventoryLastRow =
    getLastDataRowInColumn_(
      inventorySheet,
      1
    );

  if (inventoryLastRow < 2) {
    console.log(
      'No Product Inventory records.'
    );
    return;
  }

  const inventoryData = inventorySheet
    .getRange(
      2,
      1,
      inventoryLastRow - 1,
      6
    )
    .getValues();

  const inventoryByKey = new Map();

  inventoryData.forEach(function(row) {
    const key =
      normalizeKey_(row[0]);

    if (!key) {
      return;
    }

    if (inventoryByKey.has(key)) {
      console.log(
        'WARNING: duplicate Product Inventory key skipped: ' +
          key
      );
      return;
    }

    inventoryByKey.set(key, row);
  });

  const catalogLastRow =
    getLastDataRowInColumn_(
      catalogSheet,
      CATALOG_COLUMNS.PRODUCT_KEY
    );

  const existingRows =
    catalogLastRow >= 2
      ? catalogSheet
          .getRange(
            2,
            CATALOG_COLUMNS.PRODUCT_KEY,
            catalogLastRow - 1,
            CATALOG_COLUMNS.MATCH_KEY -
              CATALOG_COLUMNS.PRODUCT_KEY +
              1
          )
          .getValues()
      : [];

  const existingKeys = new Set();

  existingRows.forEach(function(row) {
    const permanentKey =
      normalizeKey_(row[0]);

    const matchKey =
      normalizeKey_(row[1]);

    if (permanentKey) {
      existingKeys.add(permanentKey);
    }

    if (matchKey) {
      existingKeys.add(matchKey);
    }
  });

  const newKeys =
    Array.from(
      inventoryByKey.keys()
    ).filter(function(key) {
      return !existingKeys.has(key);
    });

  if (newKeys.length === 0) {
    console.log(
      'No new Product Keys to add.'
    );
    return;
  }

  const newRows =
    newKeys.map(function(key) {
      const source =
        inventoryByKey.get(key);

      const row =
        new Array(
          CATALOG_COLUMNS.LAST_SYNCED_HASH
        ).fill('');

      row[
        CATALOG_COLUMNS.RETAILER - 1
      ] = String(source[5] || '').trim();

      row[
        CATALOG_COLUMNS.RETAIL_SKU - 1
      ] = String(source[2] || '').trim();

      row[
        CATALOG_COLUMNS.ENRICHMENT_STATUS - 1
      ] = 'PENDING';

      row[
        CATALOG_COLUMNS.SOURCE_ITEM - 1
      ] = String(source[3] || '').trim();

      row[
        CATALOG_COLUMNS.SOURCE_CATEGORY - 1
      ] = String(source[4] || '').trim();

      row[
        CATALOG_COLUMNS.PRODUCT_KEY - 1
      ] = String(source[0] || '').trim();

      row[
        CATALOG_COLUMNS.MATCH_KEY - 1
      ] = String(source[0] || '').trim();

      row[
        CATALOG_COLUMNS.PRODUCT_ID - 1
      ] = String(source[1] || '').trim();

      return row;
    });

  const startRow =
    Math.max(
      catalogLastRow + 1,
      2
    );

  catalogSheet
    .getRange(
      startRow,
      1,
      newRows.length,
      CATALOG_COLUMNS.LAST_SYNCED_HASH
    )
    .setValues(newRows);

  console.log(
    'Added ' +
      newRows.length +
      ' new Product Catalog row(s).'
  );
}

/**
 * Runs the complete Product Catalog maintenance workflow.
 *
 * Scheduled operation: every six hours.
 *
 * The order is critical:
 * - Reconcile legacy rows first.
 * - Add genuinely new products second.
 */
function runProductCatalogMaintenance() {
  const lock =
    LockService.getScriptLock();

  /*
   * Prevent simultaneous scheduled and manual maintenance runs.
   */
  try {
    lock.waitLock(30000);
  } catch (error) {
    console.log(
      'Maintenance skipped because another run is active.'
    );
    return;
  }

  try {
    console.log(
      '========== PRODUCT CATALOG MAINTENANCE START =========='
    );

    /*
     * Reconnect existing permanent LEG-... catalog rows to
     * their new RetailerCode-SKU Product Inventory identities.
     *
     * This must run before syncProductCatalogKeys() so a
     * second sparse catalog row is not created.
     */
    const legacyResult =
      reconcileLegacyCatalogRowsAutomatically_();

    console.log(
      'Legacy reconciliation result: ' +
        JSON.stringify(legacyResult)
    );

    /*
     * Add only Product Inventory keys that remain genuinely
     * absent after legacy reconciliation.
     */
    syncProductCatalogKeys();

    /*
     * Add missing Auto Box Price formulas.
     */
    ensureProductCatalogAutoBoxPriceFormulas_();

    /*
     * Refresh Product Inventory-owned catalog fields.
     */
    refreshProductCatalogSourceFields();

    SpreadsheetApp.flush();

     /*
     * Final Product Catalog identity audit.
     * Strict mode causes maintenance to fail if issues remain.
     */
    auditProductCatalogDuplicateKeys({
      throwOnIssues: true
    });

    console.log(
      '========== PRODUCT CATALOG MAINTENANCE COMPLETE =========='
    );
  } catch (error) {
    console.error(
      'PRODUCT CATALOG MAINTENANCE FAILED: ' +
        error.message
    );

    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ensures every valid Product Catalog row has its own
 * row-relative Auto Box Price formula.
 *
 * Existing formulas are preserved.
 * Rows without a permanent Product Key are ignored.
 */
function ensureProductCatalogAutoBoxPriceFormulas_() {
  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  const sheet =
    getInventorySheetOrThrow_(
      spreadsheet,
      INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
    );

  const lastRow =
    getLastDataRowInColumn_(
      sheet,
      CATALOG_COLUMNS.PRODUCT_KEY
    );

  if (lastRow < 2) {
    console.log(
      'No Product Catalog rows found for Auto Box Price formulas.'
    );
    return;
  }

  const rowCount =
    lastRow - 1;

  const productKeys = sheet
    .getRange(
      2,
      CATALOG_COLUMNS.PRODUCT_KEY,
      rowCount,
      1
    )
    .getDisplayValues();

  const boxPriceRange =
    sheet.getRange(
      2,
      CATALOG_COLUMNS.AUTO_BOX_PRICE,
      rowCount,
      1
    );

  const existingFormulas =
    boxPriceRange.getFormulas();

  let added = 0;

  for (
    let index = 0;
    index < rowCount;
    index++
  ) {
    const productKey =
      String(
        productKeys[index][0] || ''
      ).trim();

    if (
      !productKey ||
      existingFormulas[index][0]
    ) {
      continue;
    }

    const row = index + 2;

    /*
     * Auto Box Price calculation:
     *
     * Sell Price × Sq Ft Per Unit
     *
     * Rounding:
     * - Whole number remains whole.
     * - Decimal below .75 rounds to .50.
     * - Decimal .75 or higher rounds to next whole dollar.
     */
    boxPriceRange
      .getCell(
        index + 1,
        1
      )
      .setFormula(
        '=IF(OR(G' +
          row +
          '="",H' +
          row +
          '=""),"",LET(x,G' +
          row +
          '*H' +
          row +
          ',w,INT(x),d,x-w,IF(d=0,w,IF(d<0.75,w+0.5,w+1))))'
      );

    added++;
  }

  console.log(
    'Ensured AUTO BOX PRICE formulas for ' +
      added +
      ' Product Catalog row(s).'
  );
}