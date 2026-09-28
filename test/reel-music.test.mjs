import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadContract,verifyAsset,renderReel,prepareProduct,uploadAsset} from '../scripts/social-media-worker.mjs';
import {loadMusic,musicDirectory,musicVersion,prepareMusicAudio,validateAudio,musicCredit,backgroundAudioFilter} from '../scripts/social-music.mjs';
import {createRuntime,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let pass=0,fail=0;
async function test(name,fn){try{await fn();pass++;console.log('ok - '+name);}catch(e){fail++;console.log('NOT OK - '+name);console.error(e);}}
const contract=await loadContract();
const source={productKey:'SYNTH-MUSIC',photos:Array.from({length:4},(_,i)=>({id:'attPhoto'+i})),
  renderFacts:{name:'Synthetic oak',price:'$1.50 / sq ft',specs:['20 MIL'],brand:'Invicta',cta:'McKinney'}};
const plan=contract.socialMediaPlan_(source,true);
const audioBody=(codec='aac',duration=12)=>({streams:[{codec_type:'audio',codec_name:codec,sample_rate:'48000',channels:2}],
  format:{duration:String(duration),size:'180000'}});
const videoAsset=(status='music')=>({public_id:plan.publicIds[0],resource_type:'video',type:'upload',version:1,
  format:'mp4',width:1080,height:1920,bytes:1000000,duration:12,video:{codec:'h264'},
  context:{custom:{source_hash:plan.hashes[0],music_track_id:plan.musicTrackId,
    music_library_version:plan.musicLibraryVersion,music_status:status}},
  ...(status==='music'?{audio:{codec:'aac'},audio_frequency:48000,channels:2}:{})});

await test('all ten controlled tracks have commercial CC BY 4.0 evidence, no vocals and pinned bytes',async()=>{
  const lib=JSON.parse(await fs.readFile(path.join(musicDirectory,'library.json'),'utf8'));
  assert.equal(lib.version,musicVersion);assert.equal(lib.tracks.length,10);
  for(let i=0;i<10;i++){
    const t=lib.tracks[i];assert.equal(t.id,'music-'+String(i+1).padStart(2,'0'));
    assert.equal(t.license,'CC BY 4.0');assert.equal(t.commercialUse,true);assert.equal(t.attributionRequired,true);
    assert.equal(t.instrumental,true);assert.doesNotMatch(t.instruments,/vocal|voice|choir|sing/i);
    assert.match(t.sourceUrl,/^https:\/\/incompetech.com\/music\/royalty-free\/index.html\?isrc=USUAN/);
    assert.equal(t.sha256,crypto.createHash('sha256').update(await fs.readFile(path.join(musicDirectory,t.file))).digest('hex'));
    await loadMusic(t.id,musicVersion,{probe:()=>audioBody('mp3',30)});
  }
});
await test('track rotation deterministic from permanent key/template; all ten buckets reachable',()=>{
  assert.match(plan.musicTrackId,/^music-(0[1-9]|10)$/);
  assert.equal(contract.socialMediaPlan_(source,true).musicTrackId,plan.musicTrackId);
  const found=new Set(Array.from({length:500},(_,i)=>contract.socialMusicTrackId_('SYNTH-'+i,plan.templateVersion)));
  assert.equal(found.size,10);
  source.photos[0].url='https://v5.airtableusercontent.com/rotating';
  assert.equal(contract.socialMediaPlan_(source,true).renderHash,plan.renderHash);
});
await test('music track, template and library changes each version the Reel fingerprint',()=>{
  const hash=(track=plan.musicTrackId,template=plan.templateVersion,library=musicVersion)=>
    contract.socialReelFingerprint_(source,source.photos.map(p=>p.id),template,track,library);
  assert.equal(hash(),plan.renderHash);
  assert.notEqual(hash(plan.musicTrackId==='music-01'?'music-02':'music-01'),plan.renderHash);
  assert.notEqual(hash(plan.musicTrackId,'reel-v3'),plan.renderHash);
  assert.notEqual(hash(plan.musicTrackId,plan.templateVersion,'music-library-v2'),plan.renderHash);
});
await test('image/carousel identity remains the original PR19 identity',()=>{
  const image=contract.socialMediaPlan_(source,false);
  assert.equal(image.musicTrackId,undefined);
  const old=contract.socialOperationKey_([source.productKey,source.photos.map(p=>p.id),'reel-v1',source.renderFacts,
    {width:1080,height:1920,seconds:12,silent:true}]);
  assert.equal(image.renderHash,old);
});
await test('unavailable/corrupt/unlicensed/path-traversal music is rejected by loader',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-music-test-'));
  try {
    const lib=JSON.parse(await fs.readFile(path.join(musicDirectory,'library.json'),'utf8'));
    await fs.writeFile(path.join(dir,'library.json'),JSON.stringify(lib));
    await assert.rejects(loadMusic('music-01',musicVersion,{directory:dir}));
    await fs.writeFile(path.join(dir,'music-01.mp3'),'corrupt audio');
    await assert.rejects(loadMusic('music-01',musicVersion,{directory:dir}),/checksum/);
    await assert.rejects(loadMusic('../music-01',musicVersion,{directory:dir}),/identity/);
    await assert.rejects(loadMusic('music-11',musicVersion,{directory:dir}),/identity/);
    await assert.rejects(loadMusic('music-01','different'),/identity/);
    lib.tracks[0].commercialUse=false;await fs.writeFile(path.join(dir,'library.json'),JSON.stringify(lib));
    await assert.rejects(loadMusic('music-01',musicVersion,{directory:dir}),/license/);
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('audio must be standard MP3 library / AAC render, 48k stereo and correct duration',()=>{
  validateAudio(audioBody(),{codec:'aac',duration:12});
  for(const bad of [audioBody('opus'),audioBody('aac',10),{...audioBody(),streams:[]},
    {...audioBody(),streams:[{...audioBody().streams[0],channels:6}]},
    {...audioBody(),streams:[{...audioBody().streams[0],sample_rate:'22050'}]}])
    assert.throws(()=>validateAudio(bad,{codec:'aac',duration:12}));
});
await test('trim/loop, normalization, conservative gain, fades and standard AAC are wired',async()=>{
  const calls=[],track={title:'Carefree',contributors:[],file:'/controlled/music-01.mp3'};
  const result=await prepareMusicAudio(plan,os.tmpdir(),{loader:async()=>track,probe:()=>audioBody(),ffmpeg:a=>calls.push(a)});
  assert.ok(result);assert.equal(calls.length,2);assert.ok(calls[0].includes('-xerror'));
  const args=calls[1];assert.equal(args[args.indexOf('-stream_loop')+1],'-1');
  assert.equal(args[args.indexOf('-t')+1],'12');assert.equal(args[args.indexOf('-c:a')+1],'aac');
  assert.equal(args[args.indexOf('-ar')+1],'48000');assert.equal(args[args.indexOf('-ac')+1],'2');
  assert.equal(args[args.indexOf('-af')+1],backgroundAudioFilter);
  for(const text of ['atrim=duration=12','loudnorm=I=-23','volume=0.5','afade=t=in','afade=t=out'])assert.ok(backgroundAudioFilter.includes(text));
  assert.match(result.credit,/Kevin MacLeod/);assert.match(result.credit,/https:\/\/creativecommons.org\/licenses\/by\/4.0\//);
});
await test('missing, corrupt, failed decode/encode/verification all fall back without throwing',async()=>{
  const good=async()=>({title:'Carefree',contributors:[],file:'music.mp3'});
  for(const options of [{loader:async()=>{throw Error('missing');}},
    {loader:good,ffmpeg:()=>{throw Error('decode');}},
    {loader:good,ffmpeg:()=>{},probe:()=>audioBody('opus')},
    {loader:good,ffmpeg:()=>{},probe:()=>{throw Error('bad');}}]){
    assert.equal(await prepareMusicAudio(plan,os.tmpdir(),options),null);
  }
});
await test('Daily Beetle credit includes named guest guitarist and change notice',()=>{
  const credit=musicCredit({title:'Daily Beetle',contributors:['Brett Van Donsel (guitar)']});
  assert.match(credit,/Brett Van Donsel/);assert.match(credit,/Excerpt, looped, normalized and faded/);
});
await test('worker and sender accept AAC only with matching track/library/status; legacy stays silent',()=>{
  for(const status of ['music','silent-fallback']){
    const asset=videoAsset(status);
    verifyAsset(asset,'video',plan.publicIds[0],plan.hashes[0],plan);
    assert.equal(contract.socialVideoAudioAllowed_(asset,plan),true);
  }
  const bads=[a=>a.context.custom.music_track_id='music-99',a=>a.context.custom.music_library_version='wrong',
    a=>a.context.custom.music_status='unknown',a=>a.audio.codec='opus',
    a=>a.audio_codec='opus',a=>a.has_audio=false,a=>a.context.custom.music_status='silent-fallback',a=>delete a.context.custom.music_track_id];
  for(const mutate of bads){const a=videoAsset();mutate(a);
    assert.throws(()=>verifyAsset(a,'video',plan.publicIds[0],plan.hashes[0],plan));}
  assert.throws(()=>verifyAsset(videoAsset(),'video',plan.publicIds[0],plan.hashes[0]));
});
await test('actual Apps Script resolver validates AAC music and pins immutable delivery version',()=>{
  const t=createRuntime();Object.assign(t.properties,{CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test',CLOUDINARY_API_SECRET:'test'});
  t.ctx.Utilities.base64Encode=x=>Buffer.from(x).toString('base64');
  let value=videoAsset();t.ctx.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(value)})};
  assert.equal(plain(t.ctx.socialResolveCloudinary_(plan).urls)[0],
    'https://res.cloudinary.com/test-cloud/video/upload/v1/'+plan.publicIds[0]+'.mp4');
  value.audio.codec='opus';assert.throws(()=>t.ctx.socialResolveCloudinary_(plan),/fingerprint/);
});
await test('immutable music and silent-fallback assets reuse without rendering/uploading',async()=>{
  const fields={'Product Key':source.productKey,Name:'Synthetic oak',Category:'Flooring',Price:1.5,'Price Basis':'Per Sq Ft',
    'Post to Website':true,Status:'In Stock','Quantity Available':10,Photos:source.photos.map(p=>({...p,type:'image/jpeg',width:1080,height:1920,
      url:'https://v5.airtableusercontent.com/'+p.id}))};
  const actual=contract.socialMediaPlan_({productKey:source.productKey,photos:contract.socialPhotos_(fields),renderFacts:contract.socialRenderFacts_(fields)},true);
  for(const status of ['music','silent-fallback']){
    let creates=0;const cached=videoAsset(status);cached.public_id=actual.publicIds[0];cached.context.custom.source_hash=actual.hashes[0];
    const result=await prepareProduct(source.productKey,{reels:true,contract,config:{cloud:'test',key:'test',secret:'test',token:'test'},
      ffmpeg:()=>{throw Error('Must not render');},fetcher:async(url,opts)=>{
        creates+=Number(opts.method==='POST');
        return Response.json(url.startsWith('https://api.airtable.com')?{records:[{fields}]}:cached);
      }});
    assert.equal(result.reused,1);assert.equal(result.prepared,0);assert.equal(creates,0);
  }
});
await test('upload persists music identity/status without overwriting an existing asset',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-music-test-'));
  try {
    const file=path.join(dir,'test.mp4');await fs.writeFile(file,'synthetic');
    await uploadAsset({cloud:'test',key:'test',secret:'test'},'video',plan.publicIds[0],plan.hashes[0],file,async(_,o)=>{
      if(o.method==='POST'){
        const c=o.body.get('context');assert.ok(c.includes('music_track_id='+plan.musicTrackId));
        assert.ok(c.includes('music_status=music'));assert.equal(o.body.get('overwrite'),'false');return Response.json({});
      }
      return Response.json(videoAsset());
    },plan,'music');
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('render wires visible credit and AAC mux; mux failure still returns a silent MP4',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-music-test-'));
  try {
    const font=path.join(dir,'font-input');await fs.writeFile(font,'font');
    await fs.writeFile(path.join(dir,'reel-silent.mp4'),'synthetic silent video');
    for(const failMux of [false,true]){
      const calls=[];
      const file=await renderReel(['a','b','c','d'],source.renderFacts,dir,{font,musicPlan:plan,
        music:async()=>({file:'music.m4a',credit:'License attribution'}),probe:()=>({silent:false}),ffmpeg:args=>{
          calls.push(args);const output=args.at(-1);
          if(output==='reel.mp4'&&failMux)throw Error('Mux failed');
        }});
      assert.equal(file,path.join(dir,'reel.mp4'));
      assert.match(await fs.readFile(path.join(dir,'reel-filter.txt'),'utf8'),/music-credit.txt/);
      assert.equal(await fs.readFile(path.join(dir,'music-credit.txt'),'utf8'),'License attribution');
      assert.ok(calls.at(-1).includes('-c:a'));assert.equal(calls.at(-1)[calls.at(-1).indexOf('-c:v')+1],'copy');
    }
  } finally {await fs.rm(dir,{recursive:true});}
});
console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
