#!/usr/bin/env node
// ===================================================================
// DOM-integration coverage for the real Flooring Calculator math —
// calcParseFeetInches(), calcRound2(), and calcRecalculate() — the
// same functions bound to both the desktop sidebar calculator and the
// mobile calculator drawer (there is only one calculator implementation;
// see shop-mobile-calc-drawer.test.mjs for the CSS/placement side of
// that, not duplicated here).
//
// Run with: node test/flooring-calculator.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const inventorySrc = fs.readFileSync(path.join(ROOT, "inventory.js"), "utf8");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: {}, location: { search: "", hash: "", pathname: "/shop.html", href: "http://localhost/shop.html" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
let currentDoc = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } } };
globalThis.document = new Proxy({}, {
  get: (_t, prop) => currentDoc[prop],
  set: (_t, prop, value) => { currentDoc[prop] = value; return true; },
});

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

// ---------------------------------------------------------------------
// calcParseFeetInches() / calcRound2() — pure math helpers.
// ---------------------------------------------------------------------
test("calcParseFeetInches(): converts feet + inches to decimal feet", () => {
  assert.equal(calcParseFeetInches("10", "6"), 10.5);
  assert.equal(calcParseFeetInches("12", "0"), 12);
});

test("calcParseFeetInches(): empty/invalid input treated as 0, never NaN", () => {
  assert.equal(calcParseFeetInches("", ""), 0);
  assert.equal(calcParseFeetInches("abc", "xyz"), 0);
  assert.equal(calcParseFeetInches(undefined, undefined), 0);
});

test("calcParseFeetInches(): negative feet clamp to 0", () => {
  assert.equal(calcParseFeetInches("-5", "0"), 0);
});

test("calcParseFeetInches(): inches are clamped to the 0-11 range", () => {
  assert.equal(calcParseFeetInches("10", "15"), 10 + 11 / 12);
  assert.equal(calcParseFeetInches("10", "-3"), 10);
});

test("calcParseFeetInches(): decimal feet input is preserved", () => {
  assert.equal(calcParseFeetInches("10.5", "0"), 10.5);
});

test("calcRound2(): rounds to at most 2 decimals and trims trailing zeros", () => {
  assert.equal(calcRound2(100), "100");
  assert.equal(calcRound2(138.6), "138.6");
  assert.equal(calcRound2(434.6949999), "434.69");
  assert.equal(calcRound2(434.695), "434.7");
});

// ---------------------------------------------------------------------
// calcRecalculate() — the real DOM-reading calculation used by both the
// desktop sidebar and the mobile drawer calculator markup, via a fake
// #calc-rooms/#calc-total-area/#calc-recommended DOM.
// ---------------------------------------------------------------------
function makeCalcRoom({ lengthFt = "", lengthIn = "", widthFt = "", widthIn = "" } = {}) {
  const dims = {
    "length-ft": { value: lengthFt },
    "length-in": { value: lengthIn },
    "width-ft": { value: widthFt },
    "width-in": { value: widthIn },
  };
  const areaEl = { innerHTML: "" };
  return {
    querySelector: (sel) => {
      const m = sel.match(/\[data-dim="([a-z-]+)"\]/);
      if (m) return dims[m[1]] || null;
      if (sel === "[data-room-area]") return areaEl;
      return null;
    },
    _areaEl: areaEl,
  };
}

