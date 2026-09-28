/** Explicit live media acceptance only. No Buffer, Sheet, Netlify or Airtable writes. */
import {secureConfig,loadContract,readProduct,prepareProduct,lookupAsset,airtableBase,airtableTable} from './social-media-worker.mjs';

const key='LEG-HD-000959',config=secureConfig(process.env),contract=await loadContract();
const calls={airtableReads:0,cloudinaryReads:0,imageUploads:0,videoUploads:0},created=[];
let phase='read-only-inventory';
const fetcher=async(url,options={})=>{
  if(url.startsWith('https://api.airtable.com/')) {
    if(options.method&&options.method!=='GET')throw Error('Acceptance forbids Airtable writes.');
    calls.airtableReads++;
  } else if(url.startsWith('https://api.cloudinary.com/')) {
    if(options.method==='POST') {
      const id=options.body.get('public_id');
      if(!/^invicta-social\/(photos-v1|reel-v1)\/[A-Za-z0-9_-]+$/.test(id))throw Error('Unexpected upload identity.');
      const type=url.includes('/video/')?'video':'image';calls[type==='video'?'videoUploads':'imageUploads']++;
      created.push({resourceType:type,publicId:id});
    } else calls.cloudinaryReads++;
  } else if(!url.startsWith('https://')||!/(^|\.)airtableusercontent\.com$/.test(new URL(url).hostname)) {
    throw Error('Unexpected acceptance destination.');
  }
  return fetch(url,options);
};
async function audit() {
  const records=[],cursors=new Set();let cursor='';
  for(let page=0;page<20;page++) {
    const query=new URLSearchParams({pageSize:'100'});if(cursor)query.set('offset',cursor);
    for(const field of ['Product Key','Name','Status','Quantity Available','Post to Website','Photos'])query.append('fields[]',field);
    const response=await fetcher('https://api.airtable.com/v0/'+airtableBase+'/'+airtableTable+'?'+query,
      {headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Airtable acceptance read HTTP '+response.status);
    const body=await response.json();if(!Array.isArray(body.records))throw Error('Incomplete inventory read.');
    for(const {fields} of body.records) {
      const photos=contract.socialPhotos_(fields);
      records.push({productKey:fields['Product Key'],name:fields.Name,status:fields.Status,
        quantity:fields['Quantity Available']??null,postToWebsite:fields['Post to Website']===true,
        eligible:contract.socialAirtableEligible_(fields),photoIds:Array.from(photos,p=>p.id)});
    }
    if(!body.offset)return records;
    if(cursors.has(body.offset))throw Error('Repeated inventory cursor.');cursors.add(body.offset);cursor=body.offset;
  }
  throw Error('Inventory read exceeded safe bound.');
}
try {
  const inventory=await audit(),fields=await readProduct(key,config,fetcher);
  const source={productKey:key,photos:contract.socialPhotos_(fields),renderFacts:contract.socialRenderFacts_(fields)};
  const images=contract.socialMediaPlan_(source,false),reel=contract.socialMediaPlan_(source,true);
  if(images.type!=='Carousel'||reel.type!=='Reel')throw Error('Expected approved real-photo sample unavailable.');
  phase='image-upload';const first=await prepareProduct(key,{config,contract,fetcher});
  phase='image-reuse';const before=calls.imageUploads,second=await prepareProduct(key,{config,contract,fetcher});
  if(second.prepared!==0||second.reused!==images.publicIds.length||calls.imageUploads!==before)throw Error('Image reuse failed.');
  phase='signed-url-rotation-reuse';
  const rotating=async(url,options)=>{
    const response=await fetcher(url,options);
    if(!url.startsWith('https://api.airtable.com/')||!response.ok)return response;
    const body=await response.json();for(const record of body.records||[])for(const photo of record.fields.Photos||[]) {
      photo.url+='&acceptance_rotation_identity_only=1';
    }
    return Response.json(body);
  };
  const rotated=await prepareProduct(key,{config,contract,fetcher:rotating});
  if(rotated.prepared!==0||calls.imageUploads!==before)throw Error('Signed URL caused duplicate upload.');
  phase='real-reel-render-upload';const videoFirst=await prepareProduct(key,{reels:true,config,contract,fetcher});
  phase='reel-reuse';const videoCount=calls.videoUploads,videoSecond=await prepareProduct(key,{reels:true,config,contract,fetcher});
  if(videoSecond.prepared!==0||videoSecond.reused!==1||calls.videoUploads!==videoCount)throw Error('Reel reuse failed.');
  phase='durable-delivery-check';const assets=[];
  for(const plan of [images,reel])for(let i=0;i<plan.publicIds.length;i++) {
    const a=await lookupAsset(config,plan.resourceType,plan.publicIds[i],plan.hashes[i],fetcher);
    const url='https://res.cloudinary.com/'+config.cloud+'/'+a.resource_type+'/upload/v'+a.version+'/'+a.public_id+'.'+a.format;
    const r=await fetch(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('Durable delivery unavailable.');
    assets.push({resourceType:a.resource_type,publicId:a.public_id,version:a.version,url,reachable:true,
      width:a.width,height:a.height,bytes:a.bytes,seconds:a.duration??null,codec:a.video?.codec??null,
      silent:a.resource_type==='video'?!a.audio||Object.keys(a.audio).length===0:null,sourceHash:plan.hashes[i]});
  }
  console.log('SOCIAL_ACCEPTANCE_REPORT '+JSON.stringify({status:'PASS',productKey:key,inventory,
    orderedPhotoIds:images.photoIds,renderFacts:source.renderFacts,renderFingerprint:reel.renderHash,
    images:{first,second,rotated},video:{first:videoFirst,second:videoSecond},calls,created,assets,publicPosts:0}));
} catch(error) {
  // Never output response bodies, signed URLs, environment values or raw stack.
  console.error('SOCIAL_ACCEPTANCE_REPORT '+JSON.stringify({status:'FAIL',phase,calls,
    reason:/HTTP \d{3}/.exec(String(error.message))?.[0]||'Acceptance stopped; inspect guarded code/input contract.',assetFacts:error.assetFacts??null,created,publicPosts:0}));
  process.exitCode=1;
}
