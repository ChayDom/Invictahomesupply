import assert from 'node:assert/strict';
import {cornerLogoHash,cornerLogoPlacement,cornerLogoPrompt} from '../scripts/evergreen-corner-logo-test-worker.mjs';
const p=cornerLogoPlacement();
assert.equal(cornerLogoHash('TIP-01','a'),cornerLogoHash('TIP-01','a'));
assert.notEqual(cornerLogoHash('TIP-01','a'),cornerLogoHash('TIP-01','b'));
assert.equal(p.x+p.width,1080); assert.equal(p.y,0); assert.equal(p.logoX+p.logoWidth,302); assert.equal(p.logoY,18);
assert.match(cornerLogoPrompt({type:'Tip'}),/top 12%/);
console.log('Evergreen corner-logo tests passed: 4');
