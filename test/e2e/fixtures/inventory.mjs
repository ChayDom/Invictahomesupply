// ===================================================================
// Deterministic, hand-authored inventory fixture for E2E tests — never
// real Airtable data. Shaped exactly like a real /api/inventory
// response ({ records: [{ id, fields: {...} }] }), i.e. raw Airtable
// field names, so it exercises the real mapAirtableRecord() mapping in
// inventory.js rather than pre-mapped item objects.
// ===================================================================
export const INVENTORY_FIXTURE = {
  records: [
    {
      id: "recAPPLIANCE001",
      fields: {
        "Product Key": "APP-001",
        Name: "Stainless Steel French Door Refrigerator",
        Category: "Appliances",
        Subcategory: "Refrigerator",
        Brand: "Samsung",
        Price: 899,
        "Was Price": 1499,
        "Quantity Available": 3,
        Retailer: "Home Depot",
        Details: "Brand-new, minor cosmetic dent on side panel not visible after install.",
      },
    },
    {
      id: "recAPPLIANCE002",
      fields: {
        "Product Key": "APP-002",
        Name: "Gas Range with Convection Oven",
        Category: "Appliances",
        Subcategory: "Range",
        Brand: "LG",
        Price: 649,
        "Quantity Available": 1,
        Retailer: "Lowes",
      },
    },
    {
      id: "recFLOORING001",
      fields: {
        "Product Key": "LEG-HD-001157",
        Name: "Legacy Oak Luxury Vinyl Plank",
        Category: "Flooring",
        Subcategory: "Luxury Vinyl Plank",
        Brand: "Legacy",
        Price: 2.49,
        "Box Price": 42.11,
        "Sq Ft Per Unit": 24,
        "Available Sq Ft": 480,
        "Quantity Available": 20,
        "Thickness MM": 8,
        "Wear Layer MIL": 20,
        "Water Resistance": "Waterproof",
        Retailer: "Floor & Decor",
        Details: "Waterproof rigid-core LVP, 20 mil wear layer.",
      },
    },
    {
      id: "recFLOORING002",
      fields: {
        "Product Key": "LEG-HD-002",
        Name: "Legacy Walnut Laminate",
        Category: "Flooring",
        Subcategory: "Laminate",
        Brand: "Legacy",
        Price: 1.79,
        "Box Price": 35.8,
        "Sq Ft Per Unit": 20,
        "Available Sq Ft": 100,
        "Quantity Available": 5,
        Retailer: "Floor & Decor",
      },
    },
    {
      id: "recFLOORING003",
      fields: {
        "Product Key": "UND-001",
        Name: "Premium Underlayment Roll",
        Category: "Flooring",
        Subcategory: "Underlayment",
        Brand: "QuietWalk",
        Price: 0.35,
        "Available Sq Ft": 1500,
        "Quantity Available": 30,
        Retailer: "Home Depot",
      },
    },
    {
      id: "recTOOLS001",
      fields: {
        "Product Key": "TL-001",
        Name: "Cordless Drill Kit",
        Category: "Tools",
        Subcategory: "Power Tools",
        Brand: "DeWalt",
        Price: 129,
        "Quantity Available": 0,
        Status: "Sold Out",
        Retailer: "Amazon",
      },
    },
  ],
};

// The one product used for direct product-detail-page E2E specs — its
// productKey/id must match a record above (APP-001) so /product.html
// and /shop.html render the same underlying item consistently.
export const REGULAR_PRODUCT_KEY = "APP-001";
export const FLOORING_PRODUCT_KEY = "LEG-HD-001157";
