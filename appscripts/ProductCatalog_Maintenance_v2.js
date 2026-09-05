/**
 * Invicta Home Supply — Product Catalog Maintenance v2
 * Header-based replacement for the old positional maintenance writer.
 *
 * SAFE DESIGN:
 * - Never changes PRODUCT KEY on an existing catalog row.
 * - Matches current inventory by PRODUCT KEY or MATCH KEY.
 * - Can reconcile one exact legacy identity match (Retailer + normalized Item).
 * - Writes only source-controlled identity fields.
 * - Initializes Website Category/Subcategory only when blank.
 * - Refuses duplicate Product Keys / Match Keys.
 *
 * Recommended sequence:
 * 1) Run runProductCatalogMaintenanceDryRun()
 * 2) Inspect the returned summary / execution log.
 * 3) Run runProductCatalogMaintenance()
 * 4) Audit duplicates before re-enabling the trigger.
 */

const PCM_CONFIG = {
  PRODUCT_INVENTORY_SHEET: 'Product Inventory',
  PRODUCT_CATALOG_SHEET: 'Product Catalog'
};

function runProductCatalogMaintenanceDryRun() {
  return pcmRun_(true);
}

function runProductCatalogMaintenance() {
  return pcmRun_(false);
}

function pcmRun_(dryRun) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error('Another Product Catalog maintenance run is active.');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const invSheet = ss.getSheetByName(
      PCM_CONFIG.PRODUCT_INVENTORY_SHEET
    );
    const catSheet = ss.getSheetByName(
      PCM_CONFIG.PRODUCT_CATALOG_SHEET
    );

    if (!invSheet || !catSheet) {
      throw new Error(
        'Missing Product Inventory or Product Catalog sheet.'
      );
    }

    const inv = pcmReadTable_(invSheet);
    const cat = pcmReadTable_(catSheet);

    pcmRequireHeaders_(
      inv.map,
      [
        'PRODUCT KEY',
        'PRODUCT ID',
        'RETAIL SKU',
        'ITEM',
        'CATEGORY',
        'SUBCATEGORY',
        'RETAILER'
      ],
      'Product Inventory'
    );

    pcmRequireHeaders_(
      cat.map,
      [
        'DISPLAY NAME',
        'WEBSITE CATEGORY',
        'RETAILER',
        'RETAIL SKU',
        'ENRICHMENT STATUS',
        'SOURCE ITEM',
        'SOURCE CATEGORY',
        'PRODUCT KEY',
        'MATCH KEY',
        'PRODUCT ID',
        'WEB SUBCATEGORY'
      ],
      'Product Catalog'
    );

    const catalogByProductKey = new Map();
    const catalogByMatchKey = new Map();
    const legacyByIdentity = new Map();

    cat.rows.forEach(function(row, index) {
      const rowNumber = index + 2;

      const productKey = pcmText_(
        row[cat.map['PRODUCT KEY']]
      );

      const matchKey = pcmText_(
        row[cat.map['MATCH KEY']]
      );

      const retailer = pcmText_(
        row[cat.map['RETAILER']]
      );

      const sourceItem = pcmText_(
        row[cat.map['SOURCE ITEM']]
      );

      if (productKey) {
        if (catalogByProductKey.has(productKey)) {
          throw new Error(
            'Duplicate Product Key already exists: ' +
            productKey
          );
        }

        catalogByProductKey.set(
          productKey,
          rowNumber
        );
      }

      if (matchKey) {
        if (catalogByMatchKey.has(matchKey)) {
          throw new Error(
            'Duplicate Match Key already exists: ' +
            matchKey
          );
        }

        catalogByMatchKey.set(
          matchKey,
          rowNumber
        );
      }

      if (
        productKey.indexOf('LEGACY|') === 0 &&
        retailer &&
        sourceItem
      ) {
        const id = pcmIdentity_(
          retailer,
          sourceItem
        );

        if (!legacyByIdentity.has(id)) {
          legacyByIdentity.set(id, []);
        }

        legacyByIdentity
          .get(id)
          .push(rowNumber);
      }
    });

    const writes = [];
    const appends = [];
    const seenInventoryKeys = new Set();

    const summary = {
      dryRun: dryRun,
      inventoryProducts: 0,
      existingMatched: 0,
      legacyReconciled: 0,
      newProducts: 0,
      ambiguousLegacy: 0,
      skippedDuplicateInventoryKey: 0,
      fieldChanges: 0
    };

    inv.rows.forEach(function(row) {
      const productKey = pcmText_(
        row[inv.map['PRODUCT KEY']]
      );

      if (!productKey) return;

      summary.inventoryProducts++;

      if (seenInventoryKeys.has(productKey)) {
        summary.skippedDuplicateInventoryKey++;
        return;
      }

      seenInventoryKeys.add(productKey);

      const productId = pcmText_(
        row[inv.map['PRODUCT ID']]
      );

      const retailSku = pcmText_(
        row[inv.map['RETAIL SKU']]
      );

      const item = pcmText_(
        row[inv.map['ITEM']]
      );

      const category = pcmText_(
        row[inv.map['CATEGORY']]
      );

      const subcategory = pcmText_(
        row[inv.map['SUBCATEGORY']]
      );

      const retailer = pcmText_(
        row[inv.map['RETAILER']]
      );

      let targetRow =
        catalogByProductKey.get(productKey) ||
        catalogByMatchKey.get(productKey) ||
        null;

      let reconciledLegacy = false;

      if (
        !targetRow &&
        retailer &&
        item
      ) {
        const candidates =
          legacyByIdentity.get(
            pcmIdentity_(retailer, item)
          ) || [];

        if (candidates.length === 1) {
          targetRow = candidates[0];
          reconciledLegacy = true;
        } else if (candidates.length > 1) {
          summary.ambiguousLegacy++;
        }
      }

      if (targetRow) {
        summary.existingMatched++;

        if (reconciledLegacy) {
          summary.legacyReconciled++;
        }

        pcmPlanSet_(
          writes,
          catSheet,
          targetRow,
          cat,
          'MATCH KEY',
          productKey
        );

        pcmPlanSet_(
          writes,
          catSheet,
          targetRow,
          cat,
          'PRODUCT ID',
          productId || productKey
        );

        pcmPlanSet_(
          writes,
          catSheet,
          targetRow,
          cat,
          'RETAIL SKU',
          retailSku
        );

        pcmPlanSet_(
          writes,
          catSheet,
          targetRow,
          cat,
          'RETAILER',
          retailer
        );

        pcmPlanSet_(
          writes,
          catSheet,
          targetRow,
          cat,
          'SOURCE ITEM',
          item
        );

        /*
         * Preserve existing SOURCE CATEGORY.
         * It is historical/raw source metadata.
         * Do NOT overwrite it with canonical
         * website taxonomy.
         */

        pcmPlanSetIfBlank_(
          writes,
          catSheet,
          targetRow,
          cat,
          'WEBSITE CATEGORY',
          category
        );

        pcmPlanSetIfBlank_(
          writes,
          catSheet,
          targetRow,
          cat,
          'WEB SUBCATEGORY',
          subcategory
        );

        if (
          !catalogByMatchKey.has(productKey)
        ) {
          catalogByMatchKey.set(
            productKey,
            targetRow
          );
        }

        return;
      }

      /*
       * Brand-new current product.
       * Build the new row entirely by
       * HEADER NAME.
       */

      const newRow =
        new Array(cat.headers.length)
          .fill('');

      newRow[
        cat.map['PRODUCT KEY']
      ] = productKey;

      newRow[
        cat.map['MATCH KEY']
      ] = productKey;

      newRow[
        cat.map['PRODUCT ID']
      ] = productId || productKey;

      newRow[
        cat.map['RETAIL SKU']
      ] = retailSku;

      newRow[
        cat.map['RETAILER']
      ] = retailer;

      newRow[
        cat.map['SOURCE ITEM']
      ] = item;

      newRow[
        cat.map['SOURCE CATEGORY']
      ] = category;

      newRow[
        cat.map['WEBSITE CATEGORY']
      ] = category;

      newRow[
        cat.map['WEB SUBCATEGORY']
      ] = subcategory;

      newRow[
        cat.map['ENRICHMENT STATUS']
      ] = 'PENDING';

      if (
        catalogByProductKey.has(productKey) ||
        catalogByMatchKey.has(productKey)
      ) {
        throw new Error(
          'Refusing duplicate planned catalog key: ' +
          productKey
        );
      }

      catalogByProductKey.set(
        productKey,
        -1
      );

      catalogByMatchKey.set(
        productKey,
        -1
      );

      appends.push(newRow);
      summary.newProducts++;
    });

    summary.fieldChanges =
      writes.length;

    if (!dryRun) {
      writes.forEach(function(w) {
        w.sheet
          .getRange(w.row, w.col)
          .setValue(w.value);
      });

      if (appends.length) {
        const startRow =
          catSheet.getLastRow() + 1;

        catSheet
          .getRange(
            startRow,
            1,
            appends.length,
            cat.headers.length
          )
          .setValues(appends);
      }

      SpreadsheetApp.flush();

      pcmAuditDuplicates_(catSheet);
    }

    console.log(
      JSON.stringify(summary)
    );

    return summary;

  } finally {
    lock.releaseLock();
  }
}

