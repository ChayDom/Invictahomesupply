import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadContract,secureConfig,readProduct,photoDownloadUrl,downloadPhoto,uploadSignature,
  verifyAsset,lookupAsset,uploadAsset,wrapText,reelGraph,renderReel,prepareProduct} from '../scripts/social-media-worker.mjs';
let pass=0,fail=0;
async function test(name,fn){try{await fn();pass++;console.log('ok - '+name);}catch(error){fail++;console.log('NOT OK - '+name);console.error(error);}}
const contract=await loadContract(),config={token:'test-only',cloud:'test-cloud',key:'test-key',secret:'test-secret'};
const key='SYNTH-WORKER',fields={'Product Key':key,Name:'Synthetic flooring',Price:1.5,Category:'Flooring',
  'Unit Type':'Box','Post to Website':true,Status:'In Stock','Quantity Available':10,
  'Card Spec 1':'20 MIL',Photos:Array.from({length:4},(_,i)=>({id:'attPhoto'+i,
    url:'https://v5.airtableusercontent.com/photo'+i,type:'image/jpeg',width:1200,height:1600}))};
const source=()=>({productKey:key,photos:contract.socialPhotos_(fields),renderFacts:contract.socialRenderFacts_(fields)});
const asset=(id,hash,type='image')=>({public_id:id,resource_type:type,type:'upload',version:1,
  format:type==='video'?'mp4':'jpg',width:1080,height:type==='video'?1920:1350,bytes:500000,
  context:{custom:{source_hash:hash}},...(type==='video'?{duration:12,video:{codec:'h264'}}:{})});

