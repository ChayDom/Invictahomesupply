/** Reviewed asset import only. No credentials, uploads, publishing or deploys. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const titles=['Carefree','Daily Beetle','Wallpaper','Cheery Monday','Wholesome',
  'Bright Wish','Easy Lemon','Happy Alley','Lobby Time','Local Forecast'];
const root=new URL('../media/social-music/',import.meta.url);
const provider='https://incompetech.com/music/royalty-free/';
const catalog=await (await fetch(provider+'pieces.json',{signal:AbortSignal.timeout(30000)})).json();
const tracks=titles.map((title,i)=>{
  const matches=catalog.filter(p=>p.title===title);
  if(matches.length!==1||/vocal|voice|choir|chorus|sing/i.test(matches[0].instruments))throw Error('Unapproved/ambiguous instrumental source');
  const p=matches[0];
  return {id:'music-'+String(i+1).padStart(2,'0'),title,artist:'Kevin MacLeod',provider:'Incompetech',
    contributors:title==='Daily Beetle'?['Brett Van Donsel (guitar)']:[],
    instruments:p.instruments,sourceUrl:provider+'index.html?isrc='+p.isrc,
    downloadUrl:provider+'mp3-royaltyfree/'+encodeURIComponent(p.filename),
    license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
    commercialUse:true,attributionRequired:true,instrumental:true,
    modifications:'30-second excerpt; resampled to stereo 48 kHz and encoded as MP3.'};
});
// Verify the actual provider's track-page license text before downloading music.
const licensePage=await (await fetch(tracks[0].sourceUrl,{signal:AbortSignal.timeout(30000)})).text();
if(!licensePage.includes('By Attribution 4.0 License')||!licensePage.includes('creativecommons.org/licenses/by/4.0/'))throw Error('Provider license evidence unavailable');
try {await fs.access(new URL('library.json',root));throw Error('Approved library already exists; do not overwrite');}
catch(error){if(error.code!=='ENOENT')throw error;}
await fs.mkdir(root,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'invicta-music-import-'));
try {
 for(const track of tracks){
  const response=await fetch(track.downloadUrl,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Provider download unavailable: '+track.id);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length||bytes.length>30*1024*1024)throw Error('Invalid source size');
  const source=path.join(temp,track.id+'.mp3');await fs.writeFile(source,bytes);
  const target=new URL(track.id+'.mp3',root);
  const result=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-i',source,'-map','0:a:0','-vn','-t','30','-ac','2','-ar','48000','-c:a','libmp3lame','-b:a','128k',
   '-metadata','title='+track.title,'-metadata','artist=Kevin MacLeod',
   '-metadata','copyright=CC BY 4.0 https://creativecommons.org/licenses/by/4.0/',fileURLToPath(target)],
   {encoding:'utf8',timeout:60000,windowsHide:true});
  if(result.status!==0)throw Error('Audio import failed: '+track.id);
  track.file=track.id+'.mp3';track.sha256=crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');
  track.sourceSha256=crypto.createHash('sha256').update(bytes).digest('hex');
  console.log('Imported '+track.id+' / '+track.title+' under CC BY 4.0');
 }
 await fs.writeFile(new URL('library.json',root),JSON.stringify({version:'music-library-v1',verifiedOn:'2026-09-28',tracks},null,2)+'\n');
} finally {
 if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('invicta-music-import-'))throw Error('Unsafe temporary directory');
 await fs.rm(temp,{recursive:true,force:true});
}
