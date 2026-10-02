/** Isolated, preparation-only freeform Evergreen visual experiment.
 * It intentionally never reads/writes Social Queue, sends email, calls Buffer,
 * changes Apps Script state, or publishes. Only the test Cloudinary namespace
 * is used.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';
import {v21Config} from './evergreen-v21-media-worker.mjs';

const MODEL='gpt-image-2.5-flare';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOGO_PATH=path.join(ROOT,'assets/brand/derived/invicta-logo-blue-white-wordmark-transparent.png');
const NAMESPACE='invicta-social/evergreen-freeform-test';

export function freeformHash(contentId,sourceHash) {
  return crypto.createHash('sha256').update('evergreen-freeform-test|'+contentId+'|'+sourceHash+'|v1').digest('base64url');
}

export function freeformPrompt(item) {
  const context={
    Tip:'The topic is “Measure twice before choosing boxes.” Show a realistic flooring-planning scene with measuring, room dimensions, a tape measure, and quantity preparation. The visual should immediately communicate measuring and planning.',
    Educational:'The topic is “Wear layer: 6, 12 or 22 MIL?” Explain visually that MIL refers to the protective wear layer above the printed design on vinyl/LVP/SPC flooring, not total plank thickness. Use a credible flooring cross-section or surface-protection concept, not generic solid hardwood imagery.',
    Comparison:'The topic is “5 mm / 12 MIL vs 7 mm / 22 MIL.” Show a fair, clear comparison of overall plank thickness and wear-layer thickness. Do not imply the higher numbers are universally better and do not invent construction details.',
    Brand:'Create a warm, premium Invicta Home Supply brand story.'
  }[item.type];
  return [
    'Create a finished premium 4:5 social-media graphic for Invicta Home Supply, using the same gpt-image-2.5-flare image model as the existing Evergreen v2.1 experiment.',
    'Design freely like an experienced home-improvement advertising creative director. The finished graphic should look polished enough to publish directly on Facebook and Instagram without manual redesign.',
    'Use modern home-improvement styling with deep forest green, warm gold/orange accents, clean white typography, realistic relevant imagery, concise on-image copy, strong hierarchy, generous margins, and a professional editorial advertising feel.',
    context,
    'Use the approved topic and supporting meaning as the source of truth. Keep the copy concise. You may choose the composition, typography scale, panels, curves, split treatment, and placement naturally; do not force a rigid grid or coordinate-based layout.',
    'Keep every headline and body line safely inside the canvas with an approximately 8–10% safe margin from the top, left, and right edges. Never place headline text flush against the top crop boundary; no letters may touch or extend beyond any canvas edge. Reserve the top-right area for the authentic logo badge; do not place headline, body copy, icons, or important imagery in that reserved logo area.',
    'Do not generate, redraw, imitate, spell out, or substitute the Invicta Home Supply logo. Do not add a separate business-name wordmark or duplicate Invicta branding; the real repository logo will be overlaid afterward.',
    'Avoid clipped text, awkward margins, duplicate branding, text collisions, generic unrelated flooring imagery, misleading product visuals, product packaging, SKUs, watermarks, and signage containing words.'
  ].join(' ');
}

export async function loadCandidate(contentId,sourceHash,contract) {
  const ctx=vm.createContext({socialOperationKey_:input=>crypto.createHash('sha256').update(JSON.stringify(input)).digest('base64url'),Utilities:{}});
  vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/SocialMedia.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/EvergreenSocial.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/EvergreenSocialLibrary.js',import.meta.url),'utf8'),ctx);
  const row=ctx.evergreenSeedRows_().find(value=>value[0]===contentId);
  if(!row) throw Error('Candidate is not in the approved Evergreen library.');
  const item=ctx.evergreenContent_(row);
  const plan=contract.evergreenV21Plan_(item,1);
  if(plan.renderHash!==sourceHash) throw Error('Candidate source hash does not match the approved library.');
  return item;
}

export async function generateFreeform(item,config,fetcher=fetch) {
  const prompt=freeformPrompt(item);
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+config.openai,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,prompt,size:'1024x1536',quality:'high',background:'opaque',output_format:'png'}),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok) throw Error('OpenAI image generation failed; no test asset uploaded.');
  const body=await response.json(),encoded=body?.data?.[0]?.b64_json;
  if(!encoded) throw Error('OpenAI image response did not contain an image.');
  return {bytes:Buffer.from(encoded,'base64'),prompt};
}

export function freeformLogoPlacement(type) {
  return {Tip:[70,70],Educational:[790,70],Comparison:[70,1080],Brand:[70,70]}[type] || [70,70];
}

export async function renderFreeform(background,item,cwd,{ffmpeg=runFFmpeg,font=process.env.SOCIAL_GRAPHIC_FONT_PATH||'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}={}) {
  await fs.copyFile(font,path.join(cwd,'font.ttf'));
  const [x,y]=freeformLogoPlacement(item.type);
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[base];'+
    '[1:v]scale=220:-1[logo];[base][logo]overlay='+x+':'+y+':format=auto,format=yuvj420p[out]';
  const output=path.join(cwd,'evergreen-freeform-test.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',LOGO_PATH,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareFreeform(contentId,sourceHash,{config=v21Config(process.env),contract,fetcher=fetch,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const item=await loadCandidate(contentId,sourceHash,contract);
  const renderHash=freeformHash(contentId,sourceHash);
  const publicId=NAMESPACE+'/'+renderHash;
  const existing=await lookupAsset(config,'image',publicId,renderHash,fetcher);
  if(existing) return {contentId,sourceHash,renderHash,reused:1,prepared:0,publicId,model:MODEL,prompt:freeformPrompt(item),asset:{width:existing.width,height:existing.height,bytes:existing.bytes,version:existing.version}};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-freeform-'));
  try {
    const generated=renderer ? await renderer(item,sourceHash,cwd) : await generateFreeform(item,config,fetcher);
    await fs.writeFile(path.join(cwd,'background.png'),generated.bytes || generated);
    await fs.access(LOGO_PATH);
    const final=await renderFreeform(path.join(cwd,'background.png'),item,cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',publicId,renderHash,final,fetcher);
    return {contentId,sourceHash,renderHash,reused:0,prepared:1,publicId,model:MODEL,prompt:generated.prompt||freeformPrompt(item),asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-freeform-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareFreeform(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Freeform visual experiment stopped safely; no queue/status/email/publication performed.'); process.exitCode=1; }
}
