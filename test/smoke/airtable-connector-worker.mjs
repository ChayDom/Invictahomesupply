// Optional transport when Netlify Secrets Controller cannot expose a PAT.
// A tool orchestrator fulfills requests using the authorized Airtable connector.
// This queue carries synthetic data only; NEVER stores Authorization headers.
import fs from 'node:fs';
import path from 'node:path';
const input=JSON.parse(fs.readFileSync(0,'utf8')),url=new URL(input.url);
if(url.origin!=='https://api.airtable.com'||!url.pathname.startsWith('/v0/appLzUBCXBMzrgVx1/Website%20Products'))throw Error('Staging isolation guard');
const dir=process.env.LIFECYCLE_RPC_DIR;if(!dir)throw Error('Connector queue directory required');
fs.mkdirSync(dir,{recursive:true});
const request={id:Date.now()+'-'+process.pid,url:input.url,method:input.options.method,
  payload:input.options.payload?JSON.parse(input.options.payload):null,allowedKeys:input.allowedKeys};
const response=path.join(dir,request.id+'.json');
fs.writeFileSync(path.join(dir,'request.json'),JSON.stringify(request));
const deadline=Date.now()+55000;
while(!fs.existsSync(response)){
 if(Date.now()>deadline)throw Error('Connector queue timed out');
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
}
console.log(fs.readFileSync(response,'utf8'));
