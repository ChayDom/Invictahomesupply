import assert from 'node:assert/strict';
import {freeformHash,freeformLogoPlacement,freeformPrompt} from '../scripts/evergreen-freeform-test-worker.mjs';

const item={type:'Tip',title:'Measure twice before choosing boxes',slides:['Write down each room’s length and width, including units.','Separate rooms before estimating boxes.']};
const prompt=freeformPrompt(item);
assert.equal(freeformHash('TIP-01','source-hash').length,43);
assert.equal(freeformHash('TIP-01','source-hash'),freeformHash('TIP-01','source-hash'));
assert.notEqual(freeformHash('TIP-01','source-hash'),freeformHash('TIP-01','changed'));
assert.match(prompt,/experienced home-improvement advertising creative director/);
assert.match(prompt,/realistic relevant imagery/);
assert.match(prompt,/Do not generate, redraw, imitate, spell out, or substitute the Invicta Home Supply logo/);
assert.match(prompt,/Do not add a separate business-name wordmark/);
assert.doesNotMatch(prompt,/x=\d+|y=\d+|w=\d+|h=\d+/);
assert.deepEqual(freeformLogoPlacement('Tip'),[70,70]);
assert.deepEqual(freeformLogoPlacement('Educational'),[790,70]);
assert.deepEqual(freeformLogoPlacement('Comparison'),[70,1080]);
console.log('evergreen freeform visual tests: 9 passed');