function pcmReadTable_(sheet) {
  const lastRow =
    Math.max(sheet.getLastRow(), 1);

  const lastCol =
    Math.max(sheet.getLastColumn(), 1);

  const values =
    sheet
      .getRange(
        1,
        1,
        lastRow,
        lastCol
      )
      .getValues();

  const headers =
    values[0].map(function(v) {
      return String(v || '').trim();
    });

  const map = {};

  headers.forEach(function(h, i) {
    if (h) {
      map[h] = i;
    }
  });

  return {
    headers: headers,
    map: map,
    rows: values.slice(1)
  };
}

function pcmRequireHeaders_(
  map,
  required,
  sheetName
) {
  const missing =
    required.filter(function(h) {
      return map[h] === undefined;
    });

  if (missing.length) {
    throw new Error(
      sheetName +
      ' missing required headers: ' +
      missing.join(', ')
    );
  }
}

function pcmPlanSet_(
  writes,
  sheet,
  rowNumber,
  table,
  header,
  value
) {
  if (
    table.map[header] === undefined
  ) {
    return;
  }

  const clean =
    value === null ||
    value === undefined
      ? ''
      : value;

  const current =
    sheet
      .getRange(
        rowNumber,
        table.map[header] + 1
      )
      .getValue();

  if (
    String(current || '') !==
    String(clean || '')
  ) {
    writes.push({
      sheet: sheet,
      row: rowNumber,
      col: table.map[header] + 1,
      value: clean
    });
  }
}