await test('secure config errors expose names, never values',()=>{
  assert.throws(()=>secureConfig({CLOUDINARY_API_SECRET:'do-not-print'}),/AIRTABLE_SOCIAL_READ_TOKEN/);
  assert.doesNotMatch(String(assert.throws),/do-not-print/);
});
await test('approved stable source IDs ignore rotating signed URLs in video fingerprint',()=>{
  const a=contract.socialMediaPlan_(source(),true);fields.Photos[0].url+='?rotated=yes';
  const b=contract.socialMediaPlan_(source(),true);assert.equal(a.renderHash,b.renderHash);
});
await test('changed price/spec/template inputs create new render identity',()=>{
  const a=contract.socialMediaPlan_(source(),true);fields.Price=2;
  assert.notEqual(a.renderHash,contract.socialMediaPlan_(source(),true).renderHash);fields.Price=1.5;
  fields['Card Spec 1']='12 MIL';assert.notEqual(a.renderHash,contract.socialMediaPlan_(source(),true).renderHash);fields['Card Spec 1']='20 MIL';
});
await test('reordered Photos create new render identity',()=>{
  const a=contract.socialMediaPlan_(source(),true);fields.Photos.reverse();
  assert.notEqual(a.renderHash,contract.socialMediaPlan_(source(),true).renderHash);fields.Photos.reverse();
});
await test('image public identity excludes text and URL, avoiding duplicate unchanged-photo uploads',()=>{
  const a=contract.socialMediaPlan_(source(),false);fields.Price=9;
  assert.deepEqual(Array.from(a.publicIds),Array.from(contract.socialMediaPlan_(source(),false).publicIds));fields.Price=1.5;
});
await test('readProduct is GET-only, scoped to exact permanent key/explicit production table',async()=>{
  const result=await readProduct(key,config,async(url,options)=>{
    assert.match(url,/apptugvm4r5tm2OIt\/tblUyA3uFL6FmMw6T/);
    assert.equal(options.method,undefined);assert.equal(options.redirect,'error');
    assert.match(new URL(url).searchParams.get('filterByFormula'),/Product Key/);
    return Response.json({records:[{fields}]});
  });assert.equal(result.Name,fields.Name);
});
await test('duplicate/missing keys and incomplete Airtable page fail closed',async()=>{
  for(const body of [{records:[]},{records:[{fields},{fields}]},{records:[{fields}],offset:'more'}]) {
    await assert.rejects(readProduct(key,config,async()=>Response.json(body)),/identity/);
  }
});
await test('photo download allowlist blocks arbitrary hosts, http, userinfo and deceptive suffixes',()=>{
  for(const url of ['http://v5.airtableusercontent.com/x','https://airtableusercontent.com.evil.test/x',
    'https://user:password@v5.airtableusercontent.com/x','https://example.com/x','file:///secret']) assert.throws(()=>photoDownloadUrl(url));
  assert.match(photoDownloadUrl(fields.Photos[0].url),/^https:\/\/v5.airtableusercontent.com\//);
});
await test('download rejects oversized/non-image/empty data and never follows redirects',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-test-'));
  try {
    for(const response of [new Response('not image',{headers:{'content-type':'text/plain'}}),
      new Response('x',{headers:{'content-type':'image/jpeg','content-length':String(60*1024*1024)}}),
      new Response('',{headers:{'content-type':'image/jpeg'}})]) {
      await assert.rejects(downloadPhoto(fields.Photos[0],path.join(dir,'photo'),async(_,o)=>{
        assert.equal(o.redirect,'error');return response;
      }));
    }
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('SHA256 signature deterministic with sorted parameters; secret is not returned',()=>{
  const a=uploadSignature({timestamp:'123',overwrite:'false'},'secret');
  assert.equal(a,uploadSignature({overwrite:'false',timestamp:'123'},'secret'));assert.match(a,/^[0-9a-f]{64}$/);
});
await test('Airtable binary delivery requires actual matching JPEG bytes, not just a MIME claim',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-test-'));
  try {
    const target=path.join(dir,'photo');
    await downloadPhoto(fields.Photos[0],target,async()=>new Response(Buffer.from([255,216,255,0]),
      {headers:{'content-type':'binary/octet-stream'}}));
    assert.equal((await fs.stat(target)).size,4);
    for(const bytes of [Buffer.from('not-image'),Buffer.from([137,80,78,71,13,10,26,10])]) {
      await assert.rejects(downloadPhoto(fields.Photos[0],target,async()=>new Response(bytes,
        {headers:{'content-type':'application/octet-stream'}})),/bytes/);
    }
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('asset validation rejects hash/type/identity/format/size drift',()=>{
  const a=asset('id','hash');
  for(const patch of [{public_id:'wrong'},{format:'png'},{bytes:9*1024*1024},{width:100},
    {context:{custom:{source_hash:'different'}}},{version:0}]) assert.throws(()=>verifyAsset({...a,...patch},'image','id','hash'));
});
await test('Reel verification requires 12 seconds H264 1080x1920 silent MP4',()=>{
  const a=asset('id','hash','video');verifyAsset(a,'video','id','hash');
  for(const patch of [{duration:30},{video:{codec:'hevc'}},{audio:{codec:'aac'}},{height:1080}]) {
    assert.throws(()=>verifyAsset({...a,...patch},'video','id','hash'));
  }
});
await test('real Admin flattened video metadata validates H264 and rejects audio/codec contradictions',()=>{
  const a={...asset('id','hash','video'),video:undefined,codec:'h264',pix_format:'yuv420p',frame_rate:30};
  verifyAsset(a,'video','id','hash');
  for(const patch of [{codec:'hevc'},{audio_codec:'aac'},{audio_bit_rate:1000},{audio_frequency:44100},
    {channels:2},{has_audio:true},{video:{codec:'hevc'}}])assert.throws(()=>verifyAsset({...a,...patch},'video','id','hash'));
});
await test('Cloudinary lookup distinguishes missing asset from authentication/server failures',async()=>{
  assert.equal(await lookupAsset(config,'image','id','hash',async()=>new Response('',{status:404})),null);
  await assert.rejects(lookupAsset(config,'image','id','hash',async()=>new Response('secret-body',{status:401})),/HTTP 401/);
});
await test('Cloudinary video lookup explicitly requests codec/audio metadata; missing codec fails closed',async()=>{
  await lookupAsset(config,'video','id','hash',async url=>{
    assert.equal(new URL(url).searchParams.get('media_metadata'),'true');
    return Response.json(asset('id','hash','video'));
  });
  await assert.rejects(lookupAsset(config,'video','id','hash',async()=>Response.json({
    ...asset('id','hash','video'),video:undefined
  })),/identity\/format/);
});
await test('upload is signed, immutable overwrite=false, no eager paid transformations',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-test-'));const file=path.join(dir,'image.jpg');
  try {
    await fs.writeFile(file,'synthetic');
    let calls=0;
    await uploadAsset(config,'image','id','hash',file,async(url,options)=>{
      calls++;
      if(options.method==='POST') {
        assert.equal(options.body.get('overwrite'),'false');assert.equal(options.body.get('public_id'),'id');
        assert.equal(options.body.get('eager'),null);assert.equal(options.body.get('transformation'),null);
        assert.equal(options.body.get('context'),'source_hash=hash');assert.match(options.body.get('signature'),/^[0-9a-f]{64}$/);
        return Response.json({public_id:'id'});
      }
      return Response.json(asset('id','hash'));
    });assert.equal(calls,2);
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('unchanged prepared Reel reuses Cloudinary without downloading, rendering or upload',async()=>{
  const plan=contract.socialMediaPlan_(source(),true);let uploads=0;
  const result=await prepareProduct(key,{reels:true,config,contract,
    ffmpeg:()=>{throw Error('Render forbidden on cache hit');},
    fetcher:async(url,options)=>{
      assert.notEqual(options.method,'POST');uploads+=Number(options.method==='POST');
      if(url.startsWith('https://api.airtable.com'))return Response.json({records:[{fields}]});
      assert.ok(url.startsWith('https://api.cloudinary.com'));
      return Response.json(asset(plan.publicIds[0],plan.hashes[0],'video'));
    }});
  assert.equal(result.reused,1);assert.equal(result.prepared,0);assert.equal(uploads,0);
});
await test('zero/uncertain stock fails preparation before Cloudinary/network download',async()=>{
  for(const quantity of [0,null,'',-1]) {
    let calls=0;
    await assert.rejects(prepareProduct(key,{config,contract,fetcher:async()=>{
      calls++;return Response.json({records:[{fields:{...fields,'Quantity Available':quantity}}]});
    }}),/positive/);assert.equal(calls,1);
  }
});
await test('worker cannot use Reference Image URL when Photos missing',async()=>{
  await assert.rejects(prepareProduct(key,{config,contract,fetcher:async()=>Response.json({records:[{
    fields:{...fields,Photos:[], 'Reference Image URL':'https://example.com/reference'}
  }]})}),/Photos/);
});
await test('template clamps malicious/unbounded text and treats percent as literal',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-test-'));let args;
  try {
    const font=path.join(dir,'input-font');await fs.writeFile(font,'test font placeholder');
    await renderReel(['a','b','c','d'],{name:"100% oak: ' [evil]\n"+'word '.repeat(100),
      price:'$1.50',specs:['20 MIL'],brand:'Invicta Home Supply',cta:'McKinney, TX'},dir,{font,ffmpeg:a=>{args=a;}});
    assert.ok(args.includes('-an'));assert.ok(args.includes('12'));assert.ok(args.includes('libx264'));
    const graph=await fs.readFile(path.join(dir,'reel-filter.txt'),'utf8');assert.match(graph,/expansion=none/);
    assert.equal(graph.includes('[evil]'),false);assert.ok((await fs.readFile(path.join(dir,'name.txt'),'utf8')).split('\n').length<=3);
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('one deterministic reusable template supports 4/5/6 photos and crossfades',()=>{
  for(const n of [4,5,6]){const graph=reelGraph(n);assert.equal((graph.match(/xfade=/g)||[]).length,n-1);
    assert.match(graph,/zoompan/);assert.match(graph,/1080x1920/);}
  assert.throws(()=>reelGraph(3));assert.equal(wrapText('word '.repeat(100),20,2).split('\n').length,2);
});
await test('large originals are resized once and looped inputs have bounded duration/limited-range output',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-social-test-')),calls=[];
  try {
    const font=path.join(dir,'input-font');await fs.writeFile(font,'test font placeholder');
    await renderReel(['source-a','source-b','source-c','source-d'],{name:'Name',price:'$1.50',
      specs:[],brand:'Invicta',cta:'McKinney'},dir,{font,ffmpeg:args=>calls.push(args)});
    assert.equal(calls.length,5);
    for(const args of calls.slice(0,4)){assert.equal(args.includes('-loop'),false);assert.ok(args.includes('-frames:v'));}
    const last=calls[4];assert.equal(last.filter(a=>a==='-loop').length,4);
    assert.equal(last.filter(a=>a==='-t').length,5);assert.equal(last.includes('source-a'),false);
    assert.match(last[last.indexOf('-filter_complex')+1],/out_range=tv,format=yuv420p/);
    assert.equal(last[last.indexOf('-color_range')+1],'tv');
  } finally {await fs.rm(dir,{recursive:true});}
});
await test('manual workflow never schedules, publishes or uses paid runner/Netlify/Buffer secret',async()=>{
  const yaml=await fs.readFile(new URL('../.github/workflows/social-media-prepare.yml',import.meta.url),'utf8');
  assert.match(yaml,/workflow_dispatch/);assert.doesNotMatch(yaml,/schedule:|BUFFER_API_KEY|NETLIFY_AUTH_TOKEN|self-hosted/);
  assert.match(yaml,/ubuntu-24.04/);assert.match(yaml,/contents: read/);assert.match(yaml,/environment: social-media/);
});
console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
