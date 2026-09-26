/**
 * INVICTA HOME SUPPLY — bound Apps Script project (V8, America/Chicago).
 * Retailer/master -> Current Inventory -> Product Inventory -> Product Catalog
 * -> formula-driven Website Export -> Airtable -> website.
 * Website Export also feeds Social Queue -> approved Buffer posts.
 *
 * PRODUCT KEY is permanent internal identity (AA in the current catalog).
 * PRODUCT ID is current retailer code + editable Retail SKU (AB).
 * SKU corrections update the same catalog row and preserve its Product Key.
 *
 * Config.js: authoritative 29 headers and shared lookup helpers.
 * ProductCatalogMaintenance.js: validate/plan reconciliation and additions,
 *   then write source-owned fields under one lock. Never writes AUTO BOX PRICE.
 * LegacyRepair.js: existing repair handlers reuse the same reconciliation planner.
 * CatalogEnrichment.js: exact, high-confidence, cited enrichment fills blank fields.
 * EnrichmentAdmin.js: read-only audit, explicit queue and trigger setup handlers.
 * WebsiteAirtableSync.js: permanent Product Key upserts, retries, stale unpublishing.
 * BufferSocialSync.js: source facts hash, manual approval and operational Buffer IDs.
 * AdminTools.js: menu and identity audit.
 *
 * Existing trigger handler names remain available. No trigger installation runs
 * on file load. AUTO BOX PRICE belongs to the workbook's K2 spill formula.
 * Deploy only after the documented new-product + SKU-correction acceptance test.
 */
