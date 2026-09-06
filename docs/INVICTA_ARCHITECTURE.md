Invicta Home Supply — Master Project Handoff for Codex
1. Business / website purpose

Invicta Home Supply sells flooring and home-improvement inventory in the DFW / McKinney, Texas area.

Website:
https://invictahomesupply.com

Netlify project:
invictahomesupply

GitHub repo:
ChayDom/Invictahomesupply

The site is not a normal ecommerce checkout site. The goal is:

show current inventory
show useful product details
show pricing clearly
let customers request a quote
let customers text about a product
support local pickup / delivery
keep inventory synced from Airtable

Do not turn this into Shopify-style checkout unless explicitly requested.

2. Production architecture

The current intended data flow is:

Walmart Shopping source workbook
→ Current Inventory
→ Product Inventory
→ Product Catalog
→ Website Export
→ Airtable Website Products
→ Netlify serverless inventory function
→ inventory.js
→ website

Website production hosting is Netlify.

Do not migrate to Cloudflare.

Airtable is the website data backend.

The stable identity across systems is:

Product Key

Do not use Product ID as the website merge/upsert key.

3. Google Sheets architecture
Source workbook

Google Sheet:
Walmart Shopping

Spreadsheet ID:
1Z3Nc61c8LOX1rjWNGBuC0wfMUXdbrc6vqYrmMaH5B7Y

Retailer/source tabs feed the Master Sheet.

Current standardized source schema:

A Item
B Category
C Subcategory
D Retail SKU
E Buy Date
F Buy Quantity
G Total Buy Price
H Ownership %
I My Buy Price
J Unit Cost
K Sold Quantity
L Balance
M Last Sold Date
N Full Sale Price
O My Sale Price
P Inventory Cost Left
Q Full Profit
R My Profit
S Comments
T Status
U Return Date
V Retail Price
W Batch ID
X Product ID
Y Retailer
Z Buy Year
AA Sale Year
AB Year - Month

Master Sheet currently stacks retailer tabs.

Master Inventory Tracker

Google Sheet:
Master_Inventory_Tracker_2

Spreadsheet ID:
1mB0F1zDjy0BoJvEKU81Z-WnGlkSJOPM6cwNUR3a7Oj4

Important sheets:

Current Inventory
Product Inventory
Product Catalog
Website Export
4. Current Inventory

This pulls active inventory from the source workbook.

Current formula:

=LET(
  data,IMPORTRANGE(
    "1Z3Nc61c8LOX1rjWNGBuC0wfMUXdbrc6vqYrmMaH5B7Y",
    "'Master Sheet'!A1:AA"
  ),
  bal,CHOOSECOLS(data,12),
  FILTER(
    data,
    (SEQUENCE(ROWS(data))=1)+IFERROR(bal>0,FALSE)
  )
)

Important:

Current Inventory keeps only inventory with balance > 0
Product Key is generated separately
Product Key is the stable downstream identity
5. Product Inventory

Current schema:

A PRODUCT KEY
B PRODUCT ID
C RETAIL SKU
D ITEM
E CATEGORY
F RETAILER
G TOTAL BUY QUANTITY
H TOTAL SOLD QUANTITY
I QUANTITY AVAILABLE
J AVAILABLE SQ FT
K BATCH COUNT
L ID TYPE
M SUBCATEGORY

Subcategory was added recently.

There are currently about 548 inventory products.

Current inventory coverage against Product Catalog was already audited:

no missing Home Depot / Lowe’s Product Keys
no Product Key duplicates in clean state
6. Product Catalog

This is the long-term enriched website/catalog layer.

Current schema A:AF:

