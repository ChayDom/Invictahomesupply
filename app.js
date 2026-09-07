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
  city: "McKinney, TX · Near Custer Rd & US-380", // <-- replace with your pickup location/city
  pickupAddress: "Pickup by appointment — we'll send you the exact location after confirming your pickup.",
  hours: "Daily · 8:00 AM – 8:30 PM · By appointment only",
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
    const explicitBody = el.getAttribute("data-body");
    const item = el.getAttribute("data-item") || "";
    const body = explicitBody || (item ? `Hi! I'd like to check availability for: ${item}` : "Hi! I have a question about a product I saw on the Invicta Home Supply website.");
    el.href = `sms:${cfg.phoneHref}?&body=${encodeURIComponent(body)}`;
  });
  document.querySelectorAll("a[data-sms-optin]").forEach(el => {
    el.href = `sms:${cfg.phoneHref}?&body=${encodeURIComponent("START")}`;
  });
  document.querySelectorAll("a[data-mail-link]").forEach(el => el.href = `mailto:${cfg.email}`);
  document.querySelectorAll("a[data-fb-link]").forEach(el => el.href = cfg.facebookUrl);
  document.querySelectorAll("a[data-ig-link]").forEach(el => el.href = cfg.instagramUrl);

  // Copyright year, generated so it never goes stale.
  document.querySelectorAll("[data-year]").forEach(el => el.textContent = new Date().getFullYear());

  // Mobile nav toggle
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("nav.primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Compact sticky header on scroll — toggles .scrolled once the page has
  // scrolled past a small threshold, and back off near the top. Threshold
  // has a little hysteresis (24px on, 8px off) so it doesn't flicker.
  const header = document.querySelector(".site-header");
  if (header) {
    let scrolled = false;
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      if (!scrolled && y > 24) {
        scrolled = true;
        header.classList.add("scrolled");
      } else if (scrolled && y < 8) {
        scrolled = false;
        header.classList.remove("scrolled");
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Shop page category filter + sort is handled in inventory.js, since
  // combining the two requires re-rendering from the fetched item array
  // rather than just hiding/showing already-rendered cards.
});
