import assert from "node:assert/strict";

let pages = [];
let calls = 0;
globalThis.Netlify = { env: { get: (key) => ({ AIRTABLE_TOKEN: "token", AIRTABLE_BASE_ID: "appBase" })[key] } };
globalThis.fetch = async (url) => {
  calls++;
  const offset = new URL(url).searchParams.get("offset");
  const page = pages[offset || "first"] || { records: [] };
  return new Response(JSON.stringify(page), { status: 200 });
};
const { default: sitemapHandler } = await import("../netlify/edge-functions/sitemap.ts");

function context() {
  return { next: async () => new Response("static fallback", { status: 200, headers: { "content-type": "application/xml" } }) };
}
function request(host = "invictahomesupply.com") {
  return new Request(`https://${host}/sitemap.xml`, { method: "GET" });
}

pages = {
  first: {
    records: [
      { fields: { "Product Key": "EDU-1", "Post to Website": true } },
      { fields: { "Product Key": "EDU-1", "Post to Website": true } },
      { fields: { "Product Key": "NOPE", "Post to Website": false } },
      { fields: { "Product Key": "A&B <Floor>", "Post to Website": true } },
    ],
    offset: "page-2",
  },
  "page-2": { records: [{ fields: { "Product Key": "SKU 2", "Post to Website": true } }] },
};
let response = await sitemapHandler(request(), context());
let xml = await response.text();
assert.equal(response.status, 200);
assert.match(xml, /<urlset/);
assert.match(xml, /product\.html\?id=EDU-1/);
assert.match(xml, /product\.html\?id=A%26B%20%3CFloor%3E/);
assert.match(xml, /product\.html\?id=SKU%202/);
assert.match(xml, /https:\/\/invictahomesupply\.com\/service-area\/dfw-north-texas/);
assert.match(xml, /https:\/\/invictahomesupply\.com\/service-area\/durant-ok/);
assert.match(xml, /https:\/\/invictahomesupply\.com\/service-area\/northwest-arkansas/);
assert.equal((xml.match(/product\.html\?id=EDU-1/g) || []).length, 1);
assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
assert.equal(xml.includes("NOPE"), false);
assert.equal(calls, 2);

calls = 0;
response = await sitemapHandler(request("preview.example.net"), context());
assert.equal(await response.text(), "static fallback");
assert.equal(calls, 0);

globalThis.fetch = async () => new Response("down", { status: 503 });
response = await sitemapHandler(request(), context());
assert.equal(await response.text(), "static fallback");

console.log("ok - sitemap includes published products, paginates, deduplicates, and safely falls back");