A DISPLAY NAME
B WEBSITE CATEGORY
C RETAILER
D RETAIL SKU
E BRAND
F MODEL
G SQ FT PER UNIT
H SELL PRICE ($/SQ FT OR EACH)
I AUTO BOX PRICE
J POST TO WEBSITE
K STOCK IMAGE URL
L PRODUCT URL
M DESCRIPTION
N HIGHLIGHTS
O ENRICHMENT STATUS
P NOTES
Q UNIT TYPE
R SOURCE ITEM
S SOURCE CATEGORY
T PRODUCT KEY
U MATCH KEY
V PRODUCT ID
W CURRENT SYNC HASH
X LAST SYNCED HASH
Y CONTENT LOCKED
Z ENRICHMENT CONFIDENCE
AA LAST ENRICHED AT
AB WEB SUBCATEGORY
AC THICKNESS MM
AD WEAR LAYER MIL
AE UNDERLAYMENT ATTACHED
AF WATER RESISTANCE

Important:

Do not delete or shift columns W:X yet
older enrichment code uses numeric positions
deleting them could shift Y:AF and break existing logic

Water Resistance values:

Waterproof
Water Resistant
Not Water Resistant
Unknown

Underlayment Attached:

Yes
No

Do not convert Water Resistance into a simple Yes/No field.

7. Catalog cleanup already completed

A bad maintenance script previously created malformed duplicate rows because it assumed Product Key / Match Key were in the wrong columns.

Cleanup already performed:

hundreds of malformed duplicate rows deleted
valid Product Keys retained
duplicate Product Keys = 0
inventory coverage restored

The old 6-hour Product Catalog maintenance trigger is intentionally PAUSED.

Do not re-enable it casually.

8. Product Catalog maintenance replacement

A new header-based replacement script was designed:

ProductCatalog_Maintenance_v2.js

Its intended behavior:

never rewrite an existing Product Key
match inventory using Product Key or Match Key
optionally reconcile one exact legacy identity match
write only source-controlled identity fields
initialize Website Category / Subcategory only when blank
append clean new products with PENDING enrichment
refuse duplicate Product Keys / Match Keys
provide dry-run
provide actual run
audit duplicates afterward

Important correction already made:

do not overwrite existing Product Catalog SOURCE CATEGORY on matched rows
Product Inventory Category is canonical taxonomy
Product Catalog SOURCE CATEGORY may contain useful raw retailer/source category

Simulated clean-state result:

548 inventory products
548 matches
0 new products
0 planned field changes
0 duplicate Product Keys
0 duplicate Match Keys

Do not blindly overwrite live Apps Script. Compare with existing live code and preserve other functions such as Gemini enrichment.

9. Website Export

Current existing fields A:U:

A PRODUCT KEY
B DISPLAY NAME
C CATEGORY
D BRAND
E MODEL
F RETAIL SKU
G RETAILER
H QUANTITY AVAILABLE
I UNIT TYPE
J SQ FT PER UNIT
K AVAILABLE SQ FT
L WEBSITE PRICE
M DESCRIPTION
N HIGHLIGHTS
O PRODUCT URL
P STOCK IMAGE URL
Q POST TO WEBSITE
R ENRICHMENT STATUS
S IN STOCK
T SYNC HASH
U BOX PRICE

Recently appended:

V SUBCATEGORY
W THICKNESS MM
X WEAR LAYER MIL
Y UNDERLAYMENT ATTACHED
Z WATER RESISTANCE

These map from Product Catalog by Product Key.

Do not shift the existing A:U layout unless absolutely necessary.

10. Airtable

Base:
Reseller Inventory

Base ID:
apptugvm4r5tm2OIt

Website table:
Website Products

Table ID:
tblUyA3uFL6FmMw6T

Website identity:
Product Key

Current important fields include:

Name
Product Key
Category
Brand
Model
Retail SKU
Retailer
Price
Price Basis
Box Price
Quantity Available
Unit Type
Sq Ft Per Unit
Available Sq Ft
Details
Highlights
Product URL
Photos
Reference Image URL
Post to Website
Status
Was Price
Date Added
Sync Hash
Date Reserved

Five new structured fields were added:

Subcategory
Thickness MM
Wear Layer MIL
Underlayment Attached
Water Resistance

The sync should:

upsert using Product Key
preserve Airtable-only fields such as Photos
preserve Was Price
preserve Status
preserve Date Added
preserve Date Reserved
unpublish stale records rather than delete them
11. Airtable sync validation already completed