function makeCalcDom(rooms) {
  const totalEl = { textContent: "" };
  const recEl = { textContent: "" };
  const registry = { "calc-total-area": totalEl, "calc-recommended": recEl };
  const doc = {
    getElementById: (id) => registry[id] || null,
    querySelectorAll: (sel) => (sel === "#calc-rooms .calc-room" ? rooms : []),
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  return { doc, totalEl, recEl };
}

test("calcRecalculate(): a single 10ft x 12ft room computes 120 sq ft total and adds 10% waste (132 sq ft recommended)", () => {
  const room = makeCalcRoom({ lengthFt: "10", widthFt: "12" });
  const { doc, totalEl, recEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "120 sq ft");
  assert.equal(recEl.textContent, "132 sq ft");
  assert.match(room._areaEl.innerHTML, /120 sq ft/);
});

test("calcRecalculate(): multiple rooms sum their areas before applying waste", () => {
  const roomA = makeCalcRoom({ lengthFt: "10", widthFt: "10" }); // 100
  const roomB = makeCalcRoom({ lengthFt: "5", widthFt: "4" }); // 20
  const { doc, totalEl, recEl } = makeCalcDom([roomA, roomB]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "120 sq ft");
  assert.equal(recEl.textContent, "132 sq ft");
});

test("calcRecalculate(): empty/blank inputs compute a 0 sq ft room, not an error", () => {
  const room = makeCalcRoom({});
  const { doc, totalEl, recEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "0 sq ft");
  assert.equal(recEl.textContent, "0 sq ft");
});

test("calcRecalculate(): invalid (non-numeric) input is treated as 0, not NaN propagating into the total", () => {
  const room = makeCalcRoom({ lengthFt: "abc", widthFt: "12" });
  const { doc, totalEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "0 sq ft");
  assert.doesNotMatch(totalEl.textContent, /NaN/);
});

test("calcRecalculate(): negative dimensions clamp to 0, never produce a negative area", () => {
  const room = makeCalcRoom({ lengthFt: "-10", widthFt: "12" });
  const { doc, totalEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "0 sq ft");
});

test("calcRecalculate(): decimal square footage (feet + inches) computes correctly", () => {
  // 10ft 6in x 8ft 3in = 10.5 x 8.25 = 86.625 -> rounds for display to 86.63
  const room = makeCalcRoom({ lengthFt: "10", lengthIn: "6", widthFt: "8", widthIn: "3" });
  const { doc, totalEl, recEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0.10;
  calcRecalculate();
  assert.equal(totalEl.textContent, "86.63 sq ft");
  assert.equal(recEl.textContent, calcRound2(86.625 * 1.10) + " sq ft");
});

test("calcRecalculate(): a waste rate other than the 10% default is honored (e.g. 0% waste)", () => {
  const room = makeCalcRoom({ lengthFt: "10", widthFt: "10" });
  const { doc, totalEl, recEl } = makeCalcDom([room]);
  currentDoc = doc;
  calcWasteRate = 0;
  calcRecalculate();
  assert.equal(totalEl.textContent, "100 sq ft");
  assert.equal(recEl.textContent, "100 sq ft");
});

// ---------------------------------------------------------------------
// calcResetState() — reopen behavior: back to one empty room and the
// default 10% waste rate every time, regardless of prior session state.
// ---------------------------------------------------------------------
test("calcResetState(): resets to a single room and the default 10% waste rate, discarding any prior room count/waste selection", () => {
  const roomsContainer = { innerHTML: "" };
  const wasteButtons = [
    { getAttribute: () => "10", classList: { toggle(cls, on) { this._active = on; } } },
    { getAttribute: () => "15", classList: { toggle(cls, on) { this._active = on; } } },
  ];
  const addBtn = { disabled: false, textContent: "" };
  const registry = { "calc-rooms": roomsContainer, "calc-total-area": { textContent: "" }, "calc-recommended": { textContent: "" }, "calc-add-room": addBtn };
  currentDoc = {
    getElementById: (id) => registry[id] || null,
    querySelectorAll: (sel) => {
      if (sel === ".calc-waste-btn") return wasteButtons;
      if (sel === "#calc-rooms .calc-room") return [{ querySelector: () => null }];
      return [];
    },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  calcWasteRate = 0.15;
  calcRoomCounter = 7;
  calcResetState();
  assert.equal(calcWasteRate, 0.10, "waste rate must reset to the 10% default");
  assert.match(roomsContainer.innerHTML, /Room 1/, "must reset to exactly one room, labeled Room 1");
  assert.equal(wasteButtons[0].classList._active, true, "the 10% waste button must be marked active again");
  assert.equal(wasteButtons[1].classList._active, false);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll flooring-calculator tests passed.");
