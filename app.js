/* ===================================================================
   Invicta Home Supply — site config + shared behavior

   EDIT THIS BLOCK to update contact info sitewide (every page reads
   from here — you only need to change it in one place).
   =================================================================== */
window.SITE_CONFIG = {
  businessName: "Invicta Home Supply",
  phoneDisplay: "(214) 552-2145",     // <-- replace with your real number
  phoneHref: "+12145522145",           // <-- same number, digits only, with country code
  email: "hello@invictahomesupply.com", // <-- replace with your real email
  city: "McKinney, TX",                // <-- replace with your pickup location/city
  pickupAddress: "Pickup by appointment — we'll send you the exact location after confirming your order.",
  hours: "Mon–Sat, 8am–8pm",
  facebookUrl: "https://www.facebook.com/invictahomesupply/", // <-- replace with your FB page/marketplace link
  instagramUrl: "https://www.instagram.com/invictahomesupplydfw/", // <-- replace with your Instagram profile link
};

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.SITE_CONFIG;

  // Populate every element tagged with data-* config bindings
  document.querySelectorAll("[data-phone]").forEach(el => el.textContent = cfg.phoneDisplay);
  document.querySelectorAll("[data-email]").forEach(el => el.textContent = cfg.email);
  document.querySelectorAll("[data-city]").forEach(el => el.textContent = cfg.city);
  document.querySelectorAll("[data-hours]").forEach(el => el.textContent = cfg.hours);
  document.querySelectorAll("[data-pickup-address]").forEach(el => el.textContent = cfg.pickupAddress);
  document.querySelectorAll("[data-business-name]").forEach(el => el.textContent = cfg.businessName);

  document.querySelectorAll("a[data-tel-link]").forEach(el => el.href = `tel:${cfg.phoneHref}`);
  document.querySelectorAll("a[data-sms-link]").forEach(el => {
    const item = el.getAttribute("data-item") || "";
    const body = item ? `Hi! I'd like to check availability for: ${item}` : "Hi! I have a question about a product I saw on the Invicta Home Supply website.";
    el.href = `sms:${cfg.phoneHref}?&body=${encodeURIComponent(body)}`;
  });
  document.querySelectorAll("a[data-sms-optin]").forEach(el => {
    el.href = `sms:${cfg.phoneHref}?&body=${encodeURIComponent("START")}`;
  });
  document.querySelectorAll("a[data-mail-link]").forEach(el => el.href = `mailto:${cfg.email}`);
  document.querySelectorAll("a[data-fb-link]").forEach(el => el.href = cfg.facebookUrl);
  document.querySelectorAll("a[data-ig-link]").forEach(el => el.href = cfg.instagramUrl);

  // Mobile nav toggle
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("nav.primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  // Shop page category filter + sort is handled in inventory.js, since
  // combining the two requires re-rendering from the fetched item array
  // rather than just hiding/showing already-rendered cards.
});
