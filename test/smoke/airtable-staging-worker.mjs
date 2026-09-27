// Synchronous Apps Script transport adapter's child. Secrets travel via stdin,
// never command arguments/files. All writes are constrained to this staging
// base/table AND the caller's newly created synthetic acquisition keys.
import fs from 'node:fs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const url=new URL(input.url),base='https://api.airtable.com/v0/appLzUBCXBMzrgVx1/Website%20Products';
if(url.origin!=='https://api.airtable.com'||!url.pathname.startsWith('/v0/appLzUBCXBMzrgVx1/Website%20Products'))throw Error('Staging isolation guard');
const allowed=new Set(input.allowedKeys);
const read=async id=>{const r=await fetch(base+'/'+encodeURIComponent(id),{headers:input.options.headers});if(!r.ok)throw Error('Identity verification failed');return r.json();};
const assertOwned=async id=>{const r=await read(id);if(!allowed.has(r.fields['Product Key']))throw Error('Record outside synthetic acceptance scope');};
if(input.options.method==='delete') {
  const ids=url.searchParams.getAll('records[]');if(!ids.length)throw Error('Missing exact deletion targets');
  for(const id of ids)await assertOwned(id);
} else if(!['get','GET'].includes(input.options.method)) {
  const payload=JSON.parse(input.options.payload);
  for(const record of payload.records) {
    if(record.id)await assertOwned(record.id);
    else if(!allowed.has(record.fields['Product Key']))throw Error('Upsert outside synthetic acceptance scope');
  }
}
const r=await fetch(input.url,{method:input.options.method.toUpperCase(),headers:{...input.options.headers,'Content-Type':'application/json'},body:input.options.payload});
console.log(JSON.stringify({code:r.status,body:await r.text(),headers:Object.fromEntries(r.headers)}));
