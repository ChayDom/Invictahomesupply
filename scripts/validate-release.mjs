import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
import {transformSync} from 'esbuild';import {root} from './build-public.mjs';
const output=process.env.VALIDATION_OUTPUT||path.join(root,'.netlify/remediation-validation');fs.mkdirSync(output,{recursive:true});
const report={commands:[],static:{syntax:0,json:0,inline:0,errors:[]}};
const tracked=spawnSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'});
if(tracked.status)throw Error('Cannot list source files');
let scripts=[];
for(const file of new Set(tracked.stdout.trim().split('\n'))){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 try{
  if(file.endsWith('.json')){JSON.parse(source);report.static.json++;}
  if(/\.(js|mjs|mts|ts|css)$/.test(file)){
   if(file.startsWith('Invicta Appscript Files/')){new vm.Script(source);scripts.push(source);}
   else transformSync(source,{loader:file.endsWith('.css')?'css':/\.(mts|ts)$/.test(file)?'ts':'js',logLevel:'silent'});
   report.static.syntax++;
  }
  if(file.endsWith('.html'))for(const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=|application\/ld\+json|application\/json/.test(m[1]))continue;new vm.Script(m[2]);report.static.inline++;
  }
 }catch(e){report.static.errors.push({file,error:e.message});}
}
try{new vm.Script(scripts.join('\n'));report.static.sharedAppsScript='PASS';}catch(e){report.static.errors.push({file:'Apps Script namespace',error:e.message});}
function run(name,command,args){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});const log=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(output,name+'.log'),log);report.commands.push({name,status:r.status===0?'PASS':'FAIL',exitCode:r.status,summary:log.trim().split('\n').slice(-5)});console.log(name+': '+report.commands.at(-1).status);}
run('unit',process.execPath,['test/run-unit-tests.mjs']);run('workbook',process.execPath,['test/appscript-workbook.test.mjs']);run('lifecycle',process.execPath,['test/appscript-lifecycle.test.mjs']);run('remediation',process.execPath,['test/appscript-remediation.test.mjs']);
run('diff-check','git',['diff','--check']);
if(process.argv.includes('--e2e'))run('e2e',process.execPath,['node_modules/@playwright/test/cli.js','test','--project=chromium','--project=webkit','--workers=4']);
fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.static));
if(report.static.errors.length||report.commands.some(c=>c.status==='FAIL'))process.exit(1);
