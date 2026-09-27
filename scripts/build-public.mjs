import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const publicFiles=['index.html','shop.html','product.html','contact.html','about.html',
  'subscribe-confirmed.html','unsubscribed.html','app.js','inventory.js','styles.css','favicon.ico','robots.txt','sitemap.xml'];
export const stagingSite='d3be279a-c141-4c6d-9dbc-853cda5c22f5';
export function buildPublic({staging=false,siteId=process.env.SITE_ID||'',context=process.env.CONTEXT||''}={}) {
  if(siteId && siteId!==stagingSite && (staging || context==='branch-deploy' || context==='deploy-preview'))throw Error('Production-site preview contexts are unsafe until credentials are hardened.');
  staging=staging||siteId===stagingSite;
  const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  if(sha.status!==0)throw Error('Cannot resolve candidate');
  const output=path.join(root,'dist-public');
  if(path.dirname(output)!==root||path.basename(output)!=='dist-public')throw Error('Unsafe output path');
  fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output);
  for(const file of publicFiles)fs.copyFileSync(path.join(root,file),path.join(output,file));
  // Netlify rewrites HTML links/form markup; retain a verifiable candidate tag.
  for(const file of publicFiles.filter(file=>file.endsWith('.html'))){const target=path.join(output,file);const html=fs.readFileSync(target,'utf8');if(!/<head>/i.test(html))throw Error('Missing page head: '+file);fs.writeFileSync(target,html.replace(/<head>/i,'<head>\n<meta name="invicta-candidate" content="'+sha.stdout.trim()+'">'));}
  function assets(dir,relative='assets'){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw Error('Asset symlink not allowed');
      const name=path.join(relative,entry.name);
      if(entry.isDirectory()){fs.mkdirSync(path.join(output,name),{recursive:true});assets(path.join(dir,entry.name),name);}
      else if(/\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf)$/i.test(entry.name))fs.copyFileSync(path.join(dir,entry.name),path.join(output,name));
      else throw Error('Nonpublic asset type: '+name);
    }
  }
  fs.mkdirSync(path.join(output,'assets'));assets(path.join(root,'assets'));
  if(staging){
    // Versioned marker prevents GA initialization; CSP is defense in depth.
    const app=path.join(output,'app.js');fs.writeFileSync(app,'window.__INVICTA_STAGING__ = true;\n'+fs.readFileSync(app,'utf8'));
    fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
    fs.writeFileSync(path.join(output,'_headers'),"/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'\n");
  }
  const files={},deploymentControls={};function hash(dir,relative=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=path.posix.join(relative,e.name);if(e.isDirectory())hash(path.join(dir,e.name),name);else (name==='_headers'?deploymentControls:files)[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,e.name))).digest('hex');}}
  hash(output);const manifest={candidate:sha.stdout.trim(),staging,files,deploymentControls};fs.writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));
  return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=buildPublic({staging:process.argv.includes('--staging')||process.env.INVICTA_BUILD_CONTEXT==='staging'});
  console.log('Public-only artifact: '+Object.keys(manifest.files).length+' files; staging='+manifest.staging+'; candidate='+manifest.candidate);
}
