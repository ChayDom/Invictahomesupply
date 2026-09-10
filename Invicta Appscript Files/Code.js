/**
 * INVICTA HOME SUPPLY — MASTER INVENTORY AUTOMATION
 *
 * PURPOSE
 * This Apps Script project maintains the permanent Product Catalog,
 * enriches product information, prepares Website Export data, and
 * synchronizes approved inventory with Airtable.
 *
 * This Code.gs file is documentation only.
 * It intentionally contains no executable functions.
 *
 *
 * INVENTORY FLOW
 *
 * Walmart Shopping
 *   → Current Inventory
 *   → Product Inventory
 *   → Product Catalog
 *   → Website Export
 *   → Airtable
 *   → Invicta Home Supply website
 *
 *
 * PRODUCT CATALOG IDENTITY
 *
 * Column T: Permanent Product Key
 *   - Never changed after creation.
 *   - Historical products retain keys such as LEG-HD-001515.
 *
 * Column U: Current Match Key
 *   - Updated when a real Retail SKU becomes available.
 *   - Example: HD-1013910175.
 *
 * Column V: Current Product ID
 *   - Current Retailer Code + Retail SKU identity.
 *   - Example: HD-1013910175.
 *
 * A legacy catalog row must remain attached to its permanent LEG-...
 * Product Key. Adding a Retail SKU updates its Match Key and Product ID;
 * it must not create a second catalog row.
 *
 *
 * FILE MAP
 *
 * Config.gs
 *   Sheet names, Product Catalog column mappings, key normalization,
 *   configuration values, and shared validation helpers.
 *
 * CatalogSync.gs
 *   Product Catalog synchronization, source-field refresh, automatic
 *   box-price formulas, and runProductCatalogMaintenance().
 *
 * LegacyRepair.gs
 *   Automatic and manual reconciliation of historical LEG-... and
 *   obsolete LEGACY|... identities. Permanent Product Keys are preserved.
 *
 * CatalogEnrichment.gs
 *   Gemini product enrichment processing.
 *
 * EnrichmentAdmin.gs
 *   Enrichment auditing, queue management, API-key checks, and trigger
 *   administration.
 *
 * WebsiteAirtableSync.gs
 *   Publishes eligible Website Export rows to Airtable using Product Key
 *   upserts. Ineligible products are unpublished, not deleted.
 *
 * AdminTools.gs
 *   Spreadsheet menu and Product Catalog audit utilities.
 *
 *
 * REQUIRED MAINTENANCE ORDER
 *
 * runProductCatalogMaintenance() must execute:
 *
 *   1. reconcileLegacyCatalogRowsAutomatically_()
 *   2. syncProductCatalogKeys()
 *   3. ensureProductCatalogAutoBoxPriceFormulas_()
 *   4. refreshProductCatalogSourceFields()
 *   5. SpreadsheetApp.flush()
 *   6. auditProductCatalogDuplicateKeys()
 *
 * Legacy reconciliation must run before new Product Catalog rows are added.
 *
 *
 * EXPECTED INSTALLED TRIGGERS
 *
 * runProductCatalogMaintenance
 *   - Time-driven
 *   - Every six hours
 *
 * syncWebsiteExportToAirtable
 *   - Time-driven
 *   - Hourly
 *
 * runCatalogEnrichment
 *   - Time-driven
 *   - Daily at approximately 3 AM Central
 *
 *
 * EXPECTED PROJECT TIMEZONE
 *
 * America/Chicago
 *
 *
 * SAFETY RULES
 *
 * - Never change an established permanent Product Key.
 * - Never delete an established LEG-... row merely because a SKU was added.
 * - Never create a second catalog row when a legacy row can be uniquely
 *   reconciled.
 * - Skip ambiguous legacy matches instead of guessing.
 * - Preserve descriptions, images, prices, enrichment, and website settings.
 * - Airtable synchronization must upsert by Product Key.
 * - Airtable records that become ineligible must be unpublished, not deleted.
 */