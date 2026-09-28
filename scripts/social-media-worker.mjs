/** Preparation only: Airtable GET -> FFmpeg -> immutable Cloudinary upload.
 * No Buffer/Gemini/Netlify/Sheets credentials, calls, scheduling or publication.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareMusicAudio} from './social-music.mjs';

export const airtableBase = 'apptugvm4r5tm2OIt';
export const airtableTable = 'tblUyA3uFL6FmMw6T';
export async function loadContract() {
  const ctx = vm.createContext({
    socialOperationKey_:input=>crypto.createHash('sha256').update(JSON.stringify(input)).digest('base64url'),
    buildSocialSourceHash_:()=>'' // Worker never approves copy/queue; sender owns this hash.
  });
  vm.runInContext(await fs.readFile(new URL('../Invicta Appscript Files/SocialMedia.js',import.meta.url),'utf8'),ctx);
  return ctx;
}
const assetContract=await loadContract();

export function secureConfig(env) {
  for (const name of ['AIRTABLE_SOCIAL_READ_TOKEN','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET']) {
    if (!env[name]) throw Error('Missing secure configuration: '+name);
  }
  if (!/^[a-z0-9_-]+$/i.test(env.CLOUDINARY_CLOUD_NAME)) throw Error('Invalid Cloudinary cloud name.');
  return {token:env.AIRTABLE_SOCIAL_READ_TOKEN,cloud:env.CLOUDINARY_CLOUD_NAME,
    key:env.CLOUDINARY_API_KEY,secret:env.CLOUDINARY_API_SECRET};
}

export async function readProduct(productKey,config,fetcher=fetch) {
  if (!/^[A-Za-z0-9|_-]{1,150}$/.test(productKey)) throw Error('Explicit valid Product Key required.');
  const fields=['Product Key','Name','Category','Price','Price Basis','Unit Type','Post to Website','Status',
    'Quantity Available','Photos','Card Spec 1','Card Spec 2','Card Spec 3'];
  const params=new URLSearchParams({filterByFormula:'{Product Key}="'+productKey+'"',pageSize:'100'});
  for(const field of fields) params.append('fields[]',field);
  const response=await fetcher('https://api.airtable.com/v0/'+airtableBase+'/'+airtableTable+'?'+params,
    {headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok) throw Error('Airtable read failed (HTTP '+response.status+').');
  const body=await response.json();
  if(!Array.isArray(body.records)||body.records.length!==1||body.offset||
    body.records[0].fields['Product Key']!==productKey) throw Error('Missing/duplicate/incomplete product identity.');
  return body.records[0].fields;
}

export function photoDownloadUrl(raw) {
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port||
    !/(^|\.)airtableusercontent\.com$/.test(url.hostname)) throw Error('Only actual Airtable Photos delivery hosts allowed.');
  return url.href;
}

export async function downloadPhoto(photo,target,fetcher=fetch) {
  const response=await fetcher(photoDownloadUrl(photo.url),{redirect:'error',signal:AbortSignal.timeout(60000)});
  // Airtable legitimately serves some owner attachments as binary/octet-stream.
  // Allow that delivery header ONLY after validating the actual file signature.
  if(!response.ok||!(/^(image\/(jpeg|png|webp)|(?:application|binary)\/octet-stream)(;|$)/i.test(response.headers.get('content-type')||''))) {
    throw Error('Photo download failed/unsupported.');
  }
  const limit=50*1024*1024, chunks=[];let size=0;
  if(Number(response.headers.get('content-length'))>limit) throw Error('Photo exceeds preparation limit.');
  for await(const chunk of response.body) {
    size+=chunk.length;if(size>limit) throw Error('Photo exceeds preparation limit.');
    chunks.push(chunk);
  }
  if(!size) throw Error('Empty Photo.');
  const bytes=Buffer.concat(chunks);
  const mime=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'image/jpeg':
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':'';
  if(!mime||mime!==photo.type) throw Error('Photo bytes do not match approved attachment type.');
  await fs.writeFile(target,bytes);
}

export function uploadSignature(params,secret) {
  const serialized=Object.keys(params).sort().map(key=>key+'='+params[key]).join('&');
  return crypto.createHash('sha256').update(serialized+secret).digest('hex');
}

export function verifyAsset(asset,type,publicId,hash,plan) {
  const video=type==='video';
  const videoFacts=video ? assetContract.socialCloudinaryVideoFacts_(asset||{}) : null;
  if(asset?.public_id!==publicId||asset.resource_type!==type||asset.type!=='upload'||
    asset.context?.custom?.source_hash!==hash||!Number.isInteger(asset.version)||asset.version<=0||
    asset.format!==(video?'mp4':'jpg')||asset.width!==1080||asset.height!==(video?1920:1350)||
    !(asset.bytes>0&&asset.bytes<=(video?100:8)*1024*1024)||
    (video&&(!Number.isFinite(asset.duration)||Math.abs(asset.duration-12)>0.5||videoFacts.codec!=='h264'||
      !assetContract.socialVideoAudioAllowed_(asset,plan)))) {
    const error=Error('Existing/prepared asset does not match immutable identity/format.');
    error.assetFacts={idMatches:asset?.public_id===publicId,hashMatches:asset?.context?.custom?.source_hash===hash,
      format:asset?.format,width:asset?.width,height:asset?.height,bytes:asset?.bytes,seconds:asset?.duration,
      hasVideoMetadata:!!asset?.video,hasMediaMetadata:!!asset?.media_metadata,hasImageMetadata:!!asset?.image_metadata,
      nestedH264:asset?.video?.codec==='h264',mediaH264:asset?.media_metadata?.codec==='h264',imageH264:asset?.image_metadata?.codec==='h264',
      flatH264:asset?.codec==='h264',audioPresent:videoFacts?.audioPresent??false};
    throw error;
  }
  return asset;
}

export async function lookupAsset(config,type,publicId,hash,fetcher=fetch,plan) {
  const response=await fetcher('https://api.cloudinary.com/v1_1/'+config.cloud+'/resources/'+type+'/upload/'+encodeURIComponent(publicId)+'?context=true&media_metadata=true',
    {headers:{Authorization:'Basic '+Buffer.from(config.key+':'+config.secret).toString('base64')},
      redirect:'error',signal:AbortSignal.timeout(30000)});
  if(response.status===404) return null;
  if(!response.ok) throw Error('Cloudinary lookup failed (HTTP '+response.status+').');
  return verifyAsset(await response.json(),type,publicId,hash,plan);
}

export async function uploadAsset(config,type,publicId,hash,file,fetcher=fetch,plan,musicStatus) {
  const musicContext=type==='video'&&plan?.musicTrackId?
    '|music_track_id='+plan.musicTrackId+'|music_library_version='+plan.musicLibraryVersion+'|music_status='+musicStatus:'';
  if(musicContext&&!['music','silent-fallback'].includes(musicStatus))throw Error('Verified music result required.');
  const params={public_id:publicId,overwrite:'false',context:'source_hash='+hash+musicContext,timestamp:String(Math.floor(Date.now()/1000))};
  const data=new FormData();
  for(const [key,value] of Object.entries(params)) data.set(key,value);
  data.set('api_key',config.key);data.set('signature',uploadSignature(params,config.secret));
  data.set('file',new Blob([await fs.readFile(file)]),type==='video'?'reel.mp4':'photo.jpg');
  const response=await fetcher('https://api.cloudinary.com/v1_1/'+config.cloud+'/'+type+'/upload',
    {method:'POST',body:data,redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok) throw Error('Cloudinary upload failed (HTTP '+response.status+'). No overwrite/retry permitted.');
  // Resolve authoritative metadata, including codec; never trust an old asset on upload collision.
  const asset=await lookupAsset(config,type,publicId,hash,fetcher,plan);
  if(!asset) throw Error('Uploaded asset not observable; stop and reconcile manually.');
  return asset;
}

export function runFFmpeg(args,cwd,bin=process.env.FFMPEG_PATH||'ffmpeg') {
  const result=spawnSync(bin,args,{cwd,encoding:'utf8',timeout:600000,windowsHide:true,maxBuffer:1024*1024});
  // Never log raw stderr; malformed source/remote input can contain sensitive URLs.
  if(result.status!==0) throw Error('Local FFmpeg operation failed; inspect local inputs without exposing credentials.');
}

export function wrapText(value,columns,maxLines) {
  const words=String(value||'').replace(/[\x00-\x1F\x7F]/g,' ').split(/\s+/).filter(Boolean);
  const lines=[''];
  for(let word of words) {
    word=word.slice(0,columns);
    if((lines.at(-1)+' '+word).trim().length>columns) {
      if(lines.length===maxLines) {lines[lines.length-1]=lines.at(-1).slice(0,columns-3)+'...';break;}
      lines.push(word);
    } else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();
  }
  return lines.join('\n');
}

export function reelGraph(photoCount,{musicCredit=false}={}) {
  if(!Number.isInteger(photoCount)||photoCount<4||photoCount>6) throw Error('Reel needs 4-6 Photos.');
  const fade=0.5, segment=(12+fade*(photoCount-1))/photoCount;
  const filters=[];
  for(let i=0;i<photoCount;i++) {
    filters.push('['+i+':v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,'+
      "zoompan=z='min(zoom+0.00015,1.04)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,"+
      'trim=duration='+segment+',setpts=PTS-STARTPTS,format=yuv420p[v'+i+']');
  }
  let previous='v0';
  for(let i=1;i<photoCount;i++) {
    const label='mix'+i;
    filters.push('['+previous+'][v'+i+']xfade=transition=fade:duration='+fade+':offset='+(i*(segment-fade))+'['+label+']');
    previous=label;
  }
  filters.push('['+previous+']drawbox=x=0:y=0:w=iw:h=370:color=black@0.7:t=fill,'+
    'drawbox=x=0:y=1410:w=iw:h=510:color=black@0.8:t=fill,'+
    "drawtext=fontfile=font.ttf:textfile=brand.txt:expansion=none:fontsize=45:fontcolor=white:x=60:y=60,"+
    "drawtext=fontfile=font.ttf:textfile=name.txt:expansion=none:fontsize=45:fontcolor=white:x=60:y=145:line_spacing=12,"+
    "drawtext=fontfile=font.ttf:textfile=price.txt:expansion=none:fontsize=60:fontcolor=white:x=60:y=1460,"+
    "drawtext=fontfile=font.ttf:textfile=specs.txt:expansion=none:fontsize=35:fontcolor=white:x=60:y=1560:line_spacing=10,"+
    (musicCredit?"drawtext=fontfile=font.ttf:textfile=music-credit.txt:expansion=none:fontsize=20:fontcolor=white:x=60:y=1750:line_spacing=4,":"")+
    "drawtext=fontfile=font.ttf:textfile=cta.txt:expansion=none:fontsize=32:fontcolor=white:x=60:y=1830,"+
    'scale=in_range=auto:out_range=tv,format=yuv420p[out]');
  return filters.join(';\n');
}

export async function renderReel(photos,facts,cwd,{ffmpeg=runFFmpeg,musicPlan,music=prepareMusicAudio,
  probe=verifyReel,font=process.env.SOCIAL_FONT_PATH||'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'}={}) {
  let audio=null;
  if(musicPlan) {
    try {audio=await music(musicPlan,cwd,{ffmpeg});} catch (_) { /* Optional audio must not fail a post. */ }
  }
  await fs.copyFile(font,path.join(cwd,'font.ttf'));
  const text={brand:wrapText(facts.brand,32,1),name:wrapText(facts.name,32,3),
    price:wrapText(facts.price,24,1),specs:wrapText(facts.specs.join(' | '),42,4),cta:wrapText(facts.cta,50,1)};
  for(const [name,value] of Object.entries(text)) await fs.writeFile(path.join(cwd,name+'.txt'),value);
  if(audio)await fs.writeFile(path.join(cwd,'music-credit.txt'),audio.credit);
  const graph=reelGraph(photos.length,{musicCredit:!!audio});
  await fs.writeFile(path.join(cwd,'reel-filter.txt'),graph);
  // Decode/resize each large attachment ONCE. Looping 9000px originals at 30fps
  // wastes CPU and can exceed free-runner/job budgets before encoding starts.
  const slides=[];
  for(let i=0;i<photos.length;i++) {
    const slide='slide-'+i+'.jpg';
    ffmpeg(['-hide_banner','-loglevel','error','-y','-i',photos[i],'-vf',
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '-frames:v','1','-q:v','3',slide],cwd);
    slides.push(slide);
  }
  const args=['-hide_banner','-loglevel','error','-y','-filter_complex_threads','1'];
  const segment=(12+0.5*(photos.length-1))/photos.length;
  for(const slide of slides) args.push('-loop','1','-framerate','30','-t',String(segment),'-i',slide);
  args.push('-filter_complex',graph,'-map','[out]','-t','12','-an','-r','30',
    '-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-color_range','tv','-movflags','+faststart',
    audio?'reel-silent.mp4':'reel.mp4');
  ffmpeg(args,cwd);
  if(audio) {
    try {
      ffmpeg(['-hide_banner','-loglevel','error','-y','-i','reel-silent.mp4','-i',audio.file,
        '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','copy','-t','12','-movflags','+faststart','reel.mp4'],cwd);
      if(probe(path.join(cwd,'reel.mp4')).silent!==false)throw Error('Music mux failed.');
    } catch (_) {
      await fs.copyFile(path.join(cwd,'reel-silent.mp4'),path.join(cwd,'reel.mp4'));
    }
  }
  return path.join(cwd,'reel.mp4');
}

