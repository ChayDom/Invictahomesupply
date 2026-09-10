#!/usr/bin/env node
// ===================================================================
// Regression test for the homepage hero image's AVIF/WebP/PNG delivery.
//
// Background: assets/hero/hero-living-room-flooring.png (2007x783,
// 2.16MB) was served as a single CSS background-image via an inline
// --hero-photo custom property on index.html's <section>. AVIF/WebP
// siblings were added (~95%/~93% smaller respectively, quality 60/
// quality 82 method 6, generated deterministically from the tracked
// PNG with Pillow 12.3.0) and wired in via two `background` shorthand
// declarations on .hero-photo in styles.css — PNG first, then an
// image-set() declaration with AVIF/WebP/PNG type()s. A browser that
// doesn't understand image-set() treats that whole second declaration
// as invalid and drops it, leaving the first (universally-supported)
// PNG declaration in effect — a real fallback, not one gated behind a
// custom property (which an inline style on the element would always
// win over, the trap this design deliberately avoids by dropping the
// --hero-photo custom property entirely rather than trying to override
// it from the stylesheet).
//
// Run with: node test/hero-image-optimization.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const indexSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const inventorySrc = fs.readFileSync(path.join(ROOT, "inventory.js"), "utf8");

const PNG = path.join(ROOT, "assets/hero/hero-living-room-flooring.png");
const WEBP = path.join(ROOT, "assets/hero/hero-living-room-flooring.webp");
const AVIF = path.join(ROOT, "assets/hero/hero-living-room-flooring.avif");

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

function pngDimensions(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// WebP simple lossy bitstream ("VP8 "): 3-byte frame tag, 3-byte start
// code (0x9d012a), then two little-endian 16-bit fields whose low 14
// bits are width/height.
function webpDimensions(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(12, 16).toString("ascii"), "VP8 ", "expected a simple lossy VP8 WebP chunk");
  const payload = buf.subarray(20);
  return { width: payload.readUInt16LE(6) & 0x3fff, height: payload.readUInt16LE(8) & 0x3fff };
}

// Minimal ISOBMFF box walker, just enough to reach an AVIF's `ispe`
// (Image Spatial Extents) property under meta/iprp/ipco and read its
// stored width/height — avoids depending on Python/Pillow in CI.
function readBoxes(buf, start, end) {
  const boxes = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(off + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - off;
    }
    boxes.push({ type, start: off, headerSize, end: off + size });
    off += size;
  }
  return boxes;
}

function avifDimensions(file) {
  const buf = fs.readFileSync(file);
  const top = readBoxes(buf, 0, buf.length);
  const meta = top.find((b) => b.type === "meta");
  assert.ok(meta, "expected a meta box");
  // meta is a FullBox: 4 bytes version+flags follow the box header.
  const iprp = readBoxes(buf, meta.start + meta.headerSize + 4, meta.end).find((b) => b.type === "iprp");
  assert.ok(iprp, "expected an iprp box");
  const ipco = readBoxes(buf, iprp.start + iprp.headerSize, iprp.end).find((b) => b.type === "ipco");
  assert.ok(ipco, "expected an ipco box");
  const ispe = readBoxes(buf, ipco.start + ipco.headerSize, ipco.end).find((b) => b.type === "ispe");
  assert.ok(ispe, "expected an ispe box");
  // ispe is a FullBox: 4 bytes version+flags, then width(4) + height(4), big-endian.
  const dataStart = ispe.start + ispe.headerSize + 4;
  return { width: buf.readUInt32BE(dataStart), height: buf.readUInt32BE(dataStart + 4) };
}

// ---------------------------------------------------------------------
// Files exist, are non-empty, and the original PNG is unchanged.
// ---------------------------------------------------------------------
test("all three hero image files exist and are non-empty", () => {
  for (const f of [PNG, WEBP, AVIF]) {
    assert.ok(fs.existsSync(f), `expected ${f} to exist`);
    assert.ok(fs.statSync(f).size > 0, `expected ${f} to be non-empty`);
  }
});

test("the original PNG is a real PNG, still 2007x783, and was not touched by this optimization step", () => {
  const buf = fs.readFileSync(PNG);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "expected a valid PNG signature");
  const dims = pngDimensions(PNG);
  assert.equal(dims.width, 2007);
  assert.equal(dims.height, 783);
});

