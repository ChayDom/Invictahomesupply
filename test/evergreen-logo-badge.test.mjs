import assert from 'node:assert/strict';
import {badgeHash,badgePlacement} from '../scripts/evergreen-logo-badge-test-worker.mjs';
assert.equal(badgeHash('TIP-01','source-hash').length,43);
assert.equal(badgeHash('TIP-01','source-hash'),badgeHash('TIP-01','source-hash'));
assert.notEqual(badgeHash('TIP-01','source-hash'),badgeHash('TIP-01','changed'));
assert.deepEqual(badgePlacement(),{corner:'top-right',x:730,y:44,width:300,height:150});
console.log('evergreen logo badge tests: 4 passed');
