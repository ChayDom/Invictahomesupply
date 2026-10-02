import assert from 'node:assert/strict';
import {curvedPanelHash,curvedPanelPlacement} from '../scripts/evergreen-curved-panel-test-worker.mjs';
import {freeformPrompt} from '../scripts/evergreen-freeform-test-worker.mjs';

const placement=curvedPanelPlacement();
assert.equal(curvedPanelHash('TIP-01','source-a'),curvedPanelHash('TIP-01','source-a'));
assert.notEqual(curvedPanelHash('TIP-01','source-a'),curvedPanelHash('TIP-01','source-b'));
assert.equal(placement.corner,'top-right');
assert.equal(placement.x+placement.width,1080);
assert.equal(placement.y,0);
assert.equal(placement.anchoredTop,true);
assert.equal(placement.anchoredRight,true);
assert.equal(placement.roundedCorner,'organic-inner-edge');
assert.match(freeformPrompt({type:'Tip'}),/top-right area/);
console.log('Evergreen curved-panel tests passed: 4');
