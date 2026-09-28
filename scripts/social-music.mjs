/** Controlled, license-verified local library. No network access or credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const musicDirectory=fileURLToPath(new URL('../media/social-music/',import.meta.url));
export const musicVersion='music-library-v1';
export function probeAudio(file,bin=process.env.FFPROBE_PATH||'ffprobe') {
  const result=spawnSync(bin,['-v','error','-show_streams','-show_format','-of','json',file],
    {encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  if(result.status!==0)throw Error('Music audio probe failed.');
  return JSON.parse(result.stdout);
}
export function validateAudio(body,{codec,duration}) {
  const audio=body.streams?.[0];
  if(body.streams?.length!==1||audio?.codec_type!=='audio'||audio.codec_name!==codec||
    Number(audio.sample_rate)!==48000||audio.channels!==2||
    !Number.isFinite(Number(body.format?.duration))||Math.abs(Number(body.format.duration)-duration)>0.15||
    !(Number(body.format?.size)>0&&Number(body.format.size)<2*1024*1024))throw Error('Music audio validation failed.');
  return body;
}
export async function loadMusic(trackId,version,{directory=musicDirectory,probe=probeAudio}={}) {
  if(!/^music-(0[1-9]|10)$/.test(trackId)||version!==musicVersion)throw Error('Unapproved music identity.');
  const library=JSON.parse(await fs.readFile(path.join(directory,'library.json'),'utf8'));
  if(library.version!==version||library.tracks?.length!==10||
    new Set(library.tracks.map(t=>t.id)).size!==10)throw Error('Unapproved music library.');
  const track=library.tracks.find(t=>t.id===trackId);
  if(!track||track.file!==trackId+'.mp3'||track.license!=='CC BY 4.0'||
    track.licenseUrl!=='https://creativecommons.org/licenses/by/4.0/'||track.artist!=='Kevin MacLeod'||
    !track.commercialUse||!track.attributionRequired||!track.instrumental||
    !/^[a-f0-9]{64}$/.test(track.sha256))throw Error('Missing verified commercial music license.');
  const file=path.join(directory,track.file),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw Error('Invalid controlled music file.');
  if(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==track.sha256)throw Error('Music checksum mismatch.');
  validateAudio(probe(file),{codec:'mp3',duration:30});
  return {...track,file};
}
export function musicCredit(track) {
  const artist=track.contributors.length?'Kevin MacLeod; guitar: Brett Van Donsel':'Kevin MacLeod';
  return '"'+track.title+'" / '+artist+' (incompetech.com)\n'+
    'CC BY 4.0: https://creativecommons.org/licenses/by/4.0/\nExcerpt, looped, normalized and faded.';
}
export const backgroundAudioFilter='atrim=duration=12,asetpts=PTS-STARTPTS,'+
  'loudnorm=I=-23:TP=-3:LRA=7,volume=0.5,alimiter=limit=0.5:level=false,'+
  'afade=t=in:st=0:d=0.5,afade=t=out:st=10.8:d=1.2';
export async function prepareMusicAudio(plan,cwd,{ffmpeg,probe=probeAudio,loader=loadMusic}={}) {
  try {
    const track=await loader(plan.musicTrackId,plan.musicLibraryVersion);
    // Decode every frame, not only the container header; corrupt audio is optional.
    ffmpeg(['-hide_banner','-loglevel','error','-xerror','-i',track.file,'-map','0:a:0','-vn','-f','null','-'],cwd);
    const file=path.join(cwd,'music.m4a');
    ffmpeg(['-hide_banner','-loglevel','error','-y','-stream_loop','-1','-i',track.file,
      '-map','0:a:0','-vn','-t','12','-af',backgroundAudioFilter,'-c:a','aac','-b:a','128k',
      '-ar','48000','-ac','2','-movflags','+faststart',file],cwd);
    validateAudio(probe(file),{codec:'aac',duration:12});
    return {file,credit:musicCredit(track)};
  } catch (_) {
    // Missing/corrupt/license-mismatched track, decoder or encoder failure: silent.
    // No raw stderr, paths, signed URLs or credential data enter logs.
    return null;
  }
}