A direct Product-Key upsert test was already performed.

At the time:

24 Airtable Website Products records
22 published
0 duplicate Product Keys
0 missing Subcategories
0 missing Underlayment values

A stale Dusk Cherry record was unpublished.

The data model itself is proven to work.

12. Website Export → Airtable replacement script

Replacement file:

WebsiteExport_Airtable_Sync_v2.js

Intended behavior:

header-based
Product Key merge identity
sync structured fields
preserve Airtable-only fields
stale records get unpublished
requires Script Property AIRTABLE_TOKEN

Do not blindly replace all existing Apps Script code without reviewing what existing functions must be retained.

13. Canonical website categories

These are final:

Flooring
Water Heaters
Appliances
Plumbing & Bath
Lawn & Outdoor
Tools
Home Improvement

Do not use old website categories such as:

Renovation Supplies

The website filter UI should use the canonical seven categories plus All.

14. Website merchandising model

Main category:
CATEGORY

Specific category:
SUBCATEGORY

Examples:

Category:
Flooring

Subcategory:
Luxury Vinyl Plank

or:
Laminate

or:
Tile

Use structured fields when available rather than parsing free-text descriptions.

15. Flooring structured fields

These are authoritative website fields:

Subcategory
Thickness MM
Wear Layer MIL
Underlayment Attached
Water Resistance

Preferred flooring card priority:

Wear Layer MIL
Thickness MM
Underlayment Attached
Water Resistance

Then optionally Highlights.

Do not fabricate missing values.

Do not display Unknown prominently if it can simply be omitted.

Do not infer specifications from product names if structured data is blank unless explicitly required.

16. Flooring price presentation

Current good behavior should be preserved.

For flooring show:

$1.55 / sq ft

$37.25 / box

24.03 sq ft / box

1,845 sq ft available

This is much more useful than just showing a single generic price.

17. Flooring UX direction

The flooring catalog should be scan-friendly.

Preferred presentation:

Product name

Subcategory

Compact structured specs:
5 mm · 12 MIL · Pad Attached · Waterproof

Price per sqft

Box price

Sqft per box

Available sqft

Get a Quote

Text Us

The long Description / Highlights should remain secondary.

Do not make the cards unnecessarily tall.

Desktop should show a compact catalog-like view.

Mobile must remain readable and tappable.

18. Non-flooring products

Non-flooring products may remain standard cards.

Do not force flooring-specific specs onto:

appliances
water heaters
tools
plumbing
outdoor
home improvement

Use category-aware rendering.

19. Images

Airtable Photos is the primary product-image source.

Reference Image URL may be used as fallback.

Do not replace uploaded Airtable Photos with reference URLs.

Do not expose Airtable credentials client-side.

20. Current Netlify architecture

Netlify serverless function:

netlify/functions/inventory.mts

Route:

/api/inventory

The server-side function:

reads Airtable credentials from Netlify environment variables
requests Airtable records
filters using:
{Post to Website} = TRUE()
returns inventory JSON
currently has about a 5-minute CDN cache

This architecture is correct.

Do not move Airtable API credentials into browser JavaScript.

21. Current frontend architecture

inventory.js

Current browser behavior:

fetch /api/inventory
use about 15-minute localStorage cache
map Airtable records
render product cards
filters and sorts client-side
quote functionality
SMS functionality
flooring calculator
image thumbnails

Preserve all existing working features unless specifically improving them.

22. Known frontend gap

The latest reviewed website branch still had old filter buttons:

All
Flooring
Renovation Supplies
Appliances
Tools

This must be replaced by:

All
Flooring
Water Heaters
Appliances
Plumbing & Bath
Lawn & Outdoor
Tools
Home Improvement
23. Another known frontend gap

The reviewed inventory.js was still not consuming the five structured fields.

It needs to map:

subcategory
thicknessMm
wearLayerMil
underlaymentAttached
waterResistance

from Airtable:

Subcategory
Thickness MM
Wear Layer MIL
Underlayment Attached
Water Resistance

Then use these fields directly in the UI.

24. Current Netlify preview reviewed

A recent branch deployment:

