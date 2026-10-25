import { clone, ensureTarget, referenceKey, requireId, instant, calendarDate, stableJSON, text } from './domain.js';
import { buildSuggestionChoices } from './suggestions.js';
import { rewardGroups } from './identity.js';
import { platformKey, connectLibrary, isExtra } from '../library/core.js';
import { titleHints } from './goals.js';
import { familyOf, listFamilyKeys, SERIES, SHAPED } from './lists.js';
import { titleKey } from './families.js';

export const CHALLENGE_SECTIONS = ['challenges','challengeRevisions','challengeEvidence','challengeAwards'];
export const CHALLENGE_TEMPLATES = {
  passport: { name:'Console passport', size:3, points:20, description:'Finish a different owned game on each represented system.' },
  decades: { name:'Decade tour', size:3, points:20, description:'Explore different release decades with games you own.' },
  top: { name:'Owned top ten', size:3, points:25, description:'Finish up to three owned games from a system’s top ten. With all systems, any system’s top ten counts.' },
  bingo: { name:'Genre bingo', size:6, points:15, description:'Fill a board of genres with one distinct game per cell.' },
  rediscovery: { name:'Rediscovery', size:3, points:20, description:'Return to owned games outside your current Playing and Up Next lists. Replays are optional.' },
  season: { name:'Personal season', size:6, points:20, description:'Choose up to six owned games. Play at your pace, or add an optional date window.' },
  series: { name:'Series sampler', size:3, points:20, list:'series', description:'Finish three owned games from one iconic series.' },
  history: { name:'Genre history run', size:3, points:25, list:'shaped', description:'Finish three owned games from the games that shaped a genre.' },
};
// The lists the series and genre-history templates draw from.
export const challengeLists = templateId => CHALLENGE_TEMPLATES[templateId]?.list==='series'?SERIES:CHALLENGE_TEMPLATES[templateId]?.list==='shaped'?SHAPED:null;
const check = (value,message) => { if (!value) throw new Error(message); };
const maxSequence = state => Object.values(state.events).reduce((max,event)=>Math.max(max,event.sequence??0),0);
function day(at,timeZone) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone}).formatToParts(new Date(at)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function fingerprint(value) {
  let hash=2166136261; for (const char of stableJSON(value)) hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return (hash>>>0).toString(16).padStart(8,'0'); // Snapshot label, never a security signature.
}
function identityIndex(state) {
  const groups=rewardGroups(state), byRef=new Map();
  for(const target of Object.values(state.targets)) for(const ref of target.refs) byRef.set(referenceKey(ref),groups.get(target.id)??target.id);
  // Copies are one game when they share a copy group, a target, or the same game (sameGame:
  // its Atlas family, or its title without edition suffixes in the same decade).
  return member=>new Set([...member.familyRefs.flatMap(ref=>byRef.has(ref)?[`ref:${ref}`,`target:${byRef.get(ref)}`]:[`ref:${ref}`]),...(member.sameGame??[]).map(key=>`game:${key}`)]);
}
// What makes two copies the same game, for a new candidate: the Atlas families of the list
// entries it matches (The Last of Us and its Remastered edition), and its title without
// edition suffixes in its release decade (The Witcher 3 and its Complete Edition).
function sameGameKeys(family,member,catalogIds) {
  const keys=[...new Set(catalogIds.map(family).filter(Boolean))].map(key=>`family:${key}`), title=titleKey(member.title);
  if(title)keys.push(`title:${title}${member.year!==null?`:${Math.floor(member.year/10)}0s`:''}`);
  return keys.sort();
}
// One entry per game: the first (best) copy of each, for pickers. A passport's cells are
// systems, so there it is one per game and system.
export function distinctChallengeGames(state,members,{perSystem=false}={}) {
  const identify=identityIndex(state), seen=new Set(), kept=[];
  for(const member of members) {
    const keys=[...identify(member)].map(key=>perSystem?`${member.platform}|${key}`:key);
    if(keys.some(key=>seen.has(key)))continue;
    keys.forEach(key=>seen.add(key));kept.push(member);
  }
  return kept;
}
export function sameChallengeGame(state,a,b) {
  return challengeIdentity(state)(a,b);
}
export function challengeIdentity(state) {
  const identify=identityIndex(state),cache=new WeakMap();
  const keys=member=>{if(!cache.has(member))cache.set(member,identify(member));return cache.get(member);};
  return (a,b)=>[...keys(b)].some(key=>keys(a).has(key));
}

export function challengeCandidates(context, {templateId='season',system='',store='',allowReplays=false,list=''}={}) {
  return candidateEntries(context,{templateId,allowReplays,list}).filter(entry=>(!system||entry.member.platform===system)&&(!store||entry.sources.includes(store))).map(entry=>entry.member);
}
// How many owned games each system and store offers for a template: the planner lists
// only systems and stores you have games on, and disables the ones this template can't use.
export function challengeFacets(context, {templateId='season',system='',store='',allowReplays=false,list=''}={}) {
  const entries=challengeLists(templateId)&&!list?[]:candidateEntries(context,{templateId,allowReplays,list}), all=templateId==='season'?entries:candidateEntries(context,{templateId:'season'});
  const count=(list,key,filter)=>{const games=new Map();for(const entry of list.filter(filter))for(const value of key(entry)){if(!games.has(value))games.set(value,new Set());games.get(value).add(entry.member.targetId);}return games;};
  const systems=count(entries,entry=>[entry.member.platform],entry=>!store||entry.sources.includes(store)), stores=count(entries,entry=>entry.sources,entry=>!system||entry.member.platform===system);
  const owned=count(all,entry=>[entry.member.platform],()=>true), ownedStores=count(all,entry=>entry.sources,()=>true);
  const games=filter=>new Set(entries.filter(filter).map(entry=>entry.member.targetId)).size;
  // anySystem: games in the chosen store on every system; anyStore: the chosen system in every store.
  return {anySystem:games(entry=>!store||entry.sources.includes(store)),anyStore:games(entry=>!system||entry.member.platform===system),
    systems:[...owned.keys()].filter(id=>id!=='unknown').map(id=>({id,count:systems.get(id)?.size??0})),
    stores:[...ownedStores.keys()].map(id=>({id,count:stores.get(id)?.size??0}))};
}
// Callers that plan several previews (the tracking client) pass the suggestion choices and
// library matches they already have, and a memo cleared whenever tracking changes.
// For the series and genre-history templates: each list, with how many owned games could
// go on its board (the same games a personal season can use).
export function challengeListCounts(context,templateId) {
  const lists=challengeLists(templateId);if(!lists)return [];
  const members=candidateEntries(context,{templateId:'season'}).map(entry=>entry.member);
  return Object.entries(lists).map(([id,list])=>{
    const onList=listFamilyKeys(context.catalog,lists===SERIES?{series:id}:{shaped:id});
    const games=new Set(members.filter(member=>member.sameGame.some(key=>key.startsWith('family:')&&onList.has(key.slice(7)))).map(member=>member.targetId));
    return {id,name:list.name,count:games.size};
  });
}
function candidateEntries({state,catalog,library,choices,connections,memo}, {templateId='season',allowReplays=false,list=''}={}) {
  check(CHALLENGE_TEMPLATES[templateId],'Choose a challenge template.');
  check(!allowReplays||templateId==='rediscovery','Only rediscovery explicitly allows replays.');
  const lists=challengeLists(templateId);
  check(lists?Object.hasOwn(lists,list):!list,lists?`Choose a ${lists===SERIES?'series':'genre history'}.`:'This template has no list.');
  const memoKey=`${templateId}|${allowReplays}|${list}`;
  if(memo?.has(memoKey))return memo.get(memoKey);
  const copies=new Map(library.flatMap(game=>game.copies.map(copy=>[copy.id,{game,copy}]))), catalogById=new Map(catalog.games.map(game=>[game.id,game]));
  const candidates=[], identify=identityIndex(state), groups=rewardGroups(state);
  const finishedIds=new Set(Object.values(state.playthroughs).filter(play=>play.status==='finished').map(play=>play.id));
  for(const event of Object.values(state.events)) if(event.details.result?.status==='finished')finishedIds.add(event.details.playthroughId);
  const finishedTargets=new Set([...finishedIds].map(id=>state.playthroughs[id]).filter(Boolean).map(play=>`target:${groups.get(play.targetId)??play.targetId}`));
  // Owned copies not yet matched to the Atlas can still be in a top ten by an unambiguous
  // title on the same system: those carry a "title/platform hint" rank you check on accepting.
  const hints=titleHints(connections??connectLibrary(catalog,library,state.matchReviews)), family=familyOf(catalog);
  // A series or genre-history board takes owned games whose Atlas game is on that list.
  const onList=lists?listFamilyKeys(catalog,lists===SERIES?{series:list}:{shaped:list}):null;
  for (const choice of choices??buildSuggestionChoices({state,catalog,library})) {
    if (choice.archived||choice.status==='retired') continue;
    if (templateId==='rediscovery'&&(choice.status==='playing'||choice.queuePosition!==null)) continue;
    // Demos, soundtracks and other extras only take part when you planned them yourself.
    if (isExtra(choice.title)&&!choice.queued) continue;
    for (const option of choice.options) {
      if (!option.owned||option.hidden||option.unavailable) continue;
      const owned=option.descriptor.ref.provider==='playnite'?copies.get(option.descriptor.ref.id):null, familyRefs=owned?owned.game.copies.map(copy=>referenceKey({provider:'playnite',id:copy.id})):[...choice.keys];
      const hint=!option.ranks.length&&owned&&catalogById.get(hints.get(owned.copy.id));
      const ranks=hint&&Number.isInteger(hint.rank)?[{id:hint.id,systemId:hint.systemId,rank:hint.rank,confirmed:false}]:option.ranks;
      for (const platform of option.platforms.length?option.platforms:['unknown']) {
        const rank=ranks.find(rank=>rank.systemId===platform), match=rank&&catalogById.get(rank.id);
        const rawYear=owned?.copy.year??owned?.game.year??match?.year, year=Number.isInteger(rawYear)&&rawYear>=1950&&rawYear<=2200?rawYear:null;
        const member={key:`${referenceKey(option.descriptor.ref)}@${platform}`,targetId:choice.id,descriptor:{...clone(option.descriptor),platforms:platform==='unknown'?[]:[platform]},platform,
          familyRefs:[...new Set(familyRefs)].sort(),title:choice.title,genres:[...new Set(option.genres)].sort(),year,
          rank:rank?{catalogId:rank.id,systemId:rank.systemId,position:rank.rank,match:rank.confirmed?'confirmed reference':'title/platform hint'}:null,
          yearSource:year===null?'unknown':owned?.copy.year!=null?'imported copy':owned?.game.year!=null?'imported game':'catalog match',ownership:option.ownershipReason};
        member.sameGame=sameGameKeys(family,member,[...ranks.map(item=>item.id),...(option.descriptor.ref.provider==='catalog'?[option.descriptor.ref.id]:[])]);
        if (!allowReplays&&[...identify(member)].some(key=>finishedTargets.has(key))) continue;
        if (templateId==='top'&&(!rank||rank.rank>10)) continue;
        if (onList) { if (!member.sameGame.some(key=>key.startsWith('family:')&&onList.has(key.slice(7)))) continue; member.list={kind:CHALLENGE_TEMPLATES[templateId].list,id:list}; }
        candidates.push({member,sources:[...new Set(option.sources)],score:option.rating?.value??0});
      }
    }
  }
  // Top tens go by list position; other boards start with your best-rated games.
  const sorted=candidates.sort((a,b)=>templateId==='top'?a.member.rank.position-b.member.rank.position||compare(a.member,b.member):b.score-a.score||compare(a.member,b.member));
  memo?.set(memoKey,sorted);
  return sorted;
  function compare(a,b) { return a.title.localeCompare(b.title)||a.key.localeCompare(b.key); }
}
function matchCategory(member,templateId,category) {
  if (templateId==='passport') return member.platform===category;
  if (templateId==='decades') return member.year!==null&&String(Math.floor(member.year/10)*10)===category;
  if (templateId==='bingo') return member.genres.includes(category);
  return true;
}
// Maximum matching avoids boards that strand a rare category after choosing a
// multi-genre game too early. Identity resources include grouped owned copies.
function assignCategories(state,candidates,categories,templateId,size) {
  const identify=identityIndex(state), parents=candidates.map((_,i)=>i), byToken=new Map();
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  candidates.forEach((member,i)=>{for(const token of identify(member)){if(byToken.has(token))parents[root(i)]=root(byToken.get(token));else byToken.set(token,i);}});
  const grouped=new Map();candidates.forEach((member,i)=>{const key=root(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(member);});
  const families=[...grouped.values()];
  const assigned=new Map(), byCategory=new Map();
  const taken=new Set();
  function place(category,seen) {
    // A free game comes first, so boards keep candidate order (best list rank first).
    const free=families.findIndex((family,i)=>!taken.has(i)&&family.some(member=>matchCategory(member,templateId,category)));
    if (free>=0&&!seen.size) { taken.add(free);assigned.set(free,category);byCategory.set(category,families[free].find(member=>matchCategory(member,templateId,category)));return true; }
    for (let i=0;i<families.length;i++) {
      const candidate=families[i].find(member=>matchCategory(member,templateId,category));
      if (!candidate||seen.has(i)) continue;seen.add(i);
      if (!assigned.has(i)||place(assigned.get(i),seen)) { taken.add(i);assigned.set(i,category);byCategory.set(category,candidate);return true; }
    }
    return false;
  }
  const selected=[];
  for (const category of categories) {if (place(category,new Set())) selected.push(category);if(selected.length===size)break;}
  return selected.map(category=>({category,member:byCategory.get(category)}));
}
export function previewChallenge(context, options, {at,timeZone}={}) {
  instant(at);const template=CHALLENGE_TEMPLATES[options.templateId];check(template,'Choose a challenge template.');
  const zone=context.state.progression.profile?.timeZone??timeZone;check(typeof zone==='string'&&zone.length>0,'Choose a challenge timezone.');day(at,zone);
  const startOn=options.startOn||null,endOn=options.endOn||null;calendarDate(startOn,true);calendarDate(endOn,true);
  check((!startOn&&!endOn)||options.templateId==='season'&&startOn&&endOn&&startOn<=endOn,'A dated personal season needs a start and end date in order.');
  check(!endOn||endOn>=day(at,zone),'Choose a season that has not already ended.');
  // A store is only part of the rules when one is chosen, so earlier plans keep their rules.
  const rules={templateId:options.templateId,system:options.system??'',...(options.store?{store:String(options.store)}:{}),...(template.list?{list:String(options.list??'')}:{}),allowReplays:Boolean(options.allowReplays),startOn,endOn,timeZone:zone};
  const candidates=challengeCandidates(context,rules);
  const categories=rules.templateId==='passport'?[...new Set(candidates.map(member=>member.platform).filter(id=>id!=='unknown'))].sort():
    rules.templateId==='decades'?[...new Set(candidates.filter(member=>member.year!==null).map(member=>String(Math.floor(member.year/10)*10)))].sort():
    rules.templateId==='bingo'?[...new Set(candidates.flatMap(member=>member.genres))].sort():Array.from({length:template.size},(_,i)=>String(i+1));
  const cells=assignCategories(context.state,candidates,categories,rules.templateId,template.size).map(({category,member},index)=>({id:`cell-${index+1}`,category,member}));
  return {baseRevision:context.state.revision,createdAt:at,rules,cells,candidates,
    basis:{mode:'editorial-system-rank',methodVersion:1,catalogUpdatedAt:String(context.catalog.updatedAt??'unknown'),snapshot:fingerprint(candidates)},
    requestedSize:template.size,bonus:cells.length*template.points};
}
export function chooseChallengeMember(state,preview,cellId,key) {
  const next=clone(preview), cell=next.cells.find(cell=>cell.id===cellId), member=next.candidates.find(member=>member.key===key);
  check(cell&&member&&matchCategory(member,next.rules.templateId,cell.category),'Choose a matching owned copy.');
  check(!next.cells.some(other=>other.id!==cellId&&sameChallengeGame(state,member,other.member)),'One game can occupy only one challenge cell. Choose another game.');
  cell.member=clone(member);return next;
}
function boundary(state,at) {
  return {acceptedAt:at,afterSequence:maxSequence(state),excludedPlayIds:Object.values(state.playthroughs).filter(play=>play.status==='finished'||Object.values(state.events).some(event=>event.details.playthroughId===play.id&&event.details.result?.status==='finished')).map(play=>play.id).sort()};
}
export function acceptChallenge(current,preview,{id,revisionId,at,confirmed,previousId=null,reason='accepted'}={}) {
  check(confirmed===true,'Confirm access to these copies and their matching metadata.');
  check(current.revision===preview.baseRevision,'Tracking changed. Generate a new challenge preview.');
  check(preview.cells.length>0,'No eligible games. Try another template or import an owned library.');
  instant(at);requireId(id);requireId(revisionId);check(at>=preview.createdAt,'The clock changed. Generate a new challenge preview.');
  const state=clone(current), previous=previousId?state.challenges[previousId]:null;
  check(!state.challengeRevisions[revisionId],'Challenge revision already exists.');
  if(previousId)check(previous&&!previous.archived&&previous.id===id&&previous.templateId===preview.rules.templateId,'This challenge changed or was archived.');
  else {check(!state.challenges[id],'Challenge already exists.');check(!Object.values(state.challenges).some(item=>item.templateId===preview.rules.templateId&&!item.archived),'Archive the current challenge of this type before accepting another.');}
  const previousRevision=previous&&state.challengeRevisions[previous.currentRevision], fresh=boundary(state,at);
  if(reason==='substitution')check(stableJSON(preview.rules)===stableJSON(previousRevision?.rules),'Substitution cannot change challenge rules.');
  const cells=preview.cells.map((cell,index)=>{
    check(!preview.cells.slice(0,index).some(other=>sameChallengeGame(state,cell.member,other.member)),'One game can occupy only one challenge cell.');
    check(matchCategory(cell.member,preview.rules.templateId,cell.category),'Choose a matching game.');
    const unchanged=reason==='substitution'&&previousRevision?.cells.some(old=>old.id===cell.id&&stableJSON(old.member)===stableJSON(cell.member));
    check(unchanged||preview.candidates.some(candidate=>stableJSON(candidate)===stableJSON(cell.member)),'Choose a copy from this preview.');
    const target=ensureTarget(state,cell.member.descriptor);check(target.id===cell.member.targetId,'The selected copy changed identity. Preview again.');
    const old=reason==='substitution'&&previousRevision?.cells.find(old=>old.id===cell.id&&stableJSON(old.member)===stableJSON(cell.member));
    return {...clone(cell),basis:clone(old?.basis??preview.basis),boundary:old?clone(old.boundary):{...clone(fresh),excludedPlayIds:fresh.excludedPlayIds.filter(id=>state.playthroughs[id].targetId===target.id)}};
  });
  state.challengeRevisions[revisionId]={id:revisionId,challengeId:id,version:1,createdAt:at,reason,previousRevisionId:previous?.currentRevision??null,
    rules:clone(preview.rules),basis:clone(preview.basis),cells,bonus:cells.length*CHALLENGE_TEMPLATES[preview.rules.templateId].points};
  state.challenges[id]=previous?{...previous,currentRevision:revisionId}:{id,templateId:preview.rules.templateId,acceptedAt:at,currentRevision:revisionId,archived:false};
  return state;
}
export function substitutionPreview(context,id,cellId,{at,timeZone}={}) {
  const instance=context.state.challenges[id];check(instance&&!instance.archived,'This challenge is missing or archived.');
  const revision=context.state.challengeRevisions[instance.currentRevision], fresh=previewChallenge(context,revision.rules,{at,timeZone});
  check(revision.cells.some(cell=>cell.id===cellId),'This challenge cell is missing.');
  return {...fresh,rules:clone(revision.rules),cells:revision.cells.map(({boundary,...cell})=>clone(cell)),bonus:revision.bonus,substitutionCell:cellId};
}
export function archiveChallenge(current,id,expected) {
  const state=clone(current),instance=state.challenges[id];check(instance&&stableJSON(instance)===stableJSON(expected),'This challenge changed. Reopen it before archiving.');instance.archived=true;return state;
}
function finishedPlay(play,at) {
  return play&&!play.historical&&play.status==='finished'&&play.finishedAt&&play.finishedAt<=at&&
    (play.objective==='main-game'||play.objective==='personal'&&Boolean(play.objectiveText.trim()));
}
function validEvidence(state,evidence,cell,rules) {
  const event=state.events[evidence.eventId],play=state.playthroughs[evidence.playthroughId];
  if(!event||!play||play.targetId!==cell.member.targetId||play.historical||evidence.at<cell.boundary.acceptedAt||(event.sequence??0)<=cell.boundary.afterSequence||cell.boundary.excludedPlayIds.includes(play.id))return false;
  if(play.playedSource&&referenceKey(play.playedSource)!==referenceKey(cell.member.descriptor.ref))return false;
  if(cell.member.platform!=='unknown'&&play.playedPlatforms?.length&&!play.playedPlatforms.map(platformKey).includes(cell.member.platform))return false;
  if(!play.playedSource&&state.targets[play.targetId].refs.length>1)return false;
  let date;
  if(evidence.type==='finish') {
    const latest=Object.values(state.events).filter(event=>event.details.playthroughId===play.id).reduce((max,event)=>event.recordedAt>max?event.recordedAt:max,evidence.at);
    if(!finishedPlay(play,latest)||play.finishedAt<cell.boundary.acceptedAt)return false;
    date=day(play.finishedAt,rules.timeZone);
  } else {
    const entry=state.journalEntries[evidence.entryId];
    if(!entry||entry.deletedAt||!entry.achieved||!['milestone','mastery'].includes(entry.kind)||!entry.occurredOn||entry.occurredOn<day(cell.boundary.acceptedAt,rules.timeZone)||entry.occurredOn>day(evidence.at,rules.timeZone))return false;
    date=entry.occurredOn;
  }
  const recordedDay=day(evidence.at,rules.timeZone);
  return (!rules.startOn||date>=rules.startOn&&recordedDay>=rules.startOn)&&(!rules.endOn||date<=rules.endOn&&recordedDay<=rules.endOn);
}
export function challengeProgress(state,revision,proofIds=null,awardBeingChecked=null) {
  const sameGame=challengeIdentity(state);
  const reserved=new Set(Object.values(state.challengeAwards).filter(award=>award.challengeId!==revision.challengeId&&state.challenges[award.challengeId]?.templateId===revision.rules.templateId&&(!awardBeingChecked||`${award.at}:${award.id}`<`${awardBeingChecked.at}:${awardBeingChecked.id}`)).flatMap(award=>award.proofIds.map(id=>state.challengeEvidence[id]?.playthroughId)));
  const filled=[], evidence=Object.values(state.challengeEvidence).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const cells=revision.cells.map((cell,index)=>{
    const duplicate=filled.some(other=>sameGame(cell.member,other.member));
    const eligible=evidence.filter(item=>!reserved.has(item.playthroughId)&&validEvidence(state,item,cell,revision.rules));
    const finish=duplicate?null:eligible.find(item=>item.type==='finish'&&(!proofIds||item.id===proofIds[index]));
    if(finish)filled.push(cell);
    return {id:cell.id,done:Boolean(finish),evidenceId:finish?.id??null,milestones:eligible.filter(item=>item.type==='milestone').length,
      explanation:duplicate?'A linked copy already fills another cell. Substitute a different game.':finish?'A dated local finish meets this cell.':eligible.some(item=>item.type==='milestone')?'Milestone recorded; finish the declared objective to fill this cell.':'Record a new dated finish for this selected copy after acceptance.'};
  });
  return {cells,finished:cells.filter(cell=>cell.done).length,total:cells.length,complete:cells.length>0&&cells.every(cell=>cell.done)};
}
export function validChallengeAward(state,award) {
  const revision=state.challengeRevisions[award.revisionId];return Boolean(revision&&challengeProgress(state,revision,award.proofIds,award).complete);
}
export function captureChallenges(before,proposed,audit) {
  const state=clone(proposed);if(!Object.keys(state.challenges).length)return state;
  const events=Object.values(state.events).filter(event=>!before.events[event.id]);
  for(const event of events) {
    const play=state.playthroughs[event.details.playthroughId];if(!play)continue;
    const add=(id,type,entryId=null)=>{if(!state.challengeEvidence[id])state.challengeEvidence[id]={id,type,targetId:play.targetId,playthroughId:play.id,entryId,eventId:event.id,at:event.recordedAt};};
    if(['status','play-edit'].includes(event.type)&&finishedPlay(play,event.recordedAt)&&!finishedPlay(event.details.previous,event.recordedAt))add(`finish:${play.id}`,'finish');
    const entry=state.journalEntries[event.details.entryId];
    if(event.type==='journal'&&entry&&!entry.deletedAt&&entry.achieved&&['milestone','mastery'].includes(entry.kind)&&!event.details.previous?.achieved)add(`milestone:${entry.id}`,'milestone',entry.id);
  }
  if(!events.length)return state; // Accepting, importing or enabling rewards is never activity.
  for(const instance of Object.values(state.challenges)) {
    if(instance.archived||Object.values(state.challengeAwards).some(award=>award.challengeId===instance.id&&validChallengeAward(state,award)))continue;
    const revision=state.challengeRevisions[instance.currentRevision],progress=challengeProgress(state,revision);
    if(!progress.complete)continue;
    const plays=new Set(progress.cells.map(cell=>state.challengeEvidence[cell.evidenceId].playthroughId));
    if(!events.some(event=>['status','play-edit','undo'].includes(event.type)&&plays.has(event.details.playthroughId??state.events[event.details.undoneEventId]?.details.playthroughId)))continue;
    const id=`award:${revision.id}:${audit.eventId}`;
    state.challengeAwards[id]={id,challengeId:instance.id,revisionId:revision.id,at:audit.at,proofIds:progress.cells.map(cell=>cell.evidenceId),
      rewardEligible:Boolean(state.progression.profile&&audit.at>=state.progression.profile.startedAt)};
  }
  return state;
}
export function challengeEntitlements(state) {
  const desired={};
  for(const award of Object.values(state.challengeAwards).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id))) {
    const id=`challenge:${award.challengeId}`,revision=state.challengeRevisions[award.revisionId];
    if(!desired[id]&&award.rewardEligible&&validChallengeAward(state,award))desired[id]={id,type:'challenge',subjectId:award.challengeId,amount:revision.bonus,ruleVersion:1,sourceIds:[award.id]};
  }
  return desired;
}
export const challengeBonusLimit=(state,id)=>Math.max(0,...Object.values(state.challengeRevisions).filter(revision=>revision.challengeId===id).map(revision=>revision.bonus));

