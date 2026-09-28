/** Offline renderer acceptance. No credentials/network/publication. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createRuntime,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
import {renderEvergreen} from '../scripts/evergreen-media-worker.mjs';

const output=process.env.EVERGREEN_RENDER_OUTPUT ? path.resolve(process.env.EVERGREEN_RENDER_OUTPUT) : await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-qa-'));
await fs.mkdir(output,{recursive:true});
const t=createRuntime(),rows=plain(t.ctx.evergreenSeedRows_());
let graphics=0;
for(const id of ['EDU-01','CMP-01','BRAND-02']) {
  const item=t.ctx.evergreenContent_(rows.find(row=>row[0]===id)),cwd=path.join(output,id);await fs.mkdir(cwd,{recursive:true});
  const files=await renderEvergreen(item,cwd);
  for(const file of files) {
    const result=spawnSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-of','json',file],
      {encoding:'utf8',timeout:30000,windowsHide:true});assert.equal(result.status,0);
    const stream=JSON.parse(result.stdout).streams[0];assert.equal(stream.width,1080);assert.equal(stream.height,1350);assert.equal(stream.codec_name,'mjpeg');
    assert.ok((await fs.stat(file)).size<8*1024*1024);graphics++;
  }
  // Same source -> byte-identical graphics with this pinned renderer/font.
  const before=await Promise.all(files.map(file=>fs.readFile(file)));
  await renderEvergreen(item,cwd);
  for(let i=0;i<4;i++)assert.deepEqual(await fs.readFile(files[i]),before[i]);
  console.log('ok - '+id+' ordered 4-slide 1080x1350 JPEG render and byte-identical retry');
}
console.log(JSON.stringify({tests:3,graphics,failures:0,output}));