branch:
claude/product-cards-responsive-4wu1nr

commit:
aac80604a0694c9293ffdc76ebfad43c3aca76a5

It was a revert commit:
Revert "Compact catalog: sidebar layout, 4-col desktop grid, condensed cards"

The deploy itself was healthy:

ready
no build error
inventory function deployed

But it was not ready to merge because the structured-field and canonical-category work was incomplete.

25. Features that should definitely be preserved

Do not break:

Airtable-backed inventory
Product Key identity
Post to Website filtering
existing product photos
flooring price/sqft display
box pricing
available sqft display
quote modal
SMS link
flooring calculator
search
sorting
responsive mobile layout
Netlify function security
existing canonical domain
26. GitHub / deployment strategy

Prefer:

feature branch
→ implement
→ syntax/build test
→ Netlify branch preview
→ visual review
→ merge only after approval

Do not push major UI changes straight to production unless explicitly instructed.

27. Apps Script safety rule

The Product Catalog maintenance trigger must remain:

PAUSED

until all of these pass:

replacement code reviewed
dry-run succeeds
real controlled run succeeds
duplicate Product Key audit = 0
duplicate Match Key audit = 0
no existing enrichment overwritten unexpectedly

Only after that should it be re-enabled.

28. Final required live test

After Apps Script and website changes are complete, perform a controlled end-to-end test using one known flooring product such as Chestnut Oak.

Test:

price:
$1.55 → $1.56

Run sync.

Verify:

same Product Key
same Airtable record
no duplicate
price updated
available sqft correct
image retained
structured specs retained

Restore:
$1.55

Then test:

Post to Website = No

Verify:

disappears from website

Then restore intended state.

Only after both tests pass:
freeze architecture

29. Immediate coding tasks for Codex

Inspect the current repository before changing anything.

Then:

Update netlify/functions/inventory.mts only if required to normalize/return fields cleanly.
Update inventory.js to consume:
Subcategory
Thickness MM
Wear Layer MIL
Underlayment Attached
Water Resistance
Replace old category filters in shop.html with canonical seven.
Add structured flooring spec chips.
Add flooring Subcategory support/filtering if appropriate.
Keep existing pricing, quote, SMS, search, sorting, photo behavior, calculator.
Ensure non-flooring cards remain clean.
Ensure empty structured fields don't cause broken UI.
Test mobile.
Test desktop.
Run syntax/build checks.
Produce Netlify preview.
Do not merge until reviewed.
30. Do not do these things

Do NOT:

change Product Key semantics
use Product ID as Airtable merge key
expose Airtable credentials in client JS
migrate off Netlify
delete Airtable stale records when unpublishing is sufficient
delete Product Catalog W:X yet
overwrite existing enrichment blindly
re-enable maintenance trigger early
parse arbitrary free text when structured fields exist
introduce a checkout/cart unless explicitly requested
rename canonical categories casually
remove quote/SMS/calculator functionality
break current Photos behavior
31. Current project priority

Priority 1 is still:

finish and freeze the inventory → Airtable → website pipeline

Completed:

Category/Subcategory architecture
Current Inventory repair
Product Inventory repair
Product Catalog cleanup
Product Catalog schema
Website Export schema
Airtable schema
Airtable structured data
Product-Key upsert validation
stale publishing cleanup
replacement maintenance logic design

Still pending:

final repo/frontend implementation
Apps Script live deployment
final end-to-end test
freeze architecture
re-enable maintenance trigger

Do not distract into unrelated redesign work until this pipeline is stable.

Instruction to Codex

Before making changes:

Read the actual current repo first. Do not assume this handoff perfectly reflects every latest line of code.

Treat this handoff as the architecture and business requirements, and the repository as the current implementation state.

If the repo conflicts with this handoff:

preserve working functionality
identify the conflict
align the code toward this architecture
do not silently remove behavior

At the end report:

files changed
why each changed
tests run
Netlify preview URL
anything still requiring manual Apps Script work
any architecture conflict found
whether it is safe to merge
whether it is safe to re-enable the maintenance trigger
