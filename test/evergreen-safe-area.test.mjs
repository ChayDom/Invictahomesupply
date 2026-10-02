import assert from 'node:assert/strict';
import {safeAreaHash,safeBadgePlacement} from '../scripts/evergreen-logo-safe-area-test-worker.mjs';
import {freeformPrompt} from '../scripts/evergreen-freeform-test-worker.mjs';

const placement=safeBadgePlacement();
assert.equal(safeAreaHash('TIP-01','source-a'),safeAreaHash('TIP-01','source-a'));
assert.notEqual(safeAreaHash('TIP-01','source-a'),safeAreaHash('TIP-01','source-b'));
assert.equal(placement.corner,'top-right');
assert.equal(placement.x+placement.width,1080);
assert.equal(placement.y,0);
assert.equal(placement.anchoredTop,true);
assert.equal(placement.anchoredRight,true);
assert.equal(placement.roundedCorner,'bottom-left');
assert.match(freeformPrompt({type:'Tip'}),/8–10% safe margin/);
assert.match(freeformPrompt({type:'Tip'}),/top-right area/);
assert.match(freeformPrompt({type:'Tip'}),/no letters may touch/);
assert.match(freeformPrompt({type:'Tip'}),/do not force a rigid grid/);
console.log('Evergreen safe-area tests passed: 4');
