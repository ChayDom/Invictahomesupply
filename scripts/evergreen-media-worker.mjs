/** Preparation only: immutable public-copy snapshot -> four graphics -> Cloudinary.
 * No Sheets/Airtable/Buffer token, publication, scheduler or Netlify interaction.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadContract,lookupAsset,uploadAsset,runFFmpeg} from './social-media-worker.mjs';

export function evergreenConfig(env) {
  for(const name of ['CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) {
    if(!env[name])throw Error('Missing secure configuration: '+name);
  }
  if(!/^[a-z0-9_-]+$/i.test(env.CLOUDINARY_CLOUD_NAME))throw Error('Invalid cloud identifier.');
  return {cloud:env.CLOUDINARY_CLOUD_NAME,key:env.CLOUDINARY_API_KEY,secret:env.CLOUDINARY_API_SECRET};
}

export async function readEvergreenSnapshot(contentId,hash,config,{fetcher=fetch,contract}={}) {
  if(!/^[A-Z][A-Z0-9-]{1,60}$/.test(contentId)||!/^[A-Za-z0-9_-]{43}$/.test(hash))throw Error('Explicit content ID and fingerprint required.');
  contract ||= await loadContract();
  const publicIdV1='invicta-social/evergreen-sources-v1/'+hash+'.json';
  const publicIdV2='invicta-social/evergreen-sources-v2/'+hash+'.json';
  let publicId=publicIdV2;
  let response=await fetcher('https://api.cloudinary.com/v1_1/'+config.cloud+'/resources/raw/upload/'+encodeURIComponent(publicId)+'?context=true',
    {headers:{Authorization:'Basic '+Buffer.from(config.key+':'+config.secret).toString('base64')},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(response.status===404){ publicId=publicIdV1; response=await fetcher('https://api.cloudinary.com/v1_1/'+config.cloud+'/resources/raw/upload/'+encodeURIComponent(publicId)+'?context=true',
    {headers:{Authorization:'Basic '+Buffer.from(config.key+':'+config.secret).toString('base64')},redirect:'error',signal:AbortSignal.timeout(30000)}); }
  if(!response.ok)throw Error('Approved immutable snapshot unavailable.');
  const asset=await response.json();
  // Test doubles and older Cloudinary mirrors may return the legacy identity
  // even when the v2 probe is routed elsewhere; honor only the exact v1 ID.
  if(asset.public_id===publicIdV1) publicId=publicIdV1;
  if(asset.public_id!==publicId||asset.resource_type!=='raw'||asset.type!=='upload'||asset.context?.custom?.source_hash!==hash||
    !Number.isInteger(asset.version)||asset.version<1||!(asset.bytes>0&&asset.bytes<20000))throw Error('Snapshot identity mismatch.');
  // Construct the version-pinned URL, never follow an arbitrary URL in API/input data.
  const delivery=await fetcher('https://res.cloudinary.com/'+config.cloud+'/raw/upload/v'+asset.version+'/'+publicId,
    {redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!delivery.ok)throw Error('Snapshot delivery failed.');
  let size=0;const chunks=[];
  for await(const chunk of delivery.body) {size+=chunk.length;if(size>=20000)throw Error('Snapshot exceeds limit.');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),copy=body.content;
  if(!['INVICTA_EVERGREEN_SOURCE_V1','INVICTA_EVERGREEN_SOURCE_V2'].includes(body.kind)||!['evergreen-v1','evergreen-v2'].includes(body.templateVersion)||body.renderHash!==hash||copy?.id!==contentId||
    !Array.isArray(copy.slides)||copy.slides.length!==4)throw Error('Invalid snapshot contract.');
  const item=contract.evergreenContent_([copy.id,copy.type,copy.title,copy.caption,...copy.slides,'Enabled',120,copy.sources]);
  const plan=body.templateVersion==='evergreen-v2' ? contract.evergreenV2Plan_(item,1) : contract.evergreenPlan_(item,1);
  if(plan.renderHash!==hash)throw Error('Snapshot content fingerprint mismatch.');
  return {item,plan};
}

export function graphicText(value,columns,maxLines) {
  const words=String(value).replace(/[\r\n\t]/g,' ').split(/\s+/).filter(Boolean),lines=[''];
  for(const word of words) {
    if(word.length>columns)throw Error('Graphic word too long; edit source instead of silently truncating.');
    if((lines.at(-1)+' '+word).trim().length>columns)lines.push(word);
    else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();
  }
  if(lines.length>maxLines)throw Error('Graphic text does not fit; edit source, no truncated claims.');
  return lines.join('\n');
}

export async function renderEvergreen(item,cwd,{ffmpeg=runFFmpeg,
  font=process.env.SOCIAL_GRAPHIC_FONT_PATH||'/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'}={}) {
  await fs.copyFile(font,path.join(cwd,'font.ttf'));
  await fs.writeFile(path.join(cwd,'brand.txt'),'INVICTA HOME SUPPLY');
  await fs.writeFile(path.join(cwd,'title.txt'),graphicText(item.title,45,3));
  await fs.writeFile(path.join(cwd,'cta.txt'),'invictahomesupply.com\nMcKinney, TX');
  const files=[];
  for(let index=0;index<4;index++) {
    await fs.writeFile(path.join(cwd,'body.txt'),graphicText(item.slides[index],30,14));
    await fs.writeFile(path.join(cwd,'label.txt'),item.type.toUpperCase()+'  |  '+(index+1)+' / 4');
    const graph="drawbox=x=0:y=0:w=iw:h=145:color=0x24352a:t=fill,"+
      "drawbox=x=80:y=330:w=920:h=6:color=0xc14a26:t=fill,"+
      "drawbox=x=0:y=1190:w=iw:h=160:color=0x24352a:t=fill,"+
      "drawtext=fontfile=font.ttf:textfile=brand.txt:expansion=none:fontsize=43:fontcolor=0xeef1ea:x=80:y=42,"+
      "drawtext=fontfile=font.ttf:textfile=label.txt:expansion=none:fontsize=24:fontcolor=0xeef1ea:x=80:y=103,"+
      "drawtext=fontfile=font.ttf:textfile=title.txt:expansion=none:fontsize=32:fontcolor=0x24352a:x=80:y=187:line_spacing=9,"+
      "drawtext=fontfile=font.ttf:textfile=body.txt:expansion=none:fontsize=46:fontcolor=0x24352a:x=80:y=388:line_spacing=12,"+
      "drawtext=fontfile=font.ttf:textfile=cta.txt:expansion=none:fontsize=30:fontcolor=0xeef1ea:x=80:y=1225:line_spacing=14";
    const file=path.join(cwd,'evergreen-'+index+'.jpg');
    ffmpeg(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0xeef1ea:s=1080x1350',
      '-vf',graph,'-frames:v','1','-q:v','3',file],cwd);
    files.push(file);
  }
  return files;
}

export async function prepareEvergreen(contentId,hash,{config,fetcher=fetch,contract,renderer=renderEvergreen}={}) {
  config ||= evergreenConfig(process.env);contract ||= await loadContract();
  const {item,plan}=await readEvergreenSnapshot(contentId,hash,config,{fetcher,contract});
  const existing=[];
  for(let i=0;i<4;i++)existing.push(await lookupAsset(config,'image',plan.publicIds[i],plan.hashes[i],fetcher));
  if(existing.every(Boolean))return {contentId,renderHash:hash,reused:4,prepared:0};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-evergreen-'));
  try {
    const files=await renderer(item,cwd);
    for(let i=0;i<4;i++) {
      if(existing[i])continue;
      if((await fs.stat(files[i])).size>8*1024*1024)throw Error('Graphic exceeds social limit.');
      await uploadAsset(config,'image',plan.publicIds[i],plan.hashes[i],files[i],fetcher);
    }
    return {contentId,renderHash:hash,reused:existing.filter(Boolean).length,prepared:existing.filter(a=>!a).length};
  } finally {
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-evergreen-'))throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await prepareEvergreen(process.argv[2],process.argv[3])));}
  catch (_) {console.error('Evergreen preparation stopped safely; inspect approved content/configuration. No publication performed.');process.exitCode=1;}
}
