import { clone, requireId, instant, calendarDate, stableJSON } from './domain.js';
import { rewardGroups } from './identity.js';
import { captureChallenges, challengeEntitlements, challengeBonusLimit } from './challenges.js';
import { listAwardEntitlements, listXpLimit, LIST_XP_LIMIT } from './goals.js';
export { rewardGroups } from './identity.js';

export const RULE_VERSION = 1;
// finish: a dated finish; past: a game you finished before (no date); decision: one
// triage or wishlist review choice (every choice counts the same, so none is pushed).
export const REWARD_POINTS = { finish: 100, past: 100, reflection: 10, mastery: 50, review: 20, decision: 2 };
export const REWARD_SECTIONS = ['progression', 'rewardEvidence', 'rewardLedger', 'rewardAdjustments', 'rewardLinks', 'weeklyGoals'];
const check = (value, message) => { if (!value) throw new Error(message); };
export const profileFor = state => state.progression.profile ?? null;
export function localDay(at, timeZone) {
  instant(at);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { year:'numeric', month:'2-digit', day:'2-digit', timeZone }).formatToParts(new Date(at)).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function weekKey(at, timeZone) {
  const date = new Date(`${localDay(at,timeZone)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0,10);
}
export function enableRewards(current, { at, timeZone }) {
  const state = clone(current); check(!profileFor(state), 'Rewards are already enabled.');
  check(typeof timeZone==='string'&&timeZone.length>0,'Choose a valid reward timezone.');
  localDay(at,timeZone);
  state.progression.profile = { id:'profile', ruleVersion:RULE_VERSION, startedAt:at, timeZone, levelStep:100, frame:'plain',
    baselineFinishedTargets:[...new Set(Object.values(state.playthroughs).filter(play=>play.status==='finished').map(play=>play.targetId))].sort() };
  return state;
}

function undoneEvents(state) { return new Set(Object.values(state.events).filter(event=>event.type==='undo').map(event=>event.details.undoneEventId)); }
// A dated finish counts unless it declares a personal objective without writing it down;
// most people finishing without picking an objective simply finished the game.
function eligiblePlay(state, play, latestAt) {
  return play && !play.historical && play.status==='finished' && play.finishedAt && play.finishedAt <= latestAt &&
    (['main-game', 'unspecified'].includes(play.objective) || play.objective === 'personal' && Boolean(play.objectiveText.trim()));
}
// A game recorded as finished some time ago, without dates ("Already played").
const pastPlay = play => Boolean(play && !play.historical && play.status === 'finished' && !play.finishedAt);
export function captureRewardEvidence(before, proposed) {
  const state = clone(proposed), profile = profileFor(state); if (!profile) return state;
  for (const event of Object.values(state.events)) {
    if (before.events[event.id] || event.recordedAt < profile.startedAt) continue;
    const add = (type, subjectId, id=`${type}:${subjectId}`) => {
      if (!state.rewardEvidence[id]) state.rewardEvidence[id] = { id, ruleVersion:RULE_VERSION, type, subjectId, targetId:event.targetId,
        eventId:event.id, recordedAt:event.recordedAt, week:weekKey(event.recordedAt,profile.timeZone) };
    };
    const play = state.playthroughs[event.details.playthroughId];
    if (['status','play-edit'].includes(event.type) && eligiblePlay(state,play,event.recordedAt)) {
      if (!eligiblePlay(state,event.details.previous,event.recordedAt)) add('finish',play.id);
      if (play.reflection?.trim() && state.rewardEvidence[`finish:${play.id}`]) add('reflection',play.id);
    }
    if (event.type==='wishlist' && event.details.reviewSessionId) { add('review',event.id); add('decision',`wish:${event.id}`); }
    if (event.type==='triage') add('decision',`triage:${event.id}`);
    if (event.type==='play-edit' && pastPlay(play)) add('past',play.id);
    if (event.type==='start' || event.type==='status' && event.details.result?.status==='playing' && event.details.previous?.status!=='playing') add('session',event.id);
    if (event.type==='journal') {
      const entry = state.journalEntries[event.details.entryId];
      if (!entry || entry.deletedAt) continue;
      if (entry.kind==='note' && !event.details.previous) add('note',entry.id);
      if (['milestone','mastery'].includes(entry.kind) && entry.achieved && entry.occurredOn && entry.occurredOn >= localDay(profile.startedAt,profile.timeZone) && entry.occurredOn <= localDay(event.recordedAt,profile.timeZone)) add(entry.kind,entry.id);
    }
  }
  return state;
}
export function evidenceIsValid(state, evidence, undone = undoneEvents(state)) {
  if (undone.has(evidence.eventId) && !['finish','reflection'].includes(evidence.type)) return false;
  if (evidence.type === 'past') return pastPlay(state.playthroughs[evidence.subjectId]);
  if (['note','milestone','mastery'].includes(evidence.type)) {
    const entry=state.journalEntries[evidence.subjectId];
    return Boolean(entry && !entry.deletedAt && entry.kind===evidence.type &&
      (entry.kind==='note' || entry.achieved && entry.occurredOn && entry.occurredOn >= localDay(profileFor(state).startedAt,profileFor(state).timeZone) && entry.occurredOn <= localDay(entry.updatedAt,profileFor(state).timeZone)));
  }
  return true;
}
export function rewardEntitlements(state) {
  const profile=profileFor(state), desired={}; if (!profile) return desired;
  const groups=rewardGroups(state), blocked=new Set(profile.baselineFinishedTargets.map(id=>groups.get(id))), undone=undoneEvents(state);
  const latestByPlay=new Map(), mainGames=new Set();
  for (const event of Object.values(state.events)) if (event.details.playthroughId) {
    const key=event.details.playthroughId; if ((latestByPlay.get(key) ?? '') < event.recordedAt) latestByPlay.set(key,event.recordedAt);
  }
  for (const play of Object.values(state.playthroughs)) if (play.status==='finished' && play.objective==='main-game' && play.finishedAt && play.finishedAt <= (latestByPlay.get(play.id) ?? '')) mainGames.add(groups.get(play.targetId));
  const add=(id,type,subjectId,sourceIds) => { desired[id]={id,type,subjectId,amount:REWARD_POINTS[type],ruleVersion:RULE_VERSION,sourceIds:[...sourceIds].sort()}; };
  const reviews=new Map();
  for (const evidence of Object.values(state.rewardEvidence).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id))) {
    if (!evidenceIsValid(state,evidence,undone)) continue;
    const group=groups.get(evidence.targetId), play=state.playthroughs[evidence.subjectId];
    if (evidence.type==='finish' && eligiblePlay(state,play,latestByPlay.get(play?.id) ?? evidence.recordedAt) && !blocked.has(group)) {
      const id=`finish:${group}`; if (!desired[id]) add(id,'finish',group,[evidence.id]);
    }
    if (evidence.type==='reflection' && eligiblePlay(state,play,latestByPlay.get(play?.id) ?? evidence.recordedAt) && play.reflection?.trim() && state.rewardEvidence[`finish:${play.id}`]) add(`reflection:${play.id}`,'reflection',play.id,[evidence.id]);
    if (evidence.type==='past') { const id=`past:${group}`; if (!desired[id]) add(id,'past',group,[evidence.id]); }
    // One decision reward per game (per week for wishlist reviews); undo and re-decide earns it back once.
    if (evidence.type==='decision') {
      const kind=evidence.subjectId.split(':')[0], id=kind==='wish'?`decision:wish:${group}:${evidence.week}`:`decision:triage:${group}`;
      if (!desired[id]) add(id,'decision',kind==='wish'?`wish:${group}:${evidence.week}`:`triage:${group}`,[evidence.id]);
    }
    if (evidence.type==='mastery' && mainGames.has(group)) {
      const id=`mastery:${group}`; if (!desired[id]) add(id,'mastery',group,[evidence.id]);
    }
    if (evidence.type==='review') {
      if (!reviews.has(evidence.week)) reviews.set(evidence.week,new Map());
      reviews.get(evidence.week).set(group,evidence.id);
    }
  }
  for (const [week, entries] of reviews) if (entries.size>=10) add(`review:${week}`,'review',week,[...entries.values()].sort().slice(0,10));
  return { ...desired, ...challengeEntitlements(state), ...listAwardEntitlements(state) };
}
// The ledger has one current balance per entitlement. Adjustments are an audit
// trail, not additional credits to sum again after merging independent backups.
export function reconcileRewards(current, { at, eventId, reason='local change', eventIds=[] } = {}) {
  const state=clone(current); if (!profileFor(state)) return state;
  const desired=rewardEntitlements(state); let index=0;
  for (const id of [...new Set([...Object.keys(state.rewardLedger),...Object.keys(desired)])].sort()) {
    const previous=state.rewardLedger[id], next=desired[id] ?? {...previous,amount:0,sourceIds:[]};
    if (stableJSON(previous)===stableJSON(next)) continue;
    if ((previous?.amount ?? 0)!==next.amount) {
      instant(at); requireId(eventId); const adjustmentId=`${eventId}:${index++}`;
      check(!state.rewardAdjustments[adjustmentId], 'Reward adjustment ID is already in use.');
      state.rewardAdjustments[adjustmentId]={id:adjustmentId,entitlementId:id,from:previous?.amount ?? 0,to:next.amount,at,reason,eventIds:[...eventIds],ruleVersion:RULE_VERSION};
    }
    state.rewardLedger[id]=next;
  }
  return state;
}
export function rewardTransition(before, proposed, audit) {
  const events=Object.values(proposed.events).filter(event=>!before.events[event.id]);
  const labels={undo:'undo progress change','play-edit':'finish or playthrough correction',status:'play status change',journal:'journal update',wishlist:'wishlist decision'};
  const reason=events.length ? [...new Set(events.map(event=>labels[event.type] ?? event.type))].join(', ') : audit?.reason;
  return reconcileRewards(captureRewardEvidence(before,captureChallenges(before,proposed,audit)),{...audit,reason,eventIds:events.map(event=>event.id)});
}
export const rewardTotal = state => Object.values(state.rewardLedger).reduce((sum,entry)=>sum+entry.amount,0);
// What each kind of reward is for, in the words the Progress tab and "+XP" moments use.
export const REWARD_LABELS = { finish:'Game finished', past:'Past finish logged', reflection:'Reflection written', mastery:'Mastery reached', review:'Wishlist review', decision:'Decision made', challenge:'Challenge complete', list:'List complete' };
// Ledger entries whose balance moved between two states: [{ type, amount }] (amount < 0 after an undo).
export function rewardChanges(before, after) {
  const changes=[];
  for (const [id,entry] of Object.entries(after.rewardLedger)) { const was=before.rewardLedger[id]?.amount ?? 0; if (entry.amount!==was) changes.push({type:entry.type,amount:entry.amount-was}); }
  return changes;
}
// XP earned so far, by kind, largest first.
export function xpBreakdown(state) {
  const totals={};
  for (const entry of Object.values(state.rewardLedger)) if (entry.amount) totals[entry.type]=(totals[entry.type] ?? 0)+entry.amount;
  return Object.entries(totals).map(([type,amount])=>({type,amount,label:REWARD_LABELS[type] ?? type})).sort((a,b)=>b.amount-a.amount||a.type.localeCompare(b.type));
}
// Each level needs `step` more XP than the one before (100, 200, 300 … by default), so a
// big clean-up of past finishes moves you along without making later levels meaningless.
export const levelStart = (level, step) => step * (level - 1) * level / 2;
export function levelFor(total, step) { let level = 1; while (levelStart(level + 1, step) <= total) level++; return level; }
// Every level has its own title; past the last one you keep it. The original titles keep
// their levels (Wayfinder 3, Chronicler 5, Archivist 10, Curator 15, Legend 20).
export const LEVEL_NAMES = ['Explorer', 'Player Two', 'Wayfinder', 'Cartridge Blower', 'Chronicler', 'Side Quester', 'Save Point Regular', 'Combo Breaker', 'Boss Hunter', 'Archivist',
  'Dungeon Delver', 'Speedrunner', 'Secret Finder', 'High Scorer', 'Curator', 'Lore Keeper', 'Treasure Hunter', 'Arcade Champion', 'Grand Master', 'Legend',
  'Hall of Famer', 'Platinum Hunter', 'Time Traveller', 'Cabinet Collector', 'Mythic', 'Living Archive', 'Final Boss', 'New Game Plus', 'Perfect Run', 'Eternal'];
export const LEVEL_TITLES = LEVEL_NAMES.map((title, index) => [index + 1, title]).reverse();
export const levelTitle = level => LEVEL_NAMES[Math.min(level, LEVEL_NAMES.length) - 1];
// The next title up and the XP still needed for it, or null at the top.
export function nextTitle(total, step) {
  const level=levelFor(total,step), next=[...LEVEL_TITLES].reverse().find(([min])=>min>level);
  return next ? { level:next[0], title:next[1], xp:levelStart(next[0],step)-total } : null;
}
export function levelProgress(state) {
  const total=rewardTotal(state), step=profileFor(state)?.levelStep ?? 100, level=levelFor(total,step), start=levelStart(level,step), end=levelStart(level+1,step);
  return {total,step,level,within:total-start,next:end-total,span:end-start,title:levelTitle(level)};
}
export function setRewardPreferences(current,{levelStep,frame,visible,expected}) {
  const state=clone(current), profile=profileFor(state); check(profile,'Enable rewards first.');
  if (expected !== undefined) check(stableJSON(profile)===stableJSON(expected),'Progress preferences changed. Reopen them before saving.');
  check(Number.isInteger(levelStep)&&levelStep>=50&&levelStep<=1000,'Choose 50–1,000 XP per level.');
  check(['plain','brass','folio'].includes(frame),'Unknown card frame.');
  const level=levelFor(rewardTotal(state),levelStep);
  check(frame==='plain'||level>=(frame==='brass'?2:5),'That cosmetic frame is not unlocked at this level.');
  check(typeof visible==='boolean','Invalid visibility preference.');
  Object.assign(profile,{levelStep,frame}); state.settings.gamificationVisible=visible; return state;
}
export function visibleFrame(state) {
  if (!state.settings.gamificationVisible) return 'plain';
  const frame=profileFor(state)?.frame, level=levelProgress(state).level;
  return frame==='brass'&&level>=2||frame==='folio'&&level>=5?frame:'plain';
}
export function linkRewardIdentity(current,{first,second,confirmed,active=true,at,eventId}) {
  check(profileFor(current),'Enable rewards first.'); instant(at); requireId(eventId); check(typeof active==='boolean','Invalid reward link.');
  check(confirmed===true,'Confirm the same game and edition before linking rewards.');
  check(first!==second&&current.targets[first]&&current.targets[second],'Choose two distinct tracked games.');
  const state=clone(current), targetIds=[first,second].sort(), id=`reward-link:${eventId}`;
  state.rewardLinks[id]={id,targetIds,active,confirmedAt:at};
  return reconcileRewards(state,{at,eventId,reason:'confirmed reward identity link'});
}
export function unlinkRewardIdentity(current,{id,at,eventId}) {
  const state=clone(current); check(state.rewardLinks[id],'This reward link is missing.');
  state.rewardLinks[id].active=false;
  return reconcileRewards(state,{at,eventId,reason:'reward identity link corrected'});
}
export function saveWeeklyGoal(current,{slot,type,targetId=null,count=1,expected,skipped=false,at,eventId}) {
  const state=clone(current), profile=profileFor(state); check(profile,'Enable rewards first.');
  const week=weekKey(at,profile.timeZone), id=`${week}:${slot}`, previous=state.weeklyGoals[id] ?? null;
  check(stableJSON(previous)===stableJSON(expected),'This weekly goal changed. Reopen it before saving.');
  check(Number.isInteger(slot)&&slot>=0&&slot<3,'Choose one of the three weekly slots.');
  check(['continue','milestone','review'].includes(type),'Choose a supported weekly goal.');
  check(type==='review'&&targetId===null||type!=='review'&&Boolean(state.targets[targetId]),'Choose a tracked game.');
  check(Number.isInteger(count)&&count>=1&&count<=(type==='review'?10:1),'Choose 1–10 wishlist reviews, or one play/milestone goal.');
  state.weeklyGoals[id]={id,week,slot,type,targetId,count,status:skipped?'skipped':'active',acceptedAt:at,
    afterSequence:Object.values(state.events).reduce((max,event)=>Math.max(max,event.sequence ?? 0),0)};
  // Goal changes have their own trace even though they do not award XP.
  state.progression[`goal-change:${eventId}`]={id:`goal-change:${eventId}`,at,goalId:id,previous:clone(previous),result:clone(state.weeklyGoals[id])};
  return state;
}
export function weeklyGoalProgress(state,goal) {
  if (goal.status==='skipped') return {done:false,count:0,status:'Skipped'};
  const profile=profileFor(state), groups=rewardGroups(state), matches=new Set(), undone=undoneEvents(state);
  for (const evidence of Object.values(state.rewardEvidence)) {
    const event=state.events[evidence.eventId];
    if (evidence.week!==goal.week||evidence.recordedAt<goal.acceptedAt||(event.sequence ?? 0)<=goal.afterSequence||!evidenceIsValid(state,evidence,undone)) continue;
    if (['note','milestone','mastery'].includes(evidence.type)) {
      const entry=state.journalEntries[evidence.subjectId];
      if (!entry.occurredOn || entry.occurredOn<localDay(goal.acceptedAt,profile.timeZone) || entry.occurredOn>localDay(evidence.recordedAt,profile.timeZone)) continue;
    }
    if (goal.type==='review'&&evidence.type==='review') matches.add(groups.get(evidence.targetId));
    if (goal.type==='continue'&&evidence.targetId===goal.targetId&&['session','note'].includes(evidence.type)) matches.add(evidence.id);
    if (goal.type==='milestone'&&evidence.targetId===goal.targetId&&['milestone','mastery'].includes(evidence.type)) matches.add(evidence.id);
  }
  const count=Math.min(goal.count,matches.size); return {done:count>=goal.count,count,status:count>=goal.count?'Complete':'In progress'};
}

export function mergeRewardProfiles(current,incoming,state) {
  const a=profileFor(current),b=profileFor(incoming),profile=profileFor(state);
  if (a&&b) check(a.timeZone===b.timeZone,'Reward calendars use different timezones. Restore this backup in a separate browser workspace.');
  if (!profile) return state;
  profile.startedAt=[a?.startedAt,b?.startedAt].filter(Boolean).sort()[0];
  const importedFinishes=Object.values(incoming.playthroughs).filter(play=>play.status==='finished'&&!state.rewardEvidence[`finish:${play.id}`]).map(play=>play.targetId);
  if (!a) importedFinishes.push(...Object.values(current.playthroughs).filter(play=>play.status==='finished'&&!state.rewardEvidence[`finish:${play.id}`]).map(play=>play.targetId));
  profile.baselineFinishedTargets=[...new Set([...(a?.baselineFinishedTargets??[]),...(b?.baselineFinishedTargets??[]),...importedFinishes])].sort();
  return state;
}

export function validateRewards(state) {
  const profile=profileFor(state);
  const hasTarget=id=>check(Boolean(state.targets[requireId(id)]),'Reward refers to a missing game.');
  if (profile) {
    check(profile.id==='profile'&&profile.ruleVersion===1,'Unsupported reward rules.'); check(typeof profile.timeZone==='string'&&profile.timeZone.length>0,'Invalid reward timezone.'); instant(profile.startedAt); localDay(profile.startedAt,profile.timeZone);
    check(Number.isInteger(profile.levelStep)&&profile.levelStep>=50&&profile.levelStep<=1000,'Invalid level curve.');
    check(['plain','brass','folio'].includes(profile.frame),'Invalid cosmetic frame.');
    check(Array.isArray(profile.baselineFinishedTargets)&&new Set(profile.baselineFinishedTargets).size===profile.baselineFinishedTargets.length,'Invalid reward baseline.'); profile.baselineFinishedTargets.forEach(hasTarget);
  } else check(REWARD_SECTIONS.every(section=>Object.keys(state[section]).length===0),'Reward data needs an enabled profile.');
  for (const [id,entry] of Object.entries(state.progression)) if (id!=='profile') {
    check(entry.id===id&&id.startsWith('goal-change:'),'Invalid progression record.'); instant(entry.at); check(state.weeklyGoals[entry.goalId],'Goal history refers to a missing goal.');
  }
  for (const [id,evidence] of Object.entries(state.rewardEvidence)) {
    check(evidence.id===id&&evidence.ruleVersion===1&&['finish','reflection','review','session','note','milestone','mastery','decision','past'].includes(evidence.type),'Invalid reward evidence.'); hasTarget(evidence.targetId);
    check(id===`${evidence.type}:${evidence.subjectId}`,'Invalid reward evidence identity.');
    const event=state.events[evidence.eventId]; check(event&&event.targetId===evidence.targetId&&event.recordedAt===evidence.recordedAt,'Reward evidence refers to a different event.');
    check(evidence.week===weekKey(evidence.recordedAt,profile.timeZone),'Invalid reward week.');
    if (['finish','reflection'].includes(evidence.type)) check(state.playthroughs[evidence.subjectId]?.targetId===evidence.targetId&&event.details.playthroughId===evidence.subjectId,'Reward playthrough is missing.');
    if (['note','milestone','mastery'].includes(evidence.type)) check(state.journalEntries[evidence.subjectId]?.targetId===evidence.targetId&&event.details.entryId===evidence.subjectId,'Reward journal entry is missing.');
    if (evidence.type==='review') check(event.type==='wishlist'&&event.details.reviewSessionId&&evidence.subjectId===event.id,'Reward needs an explicit wishlist review.');
    if (evidence.type==='session') check(evidence.subjectId===event.id&&(event.type==='start'||event.type==='status'&&event.details.result?.status==='playing'),'Reward needs a start or resume.');
  }
  for (const [id,link] of Object.entries(state.rewardLinks)) {
    check(link.id===id&&Array.isArray(link.targetIds)&&link.targetIds.length===2&&new Set(link.targetIds).size===2&&typeof link.active==='boolean','Invalid reward identity link.'); link.targetIds.forEach(hasTarget); instant(link.confirmedAt);
  }
  const desired=rewardEntitlements(state);
  for (const [id,entry] of Object.entries(state.rewardLedger)) {
    check(entry.id===id&&entry.ruleVersion===1&&(Object.hasOwn(REWARD_POINTS,entry.type)||['challenge','list'].includes(entry.type))&&Number.isInteger(entry.amount)&&entry.amount>=0&&(entry.type==='challenge'?entry.amount<=challengeBonusLimit(state,entry.subjectId):entry.type==='list'?entry.amount<=listXpLimit(state,entry.subjectId):[0,REWARD_POINTS[entry.type]].includes(entry.amount)),'Invalid reward ledger record.');
    check(entry.amount===(desired[id]?.amount??0),'Reward ledger disagrees with its evidence.');
    if (desired[id]) check(stableJSON(entry)===stableJSON(desired[id]),'Reward ledger has different evidence.');
    check(Array.isArray(entry.sourceIds)&&entry.sourceIds.every(source=>entry.type==='challenge'?state.challengeAwards[source]:entry.type==='list'?state.listAwards[source]:state.rewardEvidence[source]),'Missing reward evidence.');
  }
  for (const id of Object.keys(desired)) check(state.rewardLedger[id],'A reward is missing its ledger record.');
  for (const [id,entry] of Object.entries(state.rewardAdjustments)) {
    const ledger=state.rewardLedger[entry.entitlementId];
    check(entry.id===id&&entry.ruleVersion===1&&ledger&&(ledger.type==='challenge'?[entry.from,entry.to].every(amount=>Number.isInteger(amount)&&amount>=0&&amount<=challengeBonusLimit(state,ledger.subjectId)):ledger.type==='list'?[entry.from,entry.to].every(amount=>Number.isInteger(amount)&&amount>=0&&amount<=LIST_XP_LIMIT&&amount%10===0):[entry.from,entry.to].every(amount=>[0,REWARD_POINTS[ledger.type]].includes(amount)))&&entry.from!==entry.to,'Invalid reward adjustment.'); instant(entry.at);
    check(Array.isArray(entry.eventIds)&&entry.eventIds.every(eventId=>state.events[eventId]),'Reward adjustment refers to a missing event.');
  }
  for (const [id,goal] of Object.entries(state.weeklyGoals)) {
    check(goal.id===id&&goal.id===`${goal.week}:${goal.slot}`&&Number.isInteger(goal.slot)&&goal.slot>=0&&goal.slot<3,'Invalid weekly slot.');
    instant(goal.acceptedAt); calendarDate(goal.week); check(weekKey(goal.acceptedAt,profile.timeZone)===goal.week,'Invalid goal week.');
    check(['continue','milestone','review'].includes(goal.type)&&['active','skipped'].includes(goal.status),'Invalid weekly goal.');
    check(Number.isInteger(goal.count)&&goal.count>=1&&goal.count<=(goal.type==='review'?10:1)&&Number.isSafeInteger(goal.afterSequence)&&goal.afterSequence>=0,'Invalid weekly goal target.');
    if (goal.type==='review') check(goal.targetId===null,'Review goals cover the shortlist.'); else hasTarget(goal.targetId);
  }
}
