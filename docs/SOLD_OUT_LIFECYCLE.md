# Flooring sold-out lifecycle — staging validation

Add `Sold Out Since` (datetime, UTC) to Airtable Website Products before deploying
the revised bound-project sync. Staging field ID: `fldClXMijEmsslPF2`, base
`appLzUBCXBMzrgVx1`. There is no staging-specific business logic or new identity.
Product Catalog and Website Export remain 29 columns. Product Key remains the
sole upsert identity. The Netlify inventory API and edge lookup remain read-only.

## Website Export prerequisite (not applied to the live workbook)

Read-only inspection of the live Website Export A2 formula on 2026-09-27 confirmed
that the initial `keys` FILTER drops zero-stock and unknown-stock rows. Make only
this substitution in A2 in an isolated workbook before bound-project validation:

```diff
- keys,FILTER('Product Inventory'!A2:A,'Product Inventory'!A2:A<>"",'Product Inventory'!I2:I>0)
+ keys,FILTER('Product Inventory'!A2:A,'Product Inventory'!A2:A<>"")
```

Leave every subsequent LET binding, permanentKey lookup, HSTACK and U2:AC2 spill
formula unchanged. IN STOCK still reflects `qty > 0`; it no longer removes a row.
Social Queue retains its own POST TO WEBSITE + IN STOCK eligibility; zero-stock
rows are not queued or published to Buffer by this change. Non-flooring Airtable
publishing still requires IN STOCK. Manual POST TO WEBSITE opt-out still unpublishes.
Missing/invalid export rows never count as a confirmed zero observation.

This formula change is a release prerequisite, not a production workbook write.
The staging website reads synthetic Airtable inventory; no live bound Apps Script
or triggers were deployed during this validation cycle.

## Transitions and visibility

- A nonnegative numeric Available Sq Ft is authoritative; when unavailable, an
  explicit nonnegative Quantity Available confirms stock. Missing, negative,
  non-finite, boolean and blank values are not zero.
- Positive inventory: In Stock; clear Sold Out Since; same row/record/Product Key.
- Zero: Sold Out; preserve a valid existing datetime, otherwise stamp the first
  confirmed observation in UTC. Never backdate from Date Added or record creation.
- Unknown: Contact for Availability; clear an active timestamp so uncertainty
  cannot accrue ten days of confirmed zero. A later confirmed zero starts anew.
- Standard browsing hides confirmed zero at `now >= since + 864000000 ms` (ten
  full 24-hour days, not local calendar dates). One helper covers shop/category,
  search/facets/counts, Contractor View, homepage and general calculator choices.
  Open tabs rerender at the boundary; cached items retain the backend timestamp.
- Expiry does not delete/unpublish the record. Direct product links and historical
  identity remain available. Unknown/restocked items ignore stale expiry dates.
- Sold Out takes precedence over the seven-day New badge. Other categories retain
  their existing status and visibility rules.

## Fulfillment

Keep `Local Pickup Only • McKinney, TX`.

Flooring is currently available for local pickup in McKinney, TX. We do not currently ship individual flooring orders.

Local delivery is available for an additional fee. Contact us for a delivery quote.

No customer-facing freight/pallet offer remains. Material estimates exclude taxes,
installation and delivery; price/case/waste mathematics are unchanged.
