/** Isolated Evergreen preview with the approved curved panel and a corner-anchored logo. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';
import {v21Config} from './evergreen-v21-media-worker.mjs';
import {freeformPrompt,loadCandidate} from './evergreen-freeform-test-worker.mjs';

const MODEL='gpt-image-2.5-flare';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOGO_PATH=path.join(ROOT,'assets/brand/derived/invicta-logo-blue-transparent.png');
const NAMESPACE='invicta-social/evergreen-freeform-corner-logo-panel-v6-test';

export function cornerLogoHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-corner-logo-panel-v6-test|'+contentId+'|'+sourceHash+'|logo-corner-v6').digest('base64url');
}
export function cornerLogoPlacement() {
  return {corner:'top-right',x:700,y:0,width:380,height:300,anchoredTop:true,anchoredRight:true,logoX:180,logoY:10,logoWidth:180,logoHeight:180,roundedCorner:'organic-inner-edge'};
}
export function cornerLogoPrompt(item) {
  return freeformPrompt(item)+' Keep the entire top 12% and bottom 12% of the 1080x1350 canvas clear of all text, labels, icons, and important imagery. Keep every important text block at least 10% from the top, left, right, and bottom edges so center-cropping to the final 4:5 canvas cannot clip it. Keep the full composition comfortably inside the canvas with generous lower breathing room. The top-right branding zone is reserved for the compact curved cream panel; do not put any text there. Never clip or touch any canvas edge.';
}
async function generate(item,config,fetcher=fetch) {
  const prompt=cornerLogoPrompt(item);
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+config.openai,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,prompt,size:'1024x1536',quality:'high',background:'opaque',output_format:'png'}),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok) throw Error('OpenAI image generation failed; no test asset uploaded.');
  const body=await response.json(),encoded=body?.data?.[0]?.b64_json;
  if(!encoded) throw Error('OpenAI image response did not contain an image.');
  return {bytes:Buffer.from(encoded,'base64'),prompt};
}
async function panelSvg(cwd) {
  const logo=await fs.readFile(LOGO_PATH),p=cornerLogoPlacement();
  const shape='M0 0H380V300C320 294 260 270 205 230C140 185 90 110 0 68Z';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><path d="${shape}" fill="#fffaf0" stroke="#eadfca" stroke-width="2"/><image href="data:image/png;base64,${logo.toString('base64')}" x="${p.logoX}" y="${p.logoY}" width="${p.logoWidth}" height="${p.logoHeight}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const file=path.join(cwd,'logo-corner-panel.svg'); await fs.writeFile(file,svg); return file;
}
export async function renderCornerLogo(background,cwd,{ffmpeg=runFFmpeg}={}) {
  const p=cornerLogoPlacement(),panel=await panelSvg(cwd);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];[1:v]format=rgba[panel];[base][panel]overlay='+p.x+':'+p.y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-corner-logo-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',panel,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd); return output;
}
export async function prepareCornerLogo(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract(); const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=cornerLogoHash(contentId,sourceHash),publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:cornerLogoPrompt(item),panel:cornerLogoPlacement(),validation:'manual visual acceptance required',asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-corner-logo-'));
  try { const generated=renderer?await renderer(item,sourceHash,cwd):await generate(item,config,fetcher); await fs.writeFile(path.join(cwd,'background.png'),generated.bytes||generated); await fs.access(LOGO_PATH); const final=await renderCornerLogo(path.join(cwd,'background.png'),cwd,{ffmpeg}); const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher); return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||cornerLogoPrompt(item),panel:cornerLogoPlacement(),validation:'manual visual acceptance required',asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}}; }
  finally { if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-corner-logo-')) throw Error('Unsafe temp cleanup target.'); await fs.rm(cwd,{recursive:true,force:true}); }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) { try { console.log(JSON.stringify(await prepareCornerLogo(process.argv[2],process.argv[3]))); } catch (_) { console.error('Corner-logo preview stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; } }
