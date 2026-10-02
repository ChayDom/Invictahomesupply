/** Isolated freeform Evergreen visual experiment with hard text-safe areas and a flush top-right logo badge.
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
const NAMESPACE='invicta-social/evergreen-freeform-safe-area-test';

export function safeAreaHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-safe-area-test|'+contentId+'|'+sourceHash+'|logo-safe-area-v2').digest('base64url');
}

export function safeBadgePlacement() {
  return {corner:'top-right',x:780,y:0,width:300,height:150,anchoredTop:true,anchoredRight:true,roundedCorner:'bottom-left'};
}

async function writeSafeBadgeSvg(cwd) {
  const logo=await fs.readFile(LOGO_PATH);
  const p=safeBadgePlacement();
  const shape='M0 0H300V150H30C13.4 150 0 136.6 0 120Z';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><path d="${shape}" fill="#fffaf0" stroke="#eadfca" stroke-width="2"/><image href="data:image/png;base64,${logo.toString('base64')}" x="20" y="18" width="260" height="114" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const file=path.join(cwd,'logo-safe-area-badge.svg');
  await fs.writeFile(file,svg);
  return file;
}

export async function renderWithSafeBadge(background,cwd,{ffmpeg=runFFmpeg}={}) {
  const p=safeBadgePlacement();
  const badge=await writeSafeBadgeSvg(cwd);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];'+
    '[1:v]format=rgba[badge];[base][badge]overlay='+p.x+':'+p.y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-freeform-safe-area-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',badge,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareSafeArea(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=safeAreaHash(contentId,sourceHash),publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:freeformPrompt(item),badge:safeBadgePlacement(),validation:'manual visual acceptance required',asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-safe-area-'));
  try {
    const generated=renderer ? await renderer(item,sourceHash,cwd) : await generateFreeform(item,config,fetcher);
    await fs.writeFile(path.join(cwd,'background.png'),generated.bytes || generated);
    await fs.access(LOGO_PATH);
    const final=await renderWithSafeBadge(path.join(cwd,'background.png'),cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher);
    return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||freeformPrompt(item),badge:safeBadgePlacement(),validation:'manual visual acceptance required',asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-safe-area-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareSafeArea(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Safe-area visual experiment stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; }
}
