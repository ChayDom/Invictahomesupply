/**
 * Temporary manual test entry point for automatic legacy reconciliation.
 * This can be removed after automation is verified.
 */
function testAutomaticLegacyReconciliation() {
  return reconcileLegacyCatalogRowsAutomatically_();
}
/**
 * Repairs historical Product Catalog identities.
 *
 * Supports current LEG-... and obsolete LEGACY|... permanent keys.
 * Never changes the permanent Product Catalog Product Key.
 *
 * Two operating modes:
 * 1. repairAndUpgradeLegacyCatalogRows()
 *    Manual preview and confirmation.
 *
 * 2. reconcileLegacyCatalogRowsAutomatically_()
 *    Automatic repair used by scheduled Product Catalog maintenance.
 */

function repairAndUpgradeLegacyCatalogRows() {
  const plan = legacyRepairPlan_();
  const ui = SpreadsheetApp.getUi();

  const answer = ui.alert(
    'Legacy catalog repair - dry-run preview',
    legacyRepairPreview_(plan) +
      '\n\nApply exactly these changes now?',
    ui.ButtonSet.YES_NO
  );

  if (answer !== ui.Button.YES) {
    const result = {
      dryRun: true,
      applied: 0,
      summary: plan.summary
    };

    console.log(JSON.stringify(result));
    return result;
  }

  const applied = legacyRepairApply_(plan);

  ui.alert(
    'Legacy catalog repair complete',
    'Applied ' +
      applied +
      ' row update(s). Ambiguous matches skipped: ' +
      plan.summary.ambiguous +
      '.',
    ui.ButtonSet.OK
  );

  const result = {
    dryRun: false,
    applied: applied,
    summary: plan.summary
  };

  console.log(JSON.stringify(result));
  return result;
}

/**
 * Automatically repairs unambiguous legacy catalog identities.
 *
 * This is called by runProductCatalogMaintenance() before
 * syncProductCatalogKeys().
 *
 * Permanent Product Catalog Product Keys are never changed.
 * Ambiguous and unmatched records are skipped.
 */
function reconcileLegacyCatalogRowsAutomatically_() {
  const plan = legacyRepairPlan_();

  let applied = 0;

  if (plan.plans.length > 0) {
    applied = legacyRepairApply_(plan);
  }

  console.log(
    'Automatic legacy reconciliation complete. ' +
      'Legacy rows: ' +
      plan.summary.catalogLegacyRows +
      ' | Applied: ' +
      applied +
      ' | Ambiguous skipped: ' +
      plan.summary.ambiguous +
      ' | Unmatched skipped: ' +
      plan.summary.unmatched +
      ' | Already current: ' +
      plan.summary.unchanged
  );

  return {
    applied: applied,
    summary: plan.summary
  };
}

/**
 * Builds a safe legacy-repair plan.
 *
 * Matching requires exactly one Product Inventory record with the
 * same normalized Retailer and Item/Source Item.
 */
function legacyRepairPlan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const invSheet = getInventorySheetOrThrow_(
    ss,
    INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET
  );

  const catSheet = getInventorySheetOrThrow_(
    ss,
    INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET
  );

  const inv = legacyRepairReadTable_(invSheet);
  const cat = legacyRepairReadTable_(catSheet);

  legacyRepairRequire_(
    inv.map,
    [
      'PRODUCT KEY',
      'PRODUCT ID',
      'RETAIL SKU',
      'RETAILER'
    ],
    'Product Inventory'
  );

  legacyRepairRequire_(
    cat.map,
    [
      'PRODUCT KEY',
      'MATCH KEY',
      'PRODUCT ID',
      'RETAIL SKU',
      'RETAILER',
      'SOURCE ITEM'
    ],
    'Product Catalog'
  );

  const itemHeader =
    inv.map['ITEM'] !== undefined
      ? 'ITEM'
      : inv.map['SOURCE ITEM'] !== undefined
        ? 'SOURCE ITEM'
        : null;

  if (!itemHeader) {
    throw new Error(
      'Product Inventory missing ITEM or SOURCE ITEM header.'
    );
  }

  const byIdentity = new Map();

  inv.rows.forEach(function(row) {
    const productKey = legacyRepairText_(
      row[inv.map['PRODUCT KEY']]
    );

    const retailer = legacyRepairText_(
      row[inv.map['RETAILER']]
    );

    const item = legacyRepairText_(
      row[inv.map[itemHeader]]
    );

    if (!productKey || !retailer || !item) {
      return;
    }

    const identity = legacyRepairIdentity_(
      retailer,
      item
    );

    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, []);
    }

    byIdentity.get(identity).push({
      productKey: productKey,

      productId:
        legacyRepairText_(
          row[inv.map['PRODUCT ID']]
        ) || productKey,

      retailSku: legacyRepairText_(
        row[inv.map['RETAIL SKU']]
      ),

      retailer: retailer,
      sourceItem: item
    });
  });

  const plans = [];

  const summary = {
    catalogLegacyRows: 0,
    planned: 0,
    ambiguous: 0,
    unmatched: 0,
    unchanged: 0
  };

  cat.rows.forEach(function(row, index) {
    const rowNumber = index + 2;

    const permanentKey = legacyRepairText_(
      row[cat.map['PRODUCT KEY']]
    );

    if (!legacyRepairIsLegacyKey_(permanentKey)) {
      return;
    }

    summary.catalogLegacyRows++;

    const retailer = legacyRepairText_(
      row[cat.map['RETAILER']]
    );

    const sourceItem = legacyRepairText_(
      row[cat.map['SOURCE ITEM']]
    );

    const candidates =
      retailer && sourceItem
        ? byIdentity.get(
            legacyRepairIdentity_(
              retailer,
              sourceItem
            )
          ) || []
        : [];

    if (candidates.length === 0) {
      summary.unmatched++;
      return;
    }

    if (candidates.length !== 1) {
      summary.ambiguous++;
      return;
    }

    const match = candidates[0];
    const changes = [];

    legacyRepairPlanField_(
      changes,
      'MATCH KEY',
      cat.map['MATCH KEY'],
      row[cat.map['MATCH KEY']],
      match.productKey
    );

    legacyRepairPlanField_(
      changes,
      'PRODUCT ID',
      cat.map['PRODUCT ID'],
      row[cat.map['PRODUCT ID']],
      match.productId
    );

    legacyRepairPlanField_(
      changes,
      'RETAIL SKU',
      cat.map['RETAIL SKU'],
      row[cat.map['RETAIL SKU']],
      match.retailSku
    );

    legacyRepairPlanField_(
      changes,
      'RETAILER',
      cat.map['RETAILER'],
      row[cat.map['RETAILER']],
      match.retailer
    );

    legacyRepairPlanField_(
      changes,
      'SOURCE ITEM',
      cat.map['SOURCE ITEM'],
      row[cat.map['SOURCE ITEM']],
      match.sourceItem
    );

    if (changes.length === 0) {
      summary.unchanged++;
      return;
    }

    plans.push({
      rowNumber: rowNumber,
      permanentKey: permanentKey,
      match: match,
      changes: changes
    });

    summary.planned++;
  });

  return {
    sheet: catSheet,
    plans: plans,
    summary: summary
  };
}