function pcmPlanSetIfBlank_(
  writes,
  sheet,
  rowNumber,
  table,
  header,
  value
) {
  if (
    !value ||
    table.map[header] === undefined
  ) {
    return;
  }

  const cell =
    sheet.getRange(
      rowNumber,
      table.map[header] + 1
    );

  if (
    !pcmText_(cell.getValue())
  ) {
    writes.push({
      sheet: sheet,
      row: rowNumber,
      col: table.map[header] + 1,
      value: value
    });
  }
}

function pcmAuditDuplicates_(sheet) {
  const table =
    pcmReadTable_(sheet);

  const productKeys =
    new Map();

  const matchKeys =
    new Map();

  table.rows.forEach(
    function(row, index) {
      const rowNumber =
        index + 2;

      const pk =
        pcmText_(
          row[
            table.map[
              'PRODUCT KEY'
            ]
          ]
        );

      const mk =
        pcmText_(
          row[
            table.map[
              'MATCH KEY'
            ]
          ]
        );

      if (pk) {
        if (
          productKeys.has(pk)
        ) {
          throw new Error(
            'Duplicate Product Key after maintenance: ' +
            pk +
            ' rows ' +
            productKeys.get(pk) +
            ' and ' +
            rowNumber
          );
        }

        productKeys.set(
          pk,
          rowNumber
        );
      }

      if (mk) {
        if (
          matchKeys.has(mk)
        ) {
          throw new Error(
            'Duplicate Match Key after maintenance: ' +
            mk +
            ' rows ' +
            matchKeys.get(mk) +
            ' and ' +
            rowNumber
          );
        }

        matchKeys.set(
          mk,
          rowNumber
        );
      }
    }
  );

  return {
    productKeys:
      productKeys.size,

    matchKeys:
      matchKeys.size
  };
}

function pcmIdentity_(
  retailer,
  item
) {
  return (
    pcmNormalize_(retailer) +
    '|' +
    pcmNormalize_(item)
  );
}

function pcmNormalize_(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\u00A0/g, ' ')
    .replace(
      /[^A-Z0-9]+/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function pcmText_(value) {
  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  ).trim();
}
