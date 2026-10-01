/** Preparation-only Evergreen v2 worker.
 * Immutable snapshot -> one OpenAI composition -> real repo logo overlay -> Cloudinary.
 * Never writes Sheets, calls Buffer, changes statuses, or publishes.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';
import {readEvergreenSnapshot} from './evergreen-media-worker.mjs';

const MODEL='gpt-image-2.5-flare';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOGO_PATH=path.join(ROOT,'assets/brand/derived/invicta-logo-blue-white-wordmark-transparent.png');

export function v2Config(env) {
  for(const name of ['OPENAI_API_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) if(!env[name]) throw Error('Missing secure configuration: '+name);
  return {openai:env.OPENAI_API_KEY,cloud:env.CLOUDINARY_CLOUD_NAME,key:env.CLOUDINARY_API_KEY,secret:env.CLOUDINARY_API_SECRET};
}

export function v2Prompt(item) {
  const family={Tip:'curved premium editorial layout',Educational:'editorial information-led layout',Comparison:'split comparison-oriented layout',Brand:'lifestyle brand-forward layout'}[item.type];
  return ['Create one finished 4:5 portrait social-media composition for Invicta Home Supply.',
    'Content type: '+item.type+'. Composition family: '+family+'.',
    'Use deep forest green, warm gold/orange accents, premium editorial home-improvement photography, strong hierarchy, polished footer, and concise readable on-image copy.',
    'Use this approved copy exactly where practical: title: '+JSON.stringify(item.title)+'; supporting copy: '+JSON.stringify(item.slides.join(' '))+'; footer: "invictahomesupply.com" and "McKinney, TX".',
    'Reserve a clean logo-safe region appropriate for a real logo overlay added after generation.',
    'Do not generate the Invicta logo. Do not generate any logo, brand mark, substitute brand typography, watermark, or additional logo. Do not imitate or redraw the Invicta logo.',
    'Do not invent product SKUs, prices, claims, or packaging. Keep the visual polished and social-ad ready, not generic PowerPoint.'].join(' ');
}

async function generateBackground(item,config,fetcher=fetch) {
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+config.openai,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,prompt:v2Prompt(item),size:'1024x1536',quality:'high',background:'opaque',output_format:'png'}),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok) throw Error('OpenAI image generation failed; candidate remains Draft.');
  const body=await response.json(),encoded=body?.data?.[0]?.b64_json;
  if(!encoded) throw Error('OpenAI image response did not contain an image.');
  return Buffer.from(encoded,'base64');
}

export async function prepareEvergreenV2(contentId,hash,{config=v2Config(process.env),fetcher=fetch,contract,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const {item,plan}=await readEvergreenSnapshot(contentId,hash,config,{fetcher,contract});
  if(plan.kind!=='INVICTA_EVERGREEN_MEDIA_V2') throw Error('V2 worker requires an evergreen-v2 manifest.');
  const existing=await lookupAsset(config,'image',plan.publicIds[0],plan.hashes[0],fetcher);
  if(existing) return {contentId,renderHash:hash,reused:1,prepared:0,publicId:plan.publicIds[0],model:MODEL};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-v2-'));
  try {
    const background=path.join(cwd,'background.png'), final=path.join(cwd,'evergreen-v2.jpg');
    await fs.writeFile(background,renderer ? await renderer(item,plan,cwd) : await generateBackground(item,config,fetcher));
    await fs.access(LOGO_PATH);
    ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',LOGO_PATH,'-filter_complex','[0:v]scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=0x24352a[bg];[1:v]scale=250:250[logo];[bg][logo]overlay=35:25:format=auto,format=yuvj420p[out]','-map','[out]','-frames:v','1','-q:v','2',final],cwd);
    const asset=await uploadAsset(config,'image',plan.publicIds[0],plan.hashes[0],final,fetcher);
    return {contentId,renderHash:hash,reused:0,prepared:1,publicId:plan.publicIds[0],model:MODEL,asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-v2-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareEvergreenV2(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Evergreen v2 preparation stopped safely; no approval or publication performed.'); process.exitCode=1; }
}
