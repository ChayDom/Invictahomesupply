/** Offline real-codec acceptance. No credentials, network, uploads or publishing. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {loadContract,renderReel,verifyReel,runFFmpeg} from '../scripts/social-media-worker.mjs';
import {loadMusic,musicVersion,prepareMusicAudio} from '../scripts/social-music.mjs';
const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-music-codec-'));
const photoIndex=process.argv.indexOf('--photos-dir'),input=photoIndex<0?null:process.argv[photoIndex+1];
const facts={name:'Flooring music acceptance',price:'$1.50 / sq ft',specs:['20 MIL','Waterproof'],
  brand:'Invicta Home Supply',cta:'McKinney, TX | invictahomesupply.com'};
try {
  for(let i=1;i<=10;i++){
    const id='music-'+String(i).padStart(2,'0');await loadMusic(id,musicVersion);
    const audio=await prepareMusicAudio({musicTrackId:id,musicLibraryVersion:musicVersion},cwd,{ffmpeg:runFFmpeg});
    assert.ok(audio,'Real music validation/encoding: '+id);
  }
  console.log('PASS: all 10 pinned MP3 excerpts decode and normalize/encode as 12-second AAC.');
  const photos=[];
  for(let i=0;i<4;i++){
    const file=path.join(cwd,'source-'+i+'.jpg');
    if(input)await fs.copyFile(path.join(input,'source-'+i),file);
    else runFFmpeg(['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
      'color=c='+['tan','sienna','beige','wheat'][i]+':s=1080x1920','-frames:v','1',file],cwd);
    photos.push(file);
  }
  const contract=await loadContract(),plan=contract.socialMediaPlan_({productKey:'SYNTH-MUSIC-ACCEPTANCE',
    photos:photos.map((_,i)=>({id:'attSynthetic'+i})),renderFacts:facts},true);
  const file=await renderReel(photos,facts,cwd,{musicPlan:plan});
  const result=verifyReel(file);assert.equal(result.silent,false);assert.equal(result.audioCodec,'aac');
  assert.equal(result.sampleRate,48000);assert.equal(result.channels,2);
  const meter=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-i',file,'-af','volumedetect','-vn','-f','null','-'],
    {encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(meter.status,0);
  const mean=Number(meter.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  const peak=Number(meter.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
  assert.ok(mean<-20&&mean>-55,'Conservative, audible background level');assert.ok(peak<=-3,'No clipping');
  console.log(JSON.stringify({status:'PASS',musicTrackId:plan.musicTrackId,...result,meanDb:mean,peakDb:peak}));
  if(process.env.SOCIAL_MUSIC_ACCEPTANCE_OUTPUT){
    const out=path.resolve(process.env.SOCIAL_MUSIC_ACCEPTANCE_OUTPUT);await fs.mkdir(out,{recursive:true});
    await fs.copyFile(file,path.join(out,'music-reel.mp4'));
    runFFmpeg(['-hide_banner','-loglevel','error','-y','-ss','5','-i',file,'-frames:v','1',path.join(out,'music-frame.jpg')],cwd);
  }
  const fallback=await renderReel(photos,facts,cwd,{musicPlan:plan,music:async()=>null});
  assert.equal(verifyReel(fallback).silent,true);
  console.log('PASS: real silent fallback remains 1080x1920 H264 / 12 seconds, with no audio stream.');
} finally {
  if(path.dirname(cwd)!==os.tmpdir()||!path.basename(cwd).startsWith('invicta-music-codec-'))throw Error('Unsafe temporary directory');
  await fs.rm(cwd,{recursive:true,force:true});
}
