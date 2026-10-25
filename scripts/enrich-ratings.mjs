import { parseBackup } from '../tracking/backup.js';
import { productInventory } from '../tracking/products.js';
import path from 'node:path';
import { readFile, readdir, stat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refreshRatings, emptyCache, cacheKey, PROVIDERS } from '../ranking/refresh.mjs';
import { validateCrosswalk, steamMapping } from '../ranking/crosswalk.mjs';
import { readJSON, atomicJSON, withRefreshLock } from '../ranking/storage.mjs';
import { parseData, readOwnedGroups } from './snapshot.mjs';
import { validateRatingsSnapshot } from '../ranking/snapshot.js';
import { refreshJob, jobSummary } from '../ranking/jobs.mjs';
import { readIgdb, attachOwned, ownedSteamId } from './igdb-snapshot.mjs';

export function options(args) {
  const out={steam:[],providers:null,crosswalk:null,maxRequests:20,force:false,batch:false,wishlist:false,owned:false,'owned-igdb':false,tracking:null,plan:false};
  for(let index=0;index<args.length;index++){
    const flag=args[index];
    if(['--force','--batch','--wishlist','--owned','--owned-igdb','--plan','--drain','--status'].includes(flag)){out[flag.slice(2)]=true;continue;}
    const value=args[++index];if(!value || value.startsWith('--'))throw Error('Missing option value');
    if(flag==='--steam'){if(!value.split(',').every(id=>/^[1-9]\d{0,14}$/.test(id)))throw Error('Use comma-separated Steam app IDs');out.steam.push(...value.split(','));}
    else if(flag==='--provider'){out.providers=value.split(',');if(!out.providers.every(id=>['steam','vgc','igdb'].includes(id)))throw Error('Unknown ratings provider');}
    else if(flag==='--tracking')out.tracking=value;
    else if(flag==='--crosswalk')out.crosswalk=value;
    else if(flag==='--max-requests'){out.maxRequests=Number(value);if(!Number.isInteger(out.maxRequests)||out.maxRequests<1||out.maxRequests>50)throw Error('Request budget must be 1–50');}
    else throw Error(`Unknown option: ${flag}`);
  }
  if(out.owned&&!out.tracking)throw Error('--owned requires --tracking /path/to/exported-tracking-backup.json');
  if(out.tracking&&!out.owned)throw Error('--tracking is only used with --owned');
  if(out.drain&&out.force)throw Error('--drain cannot be combined with --force; finish pending work before forcing a new refresh.');
  if(out.status&&args.length!==1)throw Error('Use --status alone to inspect the last saved job offline.');
  return out;
}

const DAY=24*3600000,WEEK=7*DAY,MONTH=30*DAY,RECENT=182*DAY,KEEP_SNAPSHOTS=5;
// Every run saves its evidence snapshot; only the latest few are kept (nothing reads older ones).
async function pruneSnapshots(directory){
  const folder=path.join(directory,'snapshots');
  const files=await Promise.all((await readdir(folder).catch(()=>[])).filter(name=>name.endsWith('.json')).map(async name=>({name,time:(await stat(path.join(folder,name))).mtimeMs})));
  for(const {name} of files.sort((a,b)=>b.time-a.time).slice(KEEP_SNAPSHOTS))await rm(path.join(folder,name),{force:true});
}

