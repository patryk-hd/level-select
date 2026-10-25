import { mkdir, writeFile, rename, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJSON(file,fallback) {
  try{return JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw Error(`Cannot read ${path.basename(file)}; preserve the file for recovery.`);}
}
export async function atomicJSON(file,value) {
  await mkdir(path.dirname(file),{recursive:true});
  const temp=`${file}.${randomUUID()}.tmp`;
  try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}
  finally{await rm(temp,{force:true});}
}
// One ratings refresh at a time. The lock records its owner's process id, so a lock left
// behind by a refresh that was killed (an app restart, a crash) is taken over instead of
// blocking every later update. An older lock without an owner counts as left behind once
// it is 30 minutes old.
const STALE_UNOWNED = 30*60*1000;
const processAlive = pid => { try { process.kill(pid,0); return true; } catch (error) { return error.code==='EPERM'; } };
export async function withRefreshLock(directory,operation,{isAlive=processAlive,now=Date.now}={}) {
  await mkdir(directory,{recursive:true});const lock=path.join(directory,'refresh.lock'),owner=path.join(lock,'owner.json');
  for (let attempt=0;;attempt++) {
    try{await mkdir(lock);break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const held=await readFile(owner,'utf8').then(JSON.parse).catch(()=>null);
      const age=now()-((await stat(lock).catch(()=>null))?.mtimeMs??now());
      const left=held?.pid?!isAlive(held.pid):age>STALE_UNOWNED;
      if(attempt||!left)throw Error(held?.pid?`A ratings refresh is already running (process ${held.pid}). Let it finish, or stop the update, then try again.`:'A ratings refresh is already running. Let it finish, or stop the update, then try again.');
      await rm(lock,{recursive:true,force:true});
    }
  }
  await writeFile(owner,JSON.stringify({pid:process.pid,startedAt:new Date(now()).toISOString()}));
  try{return await operation();}finally{await rm(lock,{recursive:true,force:true});}
}
