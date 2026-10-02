/** Isolated Evergreen visual fix: curved flush corner panel, inward logo padding,
 * and reinforced freeform safe-area guidance. Never touches queue or publishing.
 */
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
const NAMESPACE='invicta-social/evergreen-freeform-safe-logo-fix-test';

export function safeLogoFixHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-safe-logo-fix-test|'+contentId+'|'+sourceHash+'|logo-safe-v2').digest('base64url');
}

export function safeLogoFixPlacement() {
  return {corner:'top-right',x:760,y:0,width:320,height:205,anchoredTop:true,anchoredRight:true,logoX:55,logoY:30,logoWidth:220,logoHeight:135,roundedCorner:'organic-inner-edge'};
}

export function safeLogoFixPrompt(item) {
  return freeformPrompt(item)+' For this revision, keep the entire top 12% of the 1080x1350 canvas clear of all headline, TIP, Educational, Comparison, body text, icons, and labels. Keep every important text block at least 10% from the top, left, and right edges, with no lettering clipped or touching any edge. The top-right branding zone is reserved for a compact curved cream logo panel; do not place any text or important imagery beneath or inside that zone. If necessary, shift the entire text composition downward while preserving the freeform editorial design.';
}

async function generateSafeLogoFix(item,config,fetcher=fetch) {
  const prompt=safeLogoFixPrompt(item);
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+config.openai,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,prompt,size:'1024x1536',quality:'high',background:'opaque',output_format:'png'}),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok) throw Error('OpenAI image generation failed; no test asset uploaded.');
  const body=await response.json(),encoded=body?.data?.[0]?.b64_json;
  if(!encoded) throw Error('OpenAI image response did not contain an image.');
  return {bytes:Buffer.from(encoded,'base64'),prompt};
}

async function writePanelSvg(cwd) {
  const logo=await fs.readFile(LOGO_PATH),p=safeLogoFixPlacement();
  const shape='M0 0H320V205C270 198 218 179 180 149C132 111 96 59 0 44Z';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><path d="${shape}" fill="#fffaf0" stroke="#eadfca" stroke-width="2"/><image href="data:image/png;base64,${logo.toString('base64')}" x="${p.logoX}" y="${p.logoY}" width="${p.logoWidth}" height="${p.logoHeight}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const file=path.join(cwd,'logo-safe-fix-panel.svg');
  await fs.writeFile(file,svg);
  return file;
}

export async function renderSafeLogoFix(background,cwd,{ffmpeg=runFFmpeg}={}) {
  const p=safeLogoFixPlacement(),panel=await writePanelSvg(cwd);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];'+
    '[1:v]format=rgba[panel];[base][panel]overlay='+p.x+':'+p.y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-safe-logo-fix-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',panel,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareSafeLogoFix(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=safeLogoFixHash(contentId,sourceHash),publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:safeLogoFixPrompt(item),panel:safeLogoFixPlacement(),validation:'manual visual acceptance required',asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-safe-logo-fix-'));
  try {
    const generated=renderer ? await renderer(item,sourceHash,cwd) : await generateSafeLogoFix(item,config,fetcher);
    await fs.writeFile(path.join(cwd,'background.png'),generated.bytes || generated);
    await fs.access(LOGO_PATH);
    const final=await renderSafeLogoFix(path.join(cwd,'background.png'),cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher);
    return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||safeLogoFixPrompt(item),panel:safeLogoFixPlacement(),validation:'manual visual acceptance required',asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-safe-logo-fix-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareSafeLogoFix(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Safe-logo visual fix stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; }
}