export async function enrich({root=process.cwd(),args=process.argv.slice(2),fetchImpl=fetch,credentials={vgcKey:process.env.VGC_API_KEY,igdbClientId:process.env.IGDB_CLIENT_ID,igdbAccessToken:process.env.IGDB_ACCESS_TOKEN},clock=Date.now,sleep,onProgress,signal}={}) {
  const config=options(args),directory=path.join(root,'.runtime/ratings');
  const jobFile=path.join(directory,'job.json');
  if(config.status)return jobSummary(await readJSON(jobFile,null));
  const publicMap=await readJSON(path.join(root,'ranking/crosswalk.json'),null);validateCrosswalk(publicMap);
  const custom=config.crosswalk?await readJSON(path.resolve(root,config.crosswalk),null):await readJSON(path.join(directory,'crosswalk.json'),{schemaVersion:1,revision:1,mappings:[]});validateCrosswalk(custom);
  const wished=new Set();
  // With --batch, Steam reviews age by what they're about: a wishlist game or one out less
  // than six months (or not out yet) is checked weekly, an established game monthly. Its
  // score barely moves after that, and Steam answers 100 games a request.
  const ttlFor=(mapping,entry)=>{
    if(!config.batch||mapping.provider!=='steam')return PROVIDERS[mapping.provider].ttlMs;
    const released=Date.parse(entry?.source?.details?.released??''),recent=!Number.isFinite(released)&&entry?.source?.details?.comingSoon||Number.isFinite(released)&&clock()-released<RECENT;
    return wished.has(mapping.providerId)||recent?WEEK:MONTH;
  };
  const operation=async()=>{
    const saved=await readJSON(path.join(directory,'steam-products.json'),[]);
    if(!Array.isArray(saved) || !saved.every(item=>item && typeof item.id==='string' && /^[1-9]\d{0,14}$/.test(item.id) && Number.isFinite(Date.parse(item.addedAt))))throw Error('Invalid saved Steam product selection');
    if(config.wishlist){
      // Explicit opt-in only. No titles, notes, account identifiers or membership list is sent.
      const source=await readFile(path.join(root,'library/data/wishlist-data.js'),'utf8');
      for(const game of parseData(source,'STEAM_WISHLIST').STEAM_WISHLIST){if(!/^[1-9]\d{0,14}$/.test(String(game.appid)))throw Error('Wishlist contains an invalid Steam app ID');config.steam.push(String(game.appid));wished.add(String(game.appid));}
    }
    if(config['owned-igdb']){
      // Steam products of owned Steam copies (games you added by hand too), from confident IGDB
      // matches with exactly one Steam id.
      const source=await readFile(path.join(root,'library/data/library-data.js'),'utf8').catch(()=>null);
      const igdb=await readIgdb(root);
      if((source&&parseData(source,'PLAYNITE_LIBRARY').PLAYNITE_SAMPLE)||!igdb)throw Error('--owned-igdb needs a personal library and a completed npm run igdb:refresh.');
      const groups=await readOwnedGroups(root);
      attachOwned(igdb,groups);
      for(const group of groups)for(const copy of group.copies){
        const id=ownedSteamId(copy);if(id)config.steam.push(id);
      }
    }
    let ownedIdentity;
    if(config.owned){
      const tracking=parseBackup(await readFile(path.resolve(root,config.tracking),'utf8'),'personal');
      const data=parseData(await readFile(path.join(root,'library/data/library-data.js'),'utf8'),'PLAYNITE_LIBRARY');
      if(data.PLAYNITE_SAMPLE)throw Error('Owned refresh requires a personal library, not sample products.');
      const inventory=productInventory(data.PLAYNITE_LIBRARY,tracking.productReviews);
      config.steam.push(...inventory.verifiedProductIds);
      ownedIdentity={copies:inventory.items.length,counts:inventory.counts,missingReviewedCopies:inventory.missingReviewedCopies.length,verifiedProducts:inventory.verifiedProductIds.length};
    }
    const ids=[...new Set([...saved.map(item=>item.id),...config.steam])].sort();
    const selections=ids.map(id=>({id,addedAt:saved.find(item=>item.id===id)?.addedAt??new Date(clock()).toISOString()}));
    const mappings=new Map(publicMap.mappings.map(mapping=>[`${mapping.target.provider}:${mapping.target.id}:${mapping.provider}`,mapping]));
    for(const {id,addedAt} of selections){const mapping=steamMapping(id,addedAt);mappings.set(`steam:${id}:steam`,mapping);}
    for(const mapping of custom.mappings)mappings.set(`${mapping.target.provider}:${mapping.target.id}:${mapping.provider}`,mapping);
    const crosswalk=validateCrosswalk({schemaVersion:1,revision:Math.max(publicMap.revision,custom.revision),mappings:[...mappings.values()]});
    if(config.plan)return {plan:true,...(ownedIdentity?{ownedIdentity}:{}),mappings:crosswalk.mappings.length,providers:[...new Set(crosswalk.mappings.map(mapping=>mapping.provider))],maxRequests:config.maxRequests};
    let cache=await readJSON(path.join(directory,'cache.json'),emptyCache());
    const plan={new:0,due:0,fresh:0},start=clock();
    for(const mapping of new Map(crosswalk.mappings.filter(m=>!config.providers||config.providers.includes(m.provider)).map(m=>[cacheKey(m),m])).values()){
      const entry=cache.entries[cacheKey(mapping)];
      if(!entry?.source)plan.new++;
      else if(!config.force&&!entry.error&&start-Date.parse(entry.checkedAt)<ttlFor(mapping,entry))plan.fresh++;
      else plan.due++;
    }
    const previousJob=await readJSON(jobFile,null);
    const resuming=previousJob&&!jobSummary(previousJob).complete;
    let job=refreshJob(crosswalk,cache,{providers:config.providers,now:clock(),force:config.force,previous:resuming?previousJob:null,ttlFor});
    // Save the requested cohort before the first network call, so interruption
    // cannot silently drop product selections or completed responses.
    await atomicJSON(path.join(directory,'steam-products.json'),selections);
    job.publicationPending=true;
    await atomicJSON(jobFile,job);
    const skipKeys=new Set(),failuresByProvider=new Map();let requests=0,result;
    if(config.force&&previousJob?.selectionHash===job.selectionHash&&resuming){
      for(const row of job.rows)if(['rated','no-reviews'].includes(row.outcome))skipKeys.add(row.key);
    }
    const checkpoint=async next=>{
      await atomicJSON(path.join(directory,'cache.json'),next);
      job=refreshJob(crosswalk,next,{providers:config.providers,now:clock(),force:config.force,previous:job,ttlFor});
      job.publicationPending=true;
      await atomicJSON(jobFile,job);
      // Batched runs report after every batch; a batch can finish a hundred games.
      if(config.batch)await onProgress?.(jobSummary(job));
    };
    do {
      result=await refreshRatings({crosswalk,cache,fetchImpl,credentials,clock,sleep,force:config.force,maxRequests:config.maxRequests,onlyProviders:config.providers,onCheckpoint:checkpoint,skipKeys,failuresByProvider,signal,batch:config.batch,ttlFor});
      cache=result.cache;requests+=result.report.requests;
      result.report.attemptedKeys.forEach(key=>skipKeys.add(key));
      validateRatingsSnapshot(result.snapshot);
      // Save transport state first: a later disk failure must not reset quota/backoff.
      await atomicJSON(path.join(directory,'cache.json'),result.cache);
      await atomicJSON(path.join(directory,'snapshots',`${result.snapshot.snapshotId}.json`),result.snapshot);
      await pruneSnapshots(directory);
      await atomicJSON(path.join(root,'library/data/ratings.json'),result.snapshot);
      job=refreshJob(crosswalk,cache,{providers:config.providers,now:clock(),force:config.force,previous:job,ttlFor});
      job.publicationPending=false;job.publishedAt=result.snapshot.generatedAt;
      await atomicJSON(jobFile,job);await onProgress?.({...jobSummary(job),requests});
    } while(config.drain&&!signal?.aborted&&result.report.requests>0&&result.report.outcomes.some(row=>row.status==='budget'));
    const {attemptedKeys,...report}=result.report;
    return {...report,requests,plan,job:jobSummary(job),...(ownedIdentity?{ownedIdentity}:{})};
  };
  return config.plan?operation():withRefreshLock(directory,operation);
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const report=await enrich({signal:controller.signal,onProgress:progress=>console.error(JSON.stringify(progress))});const {outcomes,...summary}=report;console.log(JSON.stringify(summary,null,2));if(report.job?.complete===false)process.exitCode=2;}
  catch(error){console.error(error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
