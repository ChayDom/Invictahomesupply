import {INVENTORY_FIXTURE} from "./inventory.mjs";
// Synthetic catalog only; deliberately use a rounded stored Box Price.
export const FLOORING_SHOPPING_FIXTURE=structuredClone(INVENTORY_FIXTURE);
Object.assign(FLOORING_SHOPPING_FIXTURE.records[2].fields,{
  Name:"Silver Oak Luxury Vinyl Plank",Brand:"LifeProof","Retail SKU":"100123456",
  Price:1.55,"Was Price":3.29,"Box Price":31.16,"Sq Ft Per Unit":20.1,
  "Available Sq Ft":7185,"Quantity Available":357,"Wear Layer MIL":22,
  "Thickness MM":6.5,"Underlayment Attached":"Yes",
});
Object.assign(FLOORING_SHOPPING_FIXTURE.records[3].fields,{
  "Wear Layer MIL":12,"Thickness MM":8,"Underlayment Attached":"No","Water Resistance":"Water Resistant"
});
