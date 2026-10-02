import assert from 'node:assert/strict';
import {safeLogoFixHash,safeLogoFixPlacement,safeLogoFixPrompt} from '../scripts/evergreen-safe-logo-fix-test-worker.mjs';

const p=safeLogoFixPlacement();
assert.equal(safeLogoFixHash('TIP-01','a'),safeLogoFixHash('TIP-01','a'));
assert.notEqual(safeLogoFixHash('TIP-01','a'),safeLogoFixHash('TIP-01','b'));
assert.equal(p.x+p.width,1080);
assert.equal(p.y,0);
assert.equal(p.logoX>0,true);
assert.equal(p.logoY>0,true);
assert.match(safeLogoFixPrompt({type:'Tip'}),/top 12%/);
assert.match(safeLogoFixPrompt({type:'Tip'}),/at least 10%/);
console.log('Evergreen safe-logo-fix tests passed: 4');
