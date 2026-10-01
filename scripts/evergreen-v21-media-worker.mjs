/** Preparation-only Evergreen v2.1 worker.
 * Topic-aware AI background -> deterministic branded composition -> immutable Cloudinary image.
 * This version never writes Sheets, calls Buffer, changes status, or publishes.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';

const MODEL='gpt-image-2.5-flare';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOGO_PATH=path.join(ROOT,'assets/brand/derived/invicta-logo-blue-white-wordmark-transparent.png');
const TEMPLATE='evergreen-v2-1';

export const V21_LOGO='assets/brand/derived/invicta-logo-blue-white-wordmark-transparent.png';

export function v21Config(env) {
  for(const name of ['OPENAI_API_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) if(!env[name]) throw Error('Missing secure configuration: '+name);
  return {openai:env.OPENAI_API_KEY,cloud:env.CLOUDINARY_CLOUD_NAME,key:env.CLOUDINARY_API_KEY,secret:env.CLOUDINARY_API_SECRET};
}

export function v21LayoutFamily(type) {
  return {Tip:'tip-curved',Educational:'educational-editorial',Comparison:'comparison-split',Brand:'brand-lifestyle'}[type] || null;
}

export function v21Prompt(item) {
  const family=v21LayoutFamily(item.type);
  if(!family) throw Error('Unsupported Evergreen v2.1 content type.');
  const topic={
    Tip:'a practical homeowner tip about keeping a small reserve of matching flooring planks or tiles for future repairs',
    Educational:'an educational home-improvement explanation grounded in the approved copy',
    Comparison:'a visually accurate comparison of the concepts stated in the approved copy without inventing claims',
    Brand:'a warm, premium Invicta Home Supply home-improvement brand story'
  }[item.type];
  return [
    'Create one premium editorial background image for a 4:5 social graphic, 1080x1350 composition.',
    'Subject and topic: '+topic+'.',
    'Use the approved title and supporting meaning as creative context, but do not render any copy into the image: title '+JSON.stringify(item.title)+'; supporting slides '+JSON.stringify(item.slides)+'.',
    'Use high-quality home-improvement or residential flooring photography, deep forest green and warm gold/orange visual accents, and a polished professional social-ad feel.',
    'Leave a calm, uncluttered logo-safe region in the upper-left and clear negative space for a deterministic overlay. Composition family: '+family+'.',
    'No text, letters, words, typography, logos, brand marks, watermarks, signage containing words, labels, packaging, SKU screenshots, or invented product claims.',
    'Do not generate, imitate, redraw, spell out, or substitute the Invicta Home Supply logo. The authentic repository logo will be added after generation.'
  ].join(' ');
}

async function readV21Snapshot(contentId,hash,config,{fetcher=fetch,contract}={}) {
  if(!/^[A-Z][A-Z0-9-]{1,60}$/.test(contentId)||!/^[A-Za-z0-9_-]{43}$/.test(hash)) throw Error('Explicit content ID and fingerprint required.');
  contract ||= await loadContract();
  const publicId='invicta-social/evergreen-sources-v2-1/'+hash+'.json';
  const response=await fetcher('https://api.cloudinary.com/v1_1/'+config.cloud+'/resources/raw/upload/'+encodeURIComponent(publicId)+'?context=true',{headers:{Authorization:'Basic '+Buffer.from(config.key+':'+config.secret).toString('base64')},redirect:'error'});
  if(response.status===404 && process.env.EVERGREEN_V21_VISUAL_ACCEPTANCE==='true') {
    // Visual acceptance is deliberately read-only: use the approved repository
    // library when no Apps Script queue snapshot exists. Normal preparation is
    // snapshot-only and cannot silently fall back to repository content.
    const local=vm.createContext({socialOperationKey_:input=>requireHash(input),Utilities:{}});
    vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/SocialMedia.js',import.meta.url),'utf8'),local);
    vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/EvergreenSocial.js',import.meta.url),'utf8'),local);
    vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/EvergreenSocialLibrary.js',import.meta.url),'utf8'),local);
    const row=local.evergreenSeedRows_().find(value=>value[0]===contentId);
    if(!row) throw Error('Approved v2.1 visual candidate is not in the repository library.');
    const item=local.evergreenContent_(row),plan=contract.evergreenV21Plan_(item,1);
    if(plan.renderHash!==hash) throw Error('Visual candidate fingerprint does not match the approved repository library.');
    return {item,plan};
  }
  if(!response.ok) throw Error('Approved v2.1 snapshot unavailable.');
  const asset=await response.json();
  if(asset.public_id!==publicId||asset.resource_type!=='raw'||asset.type!=='upload'||asset.context?.custom?.source_hash!==hash||!Number.isInteger(asset.version)||asset.version<1||!(asset.bytes>0&&asset.bytes<20000)) throw Error('v2.1 snapshot identity mismatch.');
  const delivery=await fetcher('https://res.cloudinary.com/'+config.cloud+'/raw/upload/v'+asset.version+'/'+publicId,{redirect:'error'});
  if(!delivery.ok) throw Error('v2.1 snapshot delivery failed.');
  const body=JSON.parse(await delivery.text()), copy=body.content;
  if(body.kind!=='INVICTA_EVERGREEN_SOURCE_V21'||body.templateVersion!==TEMPLATE||body.renderHash!==hash||copy?.id!==contentId||!Array.isArray(copy.slides)||copy.slides.length!==4) throw Error('Invalid v2.1 snapshot contract.');
  const item=contract.evergreenContent_([copy.id,copy.type,copy.title,copy.caption,...copy.slides,'Enabled',120,copy.sources]);
  const plan=contract.evergreenV21Plan_(item,1);
  if(plan.renderHash!==hash) throw Error('v2.1 snapshot content fingerprint mismatch.');
  return {item,plan};
}

function requireHash(input) {
  // This helper is injected into the isolated Apps Script VM only for the
  // read-only acceptance fallback; it mirrors socialOperationKey_ exactly.
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('base64url');
}

async function generateBackground(item,config,fetcher=fetch) {
  const response=await fetcher('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+config.openai,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,prompt:v21Prompt(item),size:'1024x1536',quality:'high',background:'opaque',output_format:'png'}),signal:AbortSignal.timeout(180000),redirect:'error'});
  if(!response.ok) throw Error('OpenAI image generation failed; candidate remains Draft.');
  const body=await response.json(),encoded=body?.data?.[0]?.b64_json;
  if(!encoded) throw Error('OpenAI image response did not contain an image.');
  return Buffer.from(encoded,'base64');
}

export async function renderEvergreenV21(background,item,cwd,{ffmpeg=runFFmpeg,font=process.env.SOCIAL_GRAPHIC_FONT_PATH||'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}={}) {
  await fs.copyFile(font,path.join(cwd,'font.ttf'));
  await fs.writeFile(path.join(cwd,'brand.txt'),'INVICTA HOME SUPPLY');
  await fs.writeFile(path.join(cwd,'type.txt'),item.type.toUpperCase());
  await fs.writeFile(path.join(cwd,'title.txt'),item.title);
  await fs.writeFile(path.join(cwd,'body.txt'),item.slides.filter(Boolean).slice(0,2).join('\n'));
  await fs.writeFile(path.join(cwd,'footer.txt'),'invictahomesupply.com  |  McKinney, TX');
  const family=v21LayoutFamily(item.type);
  const accent=family==='comparison-split'?'0xc8752a':'0xd47a24';
  const lower=family==='educational-editorial'?'y=970':'y=1010';
  const decoration=family==='comparison-split' ? 'drawbox=x=540:y=330:w=6:h=500:color='+accent+':t=fill,' :
    family==='tip-curved' ? 'drawbox=x=72:y=278:w=520:h=3:color='+accent+':t=fill,' :
    family==='educational-editorial' ? 'drawbox=x=72:y=675:w=420:h=4:color='+accent+':t=fill,' :
    'drawbox=x=72:y=278:w=280:h=3:color='+accent+':t=fill,';
  const graph='[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1,'+
    'drawbox=x=0:y=0:w=1080:h=1350:color=0x163226@0.18:t=fill,'+
    'drawbox=x=0:y=0:w=1080:h=245:color=0x163226@0.86:t=fill,'+
    'drawbox=x=0:'+lower+':w=1080:h=340:color=0x163226@0.88:t=fill,'+
    decoration+'drawbox=x=72:y=292:w=390:h=54:color='+accent+':t=fill,'+
    'drawtext=fontfile=font.ttf:textfile=brand.txt:expansion=none:fontsize=34:fontcolor=white:x=82:y=45,'+
    'drawtext=fontfile=font.ttf:textfile=type.txt:expansion=none:fontsize=23:fontcolor=white:x=96:y=307,'+
    'drawtext=fontfile=font.ttf:textfile=title.txt:expansion=none:fontsize=61:fontcolor=white:x=72:y=405:line_spacing=8,'+
    'drawtext=fontfile=font.ttf:textfile=body.txt:expansion=none:fontsize=31:fontcolor=white:x=72:y=720:line_spacing=11,'+
    'drawtext=fontfile=font.ttf:textfile=footer.txt:expansion=none:fontsize=26:fontcolor=white:x=72:y=1280[base];'+
    '[1:v]scale=230:-1[logo];[base][logo]overlay=72:70:format=auto,format=yuvj420p[out]';
  // Keep the real logo as a separate input and preserve its aspect ratio/transparency.
  const output=path.join(cwd,'evergreen-v2-1.jpg');
  ffmpeg(['-hide_banner','-loglevel','error','-y','-i',background,'-i',LOGO_PATH,'-filter_complex',graph,'-map','[out]','-frames:v','1','-q:v','3',output],cwd);
  return output;
}

export async function prepareEvergreenV21(contentId,hash,{config=v21Config(process.env),fetcher=fetch,contract,renderer,ffmpeg=runFFmpeg}={}) {
  contract ||= await loadContract();
  const {item,plan}=await readV21Snapshot(contentId,hash,config,{fetcher,contract});
  if(plan.kind!=='INVICTA_EVERGREEN_MEDIA_V21') throw Error('v2.1 worker requires a v2.1 manifest.');
  const existing=await lookupAsset(config,'image',plan.publicIds[0],plan.hashes[0],fetcher);
  if(existing) return {contentId,renderHash:hash,reused:1,prepared:0,publicId:plan.publicIds[0],model:MODEL};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-v2-1-'));
  try {
    const background=path.join(cwd,'background.png');
    await fs.writeFile(background,renderer ? await renderer(item,plan,cwd) : await generateBackground(item,config,fetcher));
    await fs.access(LOGO_PATH);
    const final=renderer ? await renderEvergreenV21(background,item,cwd,{ffmpeg}) : await renderEvergreenV21(background,item,cwd,{ffmpeg});
    const asset=await uploadAsset(config,'image',plan.publicIds[0],plan.hashes[0],final,fetcher);
    return {contentId,renderHash:hash,reused:0,prepared:1,publicId:plan.publicIds[0],model:MODEL,asset:{width:asset.width,height:asset.height,bytes:asset.bytes,version:asset.version}};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-v2-1-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await prepareEvergreenV21(process.argv[2],process.argv[3]))); }
  catch (_) { console.error('Evergreen v2.1 preparation stopped safely; no approval or publication performed.'); process.exitCode=1; }
}