/**
 * Applies only the changes contained in the validated repair plan.
 */
function legacyRepairApply_(plan) {
  plan.plans.forEach(function(plannedRow) {
    plannedRow.changes.forEach(function(change) {
      plan.sheet
        .getRange(
          plannedRow.rowNumber,
          change.column + 1
        )
        .setValue(change.value);
    });
  });

  SpreadsheetApp.flush();

  return plan.plans.length;
}

/**
 * Creates the user-facing manual dry-run preview.
 */
function legacyRepairPreview_(plan) {
  const summary = plan.summary;

  const lines = [
    'Legacy catalog rows scanned: ' +
      summary.catalogLegacyRows,

    'Rows eligible for update: ' +
      summary.planned,

    'Ambiguous matches skipped: ' +
      summary.ambiguous,

    'Unmatched rows skipped: ' +
      summary.unmatched,

    'Already current: ' +
      summary.unchanged,

    '',

    'Only MATCH KEY, PRODUCT ID, RETAIL SKU, ' +
      'RETAILER and SOURCE ITEM will be written.',

    'Permanent Product Catalog Product Keys ' +
      'will not be changed.'
  ];

  plan.plans
    .slice(0, 12)
    .forEach(function(plannedRow) {
      lines.push(
        'Row ' +
          plannedRow.rowNumber +
          ' ' +
          plannedRow.permanentKey +
          ' -> ' +
          plannedRow.match.productKey
      );
    });

  if (plan.plans.length > 12) {
    lines.push(
      '... plus ' +
        (plan.plans.length - 12) +
        ' more row(s).'
    );
  }

  return lines.join('\n');
}

/**
 * Adds a field change only when the old and new values differ.
 */
function legacyRepairPlanField_(
  changes,
  header,
  column,
  oldValue,
  newValue
) {
  if (
    legacyRepairText_(oldValue) !==
    legacyRepairText_(newValue)
  ) {
    changes.push({
      header: header,
      column: column,
      value: newValue
    });
  }
}

/**
 * Reads a sheet using normalized header names.
 */
function legacyRepairReadTable_(sheet) {
  const lastRow = Math.max(
    sheet.getLastRow(),
    1
  );

  const lastColumn = Math.max(
    sheet.getLastColumn(),
    1
  );

  const values = sheet
    .getRange(
      1,
      1,
      lastRow,
      lastColumn
    )
    .getValues();

  const headers = values[0].map(
    legacyRepairHeader_
  );

  const map = {};

  headers.forEach(function(header, index) {
    if (header) {
      map[header] = index;
    }
  });

  return {
    headers: headers,
    map: map,
    rows: values.slice(1)
  };
}

/**
 * Confirms required headers exist before processing.
 */
function legacyRepairRequire_(
  map,
  required,
  sheetName
) {
  const missing = required.filter(
    function(header) {
      return map[header] === undefined;
    }
  );

  if (missing.length > 0) {
    throw new Error(
      sheetName +
        ' missing required headers: ' +
        missing.join(', ')
    );
  }
}

function legacyRepairHeader_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function legacyRepairText_(value) {
  return String(
    value === null || value === undefined
      ? ''
      : value
  ).trim();
}

function legacyRepairIdentity_(
  retailer,
  item
) {
  return (
    legacyRepairText_(retailer) +
    '\u001f' +
    legacyRepairText_(item)
  )
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function legacyRepairIsLegacyKey_(key) {
  return (
    /^LEG-/.test(key) ||
    /^LEGACY\|/.test(key)
  );
}