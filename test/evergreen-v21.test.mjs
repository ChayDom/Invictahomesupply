import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRuntime,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
import {loadContract} from '../scripts/social-media-worker.mjs';
import {v21LayoutFamily,v21Prompt,renderEvergreenV21,v21CornerPanel,V21_LOGO} from '../scripts/evergreen-v21-media-worker.mjs';

let pass=0,fail=0;
async function test(name,fn){try{await fn();pass++;console.log('ok - '+name);}catch(error){fail++;console.log('NOT OK - '+name);console.error(error);}}
const t=createRuntime();
const item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]);

await test('v2.1 selects distinct topic-aware layout families',()=>{
  assert.equal(v21LayoutFamily('Tip'),'tip-curved');
  assert.equal(v21LayoutFamily('Educational'),'educational-editorial');
  assert.equal(v21LayoutFamily('Comparison'),'comparison-split');
  assert.equal(v21LayoutFamily('Brand'),'brand-lifestyle');
  assert.equal(v21LayoutFamily('Post'),null);
});
await test('v2.1 prompt uses approved topic meaning and forbids generated branding/text',()=>{
  const prompt=v21Prompt(item);
  assert.match(prompt,/matching flooring planks or tiles/);
  assert.match(prompt,/logo-safe region/);
  assert.match(prompt,/Do not generate, imitate, redraw/);
  assert.match(prompt,/No text, letters, words/);
  assert.match(prompt,/packaging, SKU screenshots/);
});
await test('v2.1 uses the approved freeform composition and curved top-right logo panel',async()=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'evergreen-v21-test-'));
  try {
    const background=path.join(cwd,'background.png');await fs.writeFile(background,'background');
    let args;
    const output=await renderEvergreenV21(background,item,cwd,{ffmpeg:received=>{args=received;return fs.writeFile(path.join(cwd,'evergreen-v2-1.jpg'),'rendered');}});
    assert.equal(output.endsWith('evergreen-v2-1.jpg'),true);
    assert.match(args.join(' '),/1080:1350/);
    assert.doesNotMatch(args.join(' '),/drawtext=/);
    assert.match(args.join(' '),/overlay=700:0/);
    assert.deepEqual(v21CornerPanel(),{x:700,y:0,width:380,height:300,logoX:180,logoY:10,logoWidth:180,logoHeight:180,corner:'top-right'});
    assert.equal(args.includes(V21_LOGO),false); // the logo is an input path, not a generated text layer
    const panel=await fs.readFile(path.join(cwd,'evergreen-v21-corner-panel.svg'),'utf8');
    assert.match(panel,/fill="#fffaf0"/);
    assert.match(panel,/preserveAspectRatio="xMidYMid meet"/);
    assert.match(panel,/href="data:image\/png;base64,/); // logo is embedded from the real repository asset
    assert.match(panel,/x="180" y="10" width="180" height="180"/);
  } finally { await fs.rm(cwd,{recursive:true,force:true}); }
});
await test('v2.1 contract is separate, immutable, and approval-only',async()=>{
  const contract=await loadContract(),plan=contract.evergreenV21Plan_(item,1),v1=contract.evergreenPlan_(item,1),v2=contract.evergreenV2Plan_(item,1);
  assert.equal(plan.templateVersion,'evergreen-v2-1');
  assert.equal(plan.kind,'INVICTA_EVERGREEN_MEDIA_V21');
  assert.match(plan.publicIds[0],/^invicta-social\/evergreen-v2-1\//);
  assert.notDeepEqual(plan.publicIds,v1.publicIds);assert.notDeepEqual(plan.publicIds,v2.publicIds);
  assert.equal(plan.logoAsset,V21_LOGO);
  const source=await fs.readFile(new URL('../Invicta Appscript Files/EvergreenSocial.js',import.meta.url),'utf8');
  const start=source.indexOf('function finalizeEvergreenV21Media');
  const end=source.indexOf('/** Only provably owned',start);
  const finalize=source.slice(start,end);
  assert.match(finalize,/setValue\('Awaiting Approval'\)/);
  assert.doesNotMatch(finalize,/setValue\('Ready'\)/);
});
await test('workflow exposes v2.1 as an explicit non-publishing path',async()=>{
  const workflow=await fs.readFile(new URL('../.github/workflows/social-media-prepare.yml',import.meta.url),'utf8');
  assert.match(workflow,/evergreen_v21:/);
  assert.match(workflow,/EVERGREEN_V21/);
  assert.match(workflow,/node scripts\/evergreen-v21-media-worker\.mjs/);
  assert.doesNotMatch(workflow,/BUFFER_API_KEY|NETLIFY_AUTH_TOKEN/);
});
console.log(`${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