export function verifyReel(file,ffprobe=process.env.FFPROBE_PATH||'ffprobe') {
  const result=spawnSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],
    {encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.status!==0) throw Error('Local video verification failed.');
  const body=JSON.parse(result.stdout),video=body.streams?.find(s=>s.codec_type==='video');
  const audio=body.streams?.find(s=>s.codec_type==='audio');
  if(body.streams.length!==(audio?2:1)||!video||video.codec_name!=='h264'||video.width!==1080||video.height!==1920||
    video.pix_fmt!=='yuv420p'||video.avg_frame_rate!=='30/1'||Math.abs(Number(body.format.duration)-12)>0.1||
    (audio&&(audio.codec_name!=='aac'||Number(audio.sample_rate)!==48000||audio.channels!==2||
      !(Number(audio.bit_rate)>0&&Number(audio.bit_rate)<=160000)))||
    !(Number(body.format.size)<100*1024*1024)||Number(body.format.bit_rate)>25000000) throw Error('Rendered MP4 failed social format acceptance.');
  return {width:video.width,height:video.height,seconds:Number(body.format.duration),silent:!audio,codec:video.codec_name,
    ...(audio?{audioCodec:audio.codec_name,sampleRate:Number(audio.sample_rate),channels:audio.channels}:{})};
}

