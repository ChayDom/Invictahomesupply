/**
 * Compatibility entry points for identity reconciliation. The same planner used
 * by maintenance handles legacy and standard SKU corrections without key changes.
 */
function testAutomaticLegacyReconciliation() { return reconcileLegacyCatalogRowsAutomatically_(); }
function repairAndUpgradeLegacyCatalogRows() {
  const context = readCatalogMaintenancePlan_();
  const ui = SpreadsheetApp.getUi();
  const preview = context.plan.updates.map(function(row) {
    return 'Row ' + row.rowNumber + ' (' + row.permanentKey + '): ' +
      row.changes.map(function(change) { return change.header + ' = ' + change.value; }).join(', ');
  }).join('\n');
  if (ui.alert('Catalog reconciliation preview', (preview || 'No changes.') +
      '\n\nApply these updates? Permanent keys are preserved.', ui.ButtonSet.YES_NO) !== ui.Button.YES) {
    return { dryRun: true, applied: 0 };
  }
  // Replan under the lock; never apply a stale preview after concurrent edits.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const current = readCatalogMaintenancePlan_();
    if (JSON.stringify(current.plan.updates) !== JSON.stringify(context.plan.updates)) {
      throw new Error('Catalog changed after preview. Run the preview again.');
    }
    const result = applyCatalogMaintenancePlan_(current, false);
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}
function reconcileLegacyCatalogRowsAutomatically_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = applyCatalogMaintenancePlan_(readCatalogMaintenancePlan_(), false);
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}
