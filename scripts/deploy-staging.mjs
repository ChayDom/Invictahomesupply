import {spawnSync} from 'node:child_process';
import {root,stagingSite} from './build-public.mjs';
export function assertStagingEnvironment(env){
  const allowed=['AIRTABLE_TOKEN','AIRTABLE_BASE_ID','AIRTABLE_TABLE_NAME','WEEKLY_DIGEST_ENABLED'];
  if(env.AIRTABLE_BASE_ID!=='appLzUBCXBMzrgVx1'||env.AIRTABLE_TABLE_NAME!=='Website Products'||!env.AIRTABLE_TOKEN||env.WEEKLY_DIGEST_ENABLED!=='false'||Object.keys(env).some(k=>!allowed.includes(k)))throw Error('Staging environment isolation failed; values withheld.');
}
export async function deployStaging(cli){
  if(!cli)throw Error('Set NETLIFY_CLI_PATH to the authenticated Netlify CLI run.js');
  function run(args){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:{...process.env,SITE_ID:stagingSite,INVICTA_BUILD_CONTEXT:'staging'}});if(r.status)throw Error('Netlify '+args[0]+' failed; raw output withheld');return r.stdout;}
  const dirty=spawnSync('git',['diff','--quiet','HEAD'],{cwd:root});if(dirty.status!==0)throw Error('Commit reviewed tracked changes before deploying');
  const unknown=spawnSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'});
  if(unknown.status||unknown.stdout.trim().split('\n').some(file=>file&&file!=='codex-appscript-refactor.patch'))throw Error('Untracked files outside the preserved patch must be reviewed/committed');
  if(Object.keys(process.env).some(k=>/RESEND|BUFFER|SUBSCRIBER/.test(k)&&process.env[k]))throw Error('Local provider write credentials must not enter staging build');
  const site=JSON.parse(run(['api','getSite','--data',JSON.stringify({site_id:stagingSite})]));
  if(site.id!==stagingSite||site.name!=='invicta-home-supply-staging'||site.custom_domain||site.domain_aliases?.length)throw Error('Unexpected staging site/domain');
  for(const context of ['production','branch-deploy','deploy-preview'])assertStagingEnvironment(JSON.parse(run(['env:list','--json','--context',context,'--scope','functions','--site',stagingSite])));
  const sha=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
  const result=JSON.parse(run(['deploy','--build','--context','branch-deploy','--site',stagingSite,'--alias','preproduction-'+sha.slice(0,7),'--json']));
  const url='https://preproduction-'+sha.slice(0,7)+'--invicta-home-supply-staging.netlify.app';
  const manifest=await fetch(new URL('/release-manifest.json',url)).then(r=>{if(!r.ok)throw Error('Missing deployed manifest');return r.json();});
  if(manifest.candidate!==sha||manifest.staging!==true)throw Error('Deployed candidate mismatch');
  console.log(JSON.stringify({candidate:sha,site:stagingSite,url,deployId:result.deploy_id||result.id},null,2));return {...result,url};
}
if(process.argv[1]?.endsWith('deploy-staging.mjs'))await deployStaging(process.env.NETLIFY_CLI_PATH);