export function validateChallenges(state) {
  const active=new Set();
  for(const [id,instance] of Object.entries(state.challenges)) {
    check(instance.id===id&&CHALLENGE_TEMPLATES[instance.templateId]&&typeof instance.archived==='boolean','Invalid challenge instance.');instant(instance.acceptedAt);
    check(state.challengeRevisions[instance.currentRevision]?.challengeId===id,'Challenge revision is missing.');
    if(!instance.archived){check(!active.has(instance.templateId),'Two active challenges of one type need review. Archive one before merging.');active.add(instance.templateId);}
  }
  for(const [id,revision] of Object.entries(state.challengeRevisions)) {
    const instance=state.challenges[revision.challengeId],template=CHALLENGE_TEMPLATES[revision.rules?.templateId];
    check(revision.id===id&&revision.version===1&&instance&&template&&instance.templateId===revision.rules.templateId,'Invalid challenge revision.');instant(revision.createdAt);
    check(['accepted','substitution','regenerated'].includes(revision.reason),'Invalid challenge revision reason.');
    if(revision.previousRevisionId)check(state.challengeRevisions[revision.previousRevisionId]?.challengeId===instance.id&&revision.previousRevisionId!==id,'Missing previous challenge revision.');
    const rules=revision.rules;if('store' in rules)text(rules.store,200);
    const lists=challengeLists(rules.templateId);check(lists?Object.hasOwn(lists,rules.list):!('list' in rules),'Invalid challenge list.');check(typeof rules.allowReplays==='boolean'&&(!rules.allowReplays||rules.templateId==='rediscovery'),'Invalid replay rule.');
    check(typeof rules.timeZone==='string'&&rules.timeZone.length>0,'Invalid challenge timezone.');day(revision.createdAt,rules.timeZone);calendarDate(rules.startOn,true);calendarDate(rules.endOn,true);
    check(!rules.startOn&&!rules.endOn||rules.templateId==='season'&&rules.startOn&&rules.endOn&&rules.startOn<=rules.endOn,'Invalid season dates.');
    check(revision.basis?.mode==='editorial-system-rank'&&revision.basis.methodVersion===1,'Unsupported challenge ranking basis.');text(revision.basis.snapshot,100);text(revision.basis.catalogUpdatedAt,100);
    check(Array.isArray(revision.cells)&&revision.cells.length>0&&revision.cells.length<=template.size&&new Set(revision.cells.map(cell=>cell.id)).size===revision.cells.length,'Invalid challenge cells.');
    check(revision.bonus===template.points*revision.cells.length,'Invalid challenge bonus.');
    for(const cell of revision.cells) {
      requireId(cell.id);text(cell.category,200);const member=cell.member;check(state.targets[member.targetId],'Challenge game is missing.');
      check(cell.basis?.mode==='editorial-system-rank'&&cell.basis.methodVersion===1,'Unsupported cell ranking basis.');text(cell.basis.snapshot,100);text(cell.basis.catalogUpdatedAt,100);
      check(state.targets[member.targetId].refs.some(ref=>referenceKey(ref)===referenceKey(member.descriptor.ref)),'Challenge copy is missing.');
      text(member.title,500);text(member.platform,200);text(member.key,1000);text(member.ownership,1000);text(member.yearSource,100);
      check(Array.isArray(member.familyRefs)&&member.familyRefs.length>0&&member.familyRefs.length<=100&&member.familyRefs.includes(referenceKey(member.descriptor.ref)),'Invalid challenge copy family.');member.familyRefs.forEach(requireId);
      check(member.sameGame===undefined||Array.isArray(member.sameGame)&&member.sameGame.length<=20,'Invalid challenge game identity.');(member.sameGame??[]).forEach(key=>text(key,1000));
      check(Array.isArray(member.genres)&&member.genres.length<=100,'Invalid challenge genres.');member.genres.forEach(genre=>text(genre,200));check(member.year===null||Number.isInteger(member.year)&&member.year>=1950&&member.year<=2200,'Invalid challenge year.');
      if(member.rank){requireId(member.rank.catalogId);text(member.rank.systemId,200);check(Number.isInteger(member.rank.position)&&member.rank.position>0,'Invalid challenge rank.');}
      check(matchCategory(member,rules.templateId,cell.category),'Challenge member does not match its frozen category.');
      if(lists)check(member.list?.id===rules.list&&member.list.kind===template.list,'A list challenge game must come from its list.');
      if(rules.templateId==='top')check(member.rank&&member.rank.position<=10&&member.rank.systemId===member.platform&&(!rules.system||member.platform===rules.system),'Top ten games must come from their own system’s list.');
      instant(cell.boundary.acceptedAt);check(Number.isSafeInteger(cell.boundary.afterSequence)&&cell.boundary.afterSequence>=0,'Invalid challenge boundary.');
      check(Array.isArray(cell.boundary.excludedPlayIds)&&cell.boundary.excludedPlayIds.every(id=>state.playthroughs[id]),'Challenge baseline playthrough is missing.');
    }
  }
  for(const [id,evidence] of Object.entries(state.challengeEvidence)) {
    const event=state.events[evidence.eventId],play=state.playthroughs[evidence.playthroughId];
    check(evidence.id===id&&['finish','milestone'].includes(evidence.type)&&event&&play&&event.targetId===play.targetId&&play.targetId===evidence.targetId&&event.details.playthroughId===play.id&&event.recordedAt===evidence.at,'Invalid challenge evidence.');instant(evidence.at);
    if(evidence.type==='finish')check(id===`finish:${play.id}`&&['status','play-edit'].includes(event.type)&&evidence.entryId===null,'Invalid challenge finish evidence.');
    else check(id===`milestone:${evidence.entryId}`&&event.type==='journal'&&state.journalEntries[evidence.entryId]?.playthroughId===play.id&&event.details.entryId===evidence.entryId,'Invalid challenge milestone evidence.');
  }
  for(const [id,award] of Object.entries(state.challengeAwards)) {
    const revision=state.challengeRevisions[award.revisionId];check(award.id===id&&revision&&revision.challengeId===award.challengeId&&typeof award.rewardEligible==='boolean','Invalid challenge badge.');instant(award.at);
    check(Array.isArray(award.proofIds)&&award.proofIds.length===revision.cells.length&&new Set(award.proofIds).size===award.proofIds.length&&award.proofIds.every(id=>state.challengeEvidence[id]?.type==='finish'),'Challenge badge evidence is missing.');
    check(!award.rewardEligible||state.progression.profile,'A rewarded challenge needs a reward profile.');
  }
}