test("WebP file is a real WebP container", () => {
  const buf = fs.readFileSync(WEBP);
  assert.equal(buf.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(buf.subarray(8, 12).toString("ascii"), "WEBP");
});

test("AVIF file is a real AVIF (ISO BMFF 'avif' brand)", () => {
  const buf = fs.readFileSync(AVIF);
  assert.equal(buf.subarray(4, 8).toString("ascii"), "ftyp");
  assert.equal(buf.subarray(8, 12).toString("ascii"), "avif");
});

test("WebP is substantially smaller than the PNG (at least 80% smaller)", () => {
  const pngSize = fs.statSync(PNG).size;
  const webpSize = fs.statSync(WEBP).size;
  assert.ok(webpSize < pngSize * 0.2, `expected WebP (${webpSize}B) to be under 20% of PNG size (${pngSize}B)`);
});

test("AVIF is substantially smaller than the PNG (at least 90% smaller)", () => {
  const pngSize = fs.statSync(PNG).size;
  const avifSize = fs.statSync(AVIF).size;
  assert.ok(avifSize < pngSize * 0.1, `expected AVIF (${avifSize}B) to be under 10% of PNG size (${pngSize}B)`);
});

test("AVIF and WebP report the same pixel dimensions as the PNG (2007x783)", () => {
  const webp = webpDimensions(WEBP);
  const avif = avifDimensions(AVIF);
  assert.deepEqual(webp, { width: 2007, height: 783 });
  assert.deepEqual(avif, { width: 2007, height: 783 });
});

// ---------------------------------------------------------------------
// CSS: PNG-first, image-set() second, correct source order and types,
// fallback genuinely outside the image-set() syntax.
// ---------------------------------------------------------------------
function heroPhotoBlock() {
  const m = stylesSrc.match(/\.hero-photo\s*\{([\s\S]*?)\n\}\n/);
  assert.ok(m, "expected a .hero-photo rule block");
  return m[0];
}

test("styles.css: .hero-photo declares a plain PNG background before any image-set() declaration", () => {
  const block = heroPhotoBlock();
  const pngDeclIndex = block.indexOf("url('/assets/hero/hero-living-room-flooring.png')");
  const imageSetIndex = block.indexOf("image-set(");
  assert.ok(pngDeclIndex !== -1, "expected a plain PNG url() in the block");
  assert.ok(imageSetIndex !== -1, "expected an image-set() declaration in the block");
  assert.ok(pngDeclIndex < imageSetIndex, "the plain PNG background declaration must come before the image-set() one");
});

test("styles.css: the PNG fallback declaration is a separate, complete `background` declaration — not nested inside image-set() syntax a non-supporting browser would fail to parse at all", () => {
  const block = heroPhotoBlock();
  // The first `background:` declaration (up to its terminating `;`) must
  // be fully self-contained and must not itself contain "image-set(" —
  // i.e. it's a standalone, always-valid declaration on its own.
  const bgStart = block.indexOf("background:");
  const firstDecl = block.slice(bgStart, block.indexOf(";", bgStart) + 1);
  assert.doesNotMatch(firstDecl, /image-set\(/, "the PNG-only declaration must not contain image-set() at all");
  assert.match(firstDecl, /url\('\/assets\/hero\/hero-living-room-flooring\.png'\)/);
});

test("styles.css: image-set() lists AVIF, then WebP, then PNG, each with an explicit type()", () => {
  const block = heroPhotoBlock();
  const imageSet = block.slice(block.indexOf("image-set("));
  const avifIdx = imageSet.indexOf("hero-living-room-flooring.avif");
  const webpIdx = imageSet.indexOf("hero-living-room-flooring.webp");
  const pngIdx = imageSet.indexOf("hero-living-room-flooring.png");
  assert.ok(avifIdx !== -1 && webpIdx !== -1 && pngIdx !== -1, "expected all three formats inside image-set()");
  assert.ok(avifIdx < webpIdx && webpIdx < pngIdx, "expected source order AVIF, then WebP, then PNG inside image-set()");
  assert.match(imageSet, /hero-living-room-flooring\.avif'\)\s*type\('image\/avif'\)/);
  assert.match(imageSet, /hero-living-room-flooring\.webp'\)\s*type\('image\/webp'\)/);
  assert.match(imageSet, /hero-living-room-flooring\.png'\)\s*type\('image\/png'\)/);
});

test("styles.css: the existing scrim gradient, background-size:cover, and background-position:right center are unchanged in both declarations", () => {
  const block = heroPhotoBlock();
  const gradientCount = (block.match(/linear-gradient\(90deg, rgba\(15, 22, 17, 0\.94\) 0%, rgba\(20, 28, 22, 0\.78\) 45%, rgba\(28, 40, 32, 0\.5\) 100%\)/g) || []).length;
  assert.equal(gradientCount, 2, "expected the identical scrim gradient in both the PNG and image-set() declarations");
  assert.match(block, /background-size:\s*cover/);
  assert.match(block, /background-position:\s*right center/);
});

test("styles.css: the mobile 38% crop override for .hero-photo is untouched", () => {
  const m = stylesSrc.match(/@media \(max-width: 900px\) \{\s*\.hero-photo \{\s*background-position:\s*38% center;/);
  assert.ok(m, "expected the mobile background-position override to still read 38% center");
});

// ---------------------------------------------------------------------
// The old --hero-photo custom property is fully retired — no inline
// style on the element could otherwise silently out-cascade the new
// image-set() declarations.
// ---------------------------------------------------------------------
test("index.html: the hero <section> no longer sets an inline --hero-photo custom property", () => {
  assert.doesNotMatch(indexSrc, /--hero-photo/);
  assert.match(indexSrc, /<section class="hero hero-photo">/);
});

test("styles.css: no rule still reads the retired --hero-photo custom property", () => {
  assert.doesNotMatch(stylesSrc, /var\(--hero-photo/);
});

// ---------------------------------------------------------------------
// No JS format/device detection was introduced.
// ---------------------------------------------------------------------
test("no JavaScript file references the hero image or does format/device detection for it", () => {
  for (const [src, label] of [[appSrc, "app.js"], [inventorySrc, "inventory.js"]]) {
    assert.doesNotMatch(src, /hero-living-room-flooring/, `${label} must not reference the hero image directly`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll hero-image-optimization tests passed.");
