# Invicta Home Supply — project handoff

This handoff supersedes the old positional workbook instructions. The authoritative
current schema, runtime behavior and release gate are in:

- [System architecture](architecture/Invicta-Home-Supply-System-Architecture.md)
- [Apps Script refactor and mandatory live acceptance](APPS_SCRIPT_WORKBOOK_REFACTOR.md)
- [Website README](../README.md)

The existing architecture slide deck
`architecture/Invicta-Home-Supply-System-Architecture.pptx` is a historical,
pre-workbook-refactor snapshot. Its old schema labels are not deployment instructions.
It has not been regenerated in this code-only refactor; use the Markdown documents.

## Business and systems

Invicta Home Supply is a local flooring/home-improvement supplier in DFW/McKinney.
The site shows real inventory and transparent prices, supports quotes/text/pickup/
delivery, and is not a checkout/cart application. Keep its existing calculator,
product pages, filtering, quote/SMS flows, images and mobile behavior.

Production hosting remains Netlify. Airtable is a mirror, not the source of truth;
credentials remain server-side. Stale products are unpublished rather than deleted.

Retailer/source sheets feed Current Inventory and Product Inventory. Product Catalog
owns durable customer-facing content and manual merchandising controls.
The existing formula-driven Website Export combines catalog and current stock.
Airtable mirrors export for Netlify's read-only inventory API and the website.

Source workbook ID (historical source reference):
`1Z3Nc61c8LOX1rjWNGBuC0wfMUXdbrc6vqYrmMaH5B7Y`.
Inventory/catalog workbook ID:
`1mB0F1zDjy0BoJvEKU81Z-WnGlkSJOPM6cwNUR3a7Oj4`.

Source and inventory formulas are live workbook resources, not deployable repository
code; verify their actual ranges and lookup behavior before release. Do not copy a
formula from an older handoff over the manually corrected live export.

## Current workbook contract

Product Catalog has exactly 29 columns A:AC. Readers resolve authoritative headers.
Product Key is permanent. Product ID reflects the current editable Retail SKU.
Maintenance and legacy reconciliation share one planner; source SKU corrections
update the same catalog row, never replace its permanent key.

AUTO BOX PRICE is solely the K2 spill formula. No per-row formula writes.
Website Export has 29 columns and uses current Product ID to return permanent
Product Key. COMPARABLE RETAIL PRICE maps to Airtable Was Price.
Existing manual content, prices, publishing and curated images must be retained.

The current category taxonomy remains CATEGORY_CONFIG in inventory.js and the
matching Apps Script allowlists. Structured flooring specs are authoritative;
do not invent absent facts from product names. Preserve Photos as the primary
image source and reference-image fallback.

## Release gate

Work stays on a feature branch. Do not merge, deploy Apps Script, change installed
triggers or send Buffer posts automatically. Any maintenance trigger already paused
must remain paused until the owner explicitly approves restoring it.

Review code and automated tests, then execute the documented single-new-product
acceptance test covering every catalog field, K2, enrichment, export, Airtable and
Social Queue. The deliberate same-source SKU correction and proof of the SAME
catalog row/permanent key/Airtable record are mandatory. Do not call the refactor
production-complete or re-enable maintenance before this evidence exists.
