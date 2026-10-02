/** Isolated freeform Evergreen preview with a flush organic top-right logo panel.
 * Only the deterministic panel shape differs from the safe-area experiment.
 * This path never reads/writes Social Queue, sends email, calls Buffer, or publishes.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';
import {v21Config} from './evergreen-v21-media-worker.mjs';
import {freeformPrompt,loadCandidate,generateFreeform} from './evergreen-freeform-test-worker.mjs';

const MODEL='gpt-image-2.5-flare';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOGO_PATH=path.join(ROOT,'assets/brand/derived/invicta-logo-blue-transparent.png');
const NAMESPACE='invicta-social/evergreen-freeform-curved-panel-test';

export function curvedPanelHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-curved-panel-test|'+contentId+'|'+sourceHash+'|logo-curved-panel-v1').digest('base64url');
}

export function curvedPanelPlacement() {
  return {corner:'top-right',x:760,y:0,width:320,height:190,anchoredTop:true,anchoredRight:true,roundedCorner:'organic-inner-edge'};
}

async function writeCurvedPanelSvg(cwd) {
  const logo=await fs.readFile(LOGO_PATH);
  const p=curvedPanelPlacement();
  const shape='M0 0H320V190C270 184 221 166 185 139C140 105 104 55 0 42Z';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><path d="${shape}" fill="#fffaf0" stroke="#eadfca" stroke-width="2"/><image href="data:image/png;base64,${logo.toString('base64')}" x="40" y="25" width="240" height="130" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const file=path.join(cwd,'logo-curved-panel.svg');
  await fs.writeFile(file,svg);
  return file;
}

export async function renderWithCurvedPanel(background,cwd,{ffmpeg=runFFmpeg}={}) {
  const p=curvedPanelPlacement();
  const panel=await writeCurvedPanelSvg(cwd);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];'+
    '[1:v]format=rgba[panel];[base][panel]overlay='+p.x+':'+p.y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-freeform-curved-panel-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',panel,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareCurvedPanel(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=curvedPanelHash(contentId,sourceHash),publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:freeformPrompt(item),panel:curvedPanelPlacement(),validation:'manual visual acceptance required',asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-curved-panel-'));
  try {
    const generated=renderer ? await renderer(item,sourceHash,cwd) : await generateFreeform(item,config,fetcher);
    await fs.writeFile(path.join(cwd,'background.png'),generated.bytes || generated);
    await fs.access(LOGO_PATH);
    const final=await renderWithCurvedPanel(path.join(cwd,'background.png'),cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher);
    return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||freeformPrompt(item),panel:curvedPanelPlacement(),validation:'manual visual acceptance required',asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-curved-panel-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareCurvedPanel(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Curved-panel visual preview stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; }
}
