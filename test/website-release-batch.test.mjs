import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({
  window: { AIRTABLE_CONFIG: {}, SITE_CONFIG: {}, location: { pathname: "/product.html", search: "", hash: "" } },
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; } }, console, URL, URLSearchParams
});
vm.runInContext(fs.readFileSync(new URL("../inventory.js", import.meta.url), "utf8"), context);
const disclaimer = "Material estimate only. Taxes and delivery fees are not included. Final stock and pricing require confirmation.";
const product = {
  id: "test-record", productKey: "test-permanent", name: "Test flooring", webCategory: "Flooring",
  price: 1.55, boxPrice: 31.16, sqFtPerUnit: 20.1, availableSqFt: 7185,
  photos: ["https://images.example.test/one.png", "https://images.example.test/two.png"],
  photoThumbs: ["https://images.example.test/one.png", "https://images.example.test/two.png"],
  photoCards: ["https://images.example.test/one.png", "https://images.example.test/two.png"]
};
let failures = 0;
function test(name, fn) { try { fn(); console.log("ok - " + name); } catch (error) { failures++; console.error("NOT OK - " + name + "\n" + error.stack); } }
for (const renderer of ["photoBlock", "productDetailPhotoBlock"]) {
  test(renderer + " uses native named buttons and decorative child images", () => {
    const markup = context[renderer](product);
    assert.equal((markup.match(/<button type="button" class="thumb/g) || []).length, 2);
    assert.match(markup, /aria-label="View photo 1 of 2" aria-current="true"><img/);
    assert.match(markup, /aria-label="View photo 2 of 2"><img/);
    assert.doesNotMatch(markup, /<img[^>]*(?:role="button"|tabindex=)/);
    assert.match(markup, /<img[^>]*alt=""[^>]*width="40" height="40"/);
  });
  test(renderer + " single and missing photos do not create thumbnail controls", () => {
    assert.doesNotMatch(context[renderer]({ ...product, photos: product.photos.slice(0, 1) }), /<button[^>]*class="thumb/);
    assert.doesNotMatch(context[renderer]({ ...product, photos: [] }), /<button[^>]*class="thumb/);
  });
}
test("project estimate uses exact approved disclaimer without installation wording", () => {
  const markup = context.calcProjectSummaryMarkup(1000, 10, product);
  assert.ok(markup.includes(disclaimer));
  assert.doesNotMatch(markup, /installation|installer/i);
});
for (const file of ["shop.html", "product.html"]) test(file + " modal disclaimer matches project estimate", () => {
  const html = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  assert.match(html, new RegExp('<p class="calc-disclaimer">' + disclaimer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "</p>"));
  assert.doesNotMatch(html.match(/<p class="calc-disclaimer">[\s\S]*?<\/p>/)?.[0] || "", /installation|installer/i);
});
test("thumbnail child sizing and keyboard focus styling remain explicit", () => {
  const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.thumb\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/);
  assert.match(css, /\.thumb > img\s*\{[^}]*object-fit:\s*cover;/);
  assert.match(css, /\.thumb:focus-visible\s*\{[^}]*outline:/);
});
process.exitCode = failures ? 1 : 0;
