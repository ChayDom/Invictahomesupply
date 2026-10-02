/** Isolated freeform Evergreen experiment with a deterministic safe-corner logo badge.
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
const NAMESPACE='invicta-social/evergreen-freeform-badge-test';

export function badgeHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-badge-test|'+contentId+'|'+sourceHash+'|logo-badge-v1').digest('base64url');
}

export function badgePlacement() {
  return {corner:'top-right',x:730,y:44,width:300,height:150};
}

async function writeBadgeSvg(cwd) {
  const logo=await fs.readFile(LOGO_PATH);
  const p=badgePlacement();
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}"><defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#163226" flood-opacity=".22"/></filter></defs><rect x="2" y="2" width="${p.width-4}" height="${p.height-4}" rx="28" fill="#fffaf0" filter="url(#shadow)"/><image href="data:image/png;base64,${logo.toString('base64')}" x="20" y="18" width="${p.width-40}" height="${p.height-36}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  const file=path.join(cwd,'logo-badge.svg');
  await fs.writeFile(file,svg);
  return file;
}

export async function renderWithBadge(background,cwd,{ffmpeg=runFFmpeg}={}) {
  const p=badgePlacement();
  const badge=await writeBadgeSvg(cwd);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];'+
    '[1:v]format=rgba[badge];[base][badge]overlay='+p.x+':'+p.y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-freeform-badge-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',badge,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareLogoBadge(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=badgeHash(contentId,sourceHash),publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:freeformPrompt(item),badge:badgePlacement(),asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-logo-badge-'));
  try {
    const generated=renderer ? await renderer(item,sourceHash,cwd) : await generateFreeform(item,config,fetcher);
    await fs.writeFile(path.join(cwd,'background.png'),generated.bytes || generated);
    await fs.access(LOGO_PATH);
    const final=await renderWithBadge(path.join(cwd,'background.png'),cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher);
    return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||freeformPrompt(item),badge:badgePlacement(),asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-logo-badge-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareLogoBadge(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Logo-badge experiment stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; }
}