export async function prepareProduct(productKey,{reels=false,config,fetcher=fetch,contract,ffmpeg=runFFmpeg,probe=verifyReel}={}) {
  contract ||= await loadContract(); config ||= secureConfig(process.env);
  const fields=await readProduct(productKey,config,fetcher);
  if(!contract.socialAirtableEligible_(fields)) throw Error('Active positive Airtable stock/Post to Website required.');
  const source={productKey,photos:contract.socialPhotos_(fields),renderFacts:contract.socialRenderFacts_(fields)};
  const plan=contract.socialMediaPlan_(source,reels);
  const existing=[];
  for(let i=0;i<plan.publicIds.length;i++) existing.push(await lookupAsset(config,plan.resourceType,plan.publicIds[i],plan.hashes[i],fetcher,plan));
  if(existing.every(Boolean)) return {productKey,strategy:plan.type,reused:existing.length,prepared:0};
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-'));
  try {
    const count=plan.type==='Reel'?Math.min(source.photos.length,6):Math.min(source.photos.length,10), files=[];
    for(let i=0;i<count;i++) {
      if(plan.type!=='Reel'&&existing[i]) {files.push('');continue;}
      const file=path.join(cwd,'source-'+i);
      await downloadPhoto(source.photos[i],file,fetcher); files.push(file);
    }
    // Worker only reads Airtable. Authoritative workbook inventory must still be
    // freshly checked by Apps Script at SEND time, not assumed from this preparation.
    const check=async()=>{
      const fresh=await readProduct(productKey,config,fetcher);
      if(!contract.socialAirtableEligible_(fresh)||
        JSON.stringify(contract.socialPhotos_(fresh).map(p=>p.id))!==JSON.stringify(source.photos.map(p=>p.id))||
        JSON.stringify(contract.socialRenderFacts_(fresh))!==JSON.stringify(source.renderFacts)) throw Error('Product/Photos changed during preparation; stop.');
    };
    if(plan.type==='Reel') {
      const file=await renderReel(files,source.renderFacts,cwd,{ffmpeg,musicPlan:plan,probe});
      const verified=probe(file),musicStatus=verified.silent?'silent-fallback':'music';
      await check(); await uploadAsset(config,'video',plan.publicIds[0],plan.hashes[0],file,fetcher,plan,musicStatus);
    } else {
      for(let i=0;i<count;i++) {
        if(existing[i]) continue;
        const file=path.join(cwd,'image-'+i+'.jpg');
        ffmpeg(['-hide_banner','-loglevel','error','-y','-i',files[i],'-vf',
          'scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:white,setsar=1',
          '-frames:v','1','-q:v','3',file],cwd);
        if((await fs.stat(file)).size>8*1024*1024) throw Error('Prepared photo exceeds social limit.');
        await check(); await uploadAsset(config,'image',plan.publicIds[i],plan.hashes[i],file,fetcher);
      }
    }
    return {productKey,strategy:plan.type,reused:existing.filter(Boolean).length,prepared:existing.filter(a=>!a).length};
  } finally {
    // Only the freshly created, resolved worker temp directory; never a workspace.
    if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-social-')) throw Error('Unsafe temp cleanup target.');
    await fs.rm(cwd,{recursive:true,force:true});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const key=process.argv[2];
  try { console.log(JSON.stringify(await prepareProduct(key,{reels:process.argv.includes('--reel')}))); }
  catch (_) { console.error('Media preparation stopped safely. Check secure configuration, current product eligibility and local format tests; no publication performed.');process.exitCode=1; }
}
