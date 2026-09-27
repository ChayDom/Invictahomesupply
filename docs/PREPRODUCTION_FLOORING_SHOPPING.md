# Flooring shopping pre-production candidate

This is a review candidate, not a production release. Do not deploy Apps Script,
alter the live workbook/triggers, merge to main, or use production acceptance data
without separate approval.

## Architecture

The reviewed backend checkpoint is e572337. The existing calculator branch was
integrated with a clean no-fast-forward merge (48f316b). Its standalone calculator
removal, existing modal purchase helper, whole-case coverage, stock shortage,
styles and tests are retained and enhanced rather than replaced by another engine.

Product detail and the general/multi-room modal both call calcProjectEstimate,
calcRecommendedSqFt and calcPurchaseEstimate in inventory.js. The desktop quick
area estimate also calls calcRecommendedSqFt. Box Price is authoritative.
Only when it is absent/invalid does existing boxPriceInfo derive a visibly
approximate estimate from Price and Sq Ft Per Unit.

Existing Airtable properties remain unchanged: price, wasPrice, boxPrice,
sqFtPerUnit, availableSqFt, retailSku and productKey. WebsiteAirtableSync maps
COMPARABLE RETAIL PRICE to the existing Airtable Was Price field; there is no
second frontend schema. All backend files are unchanged from the reviewed
checkpoint, including permanent identity, K2 ownership, formatting and enrichment.

## Customer behavior

- Calculate My Project links to the existing product detail page and calculator.
- Waste supports 0%, 5%, 10% (default) and 15%; results round up to whole cases.
- Missing/invalid project, pack, price or inventory asks for confirmation.
- Shortage compares actual case coverage with available square footage.
- Multi-room feet/inches remain, with editable room names and optional product.
- Quote inputs are retained by permanent Product Key, not mutable SKU.
- Quotes carry base area separately from waste-adjusted area, avoiding double waste.
- Static Netlify quote-request registration includes every added submission field.
- Flooring alone gets McKinney pickup-only and local delivery for an additional
  fee with a delivery quote; individual flooring orders are not shipped.
- Sold-out retention uses the persisted Airtable Sold Out Since datetime; see
  SOLD_OUT_LIFECYCLE.md for the scoped sync and export release prerequisites.
- Comparable retail displays only for finite positive prices above selling price.
- Existing dynamic facets, price sorting, mobile drawer and Contractor View remain.
- Search includes retail SKU and customer-facing structured specs, not Product Key.

Collapsed desktop cards align; expanding details restores independent sizing.
Contractor table cells remain table cells, with flex layouts inside wrappers.
Calculator/quote results are live regions; modal focus is trapped and restored to
the actual trigger, including WebKit pointer clicks. Calculators remain local-only.

## Local verification

Install dependencies and Playwright Chromium/WebKit using the existing development
instructions. Start a local Python HTTP server in the repository on port 8099
(on Windows use a verified installed Python executable if python3 is unavailable).
Playwright reuses that server outside CI.

```text
npm run test:unit
npx playwright test --project=chromium --project=webkit --workers=2
git diff --check
node test/visual-flooring-shopping.mjs <absolute-screenshot-output-directory>
```

New coverage is in test/flooring-shopping.test.mjs and
test/e2e/flooring-shopping.spec.mjs. Synthetic fixtures exercise the real
Airtable mapping. API responses, image requests and quote POSTs are mocked.
No tests here send customer submissions or mutate live inventory.

## Controlled acceptance still required

Before any preview deployment, verify its environment: repository configuration
does not establish a separate preview Airtable base/token or workbook. A branch
deploy must not silently inherit production data or submission destinations.
Review branch-deploy settings and explicitly isolate credentials, inventory,
forms, Apps Script project, workbook, Gemini requests and Social/Buffer targets.

In that approved test environment, verify every new Product Catalog A:AC field,
K2 MAP spill and J/K/L workbook currency formatting. Rerun maintenance and prove
no duplicate row; run enrichment and verify R:X; inspect Website Export A:AC,
the permanent Product Key and comparable retail; upsert one test Airtable record;
check the preview product/calculator/quote; inspect Social Queue where applicable.
Then correct Retail SKU and verify the same catalog row and Product Key, changed
Product ID, no duplicate and the same Airtable record and website product URL.

Passing mocked tests does not complete this workbook/form/provider acceptance.
Estimates do not reserve stock and exclude taxes, installation and delivery.
Per-product fulfillment is deliberately a replaceable UI policy, not invented data.
Existing inventory caching can delay availability updates; final stock requires
human confirmation. Missing specs suppress facets according to existing rules.
