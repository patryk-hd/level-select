import { escapeHtml as esc } from '../lib.js';
import { profileFor, levelProgress, levelFor, visibleFrame, weekKey, weeklyGoalProgress } from '../tracking/rewards.js';

const goalLabels = { continue: 'Continue a game', milestone: 'Reach a milestone', review: 'Review my wishlist' };
const rewardLabels = { finish: 'Finished', past: 'Played before', decision: 'Decision', reflection: 'Reflection', mastery: 'Additional mastery', review: 'Ten wishlist reviews', challenge: 'Challenge completed' };
export function setupRewards(client, openTarget) {
  const host = document.getElementById('progressRewards');
  const now = () => new Date().toISOString();
  function dialog(title) {
    const opener = document.activeElement, node = document.createElement('dialog');
    node.id = 'rewardEditor'; node.className = 'tracking-dialog'; node.setAttribute('aria-labelledby','rewardEditorTitle');
    node.innerHTML = `<header><h2 id="rewardEditorTitle">${esc(title)}</h2><button type="button" data-close>Cancel</button></header>`;
    node.querySelector('[data-close]').onclick = () => node.close();
    node.addEventListener('close', () => { node.remove(); if (opener?.isConnected) opener.focus(); else host.querySelector('button')?.focus(); }, {once:true});
    document.body.append(node); return node;
  }
  function targetOptions(state, selected) {
    return Object.values(state.targets).sort((a,b)=>a.title.localeCompare(b.title)).map(target=>`<option value="${esc(target.id)}"${target.id===selected?' selected':''}>${esc(target.title)} · ${esc(target.platforms.join(', ') || 'Platform unknown')} · ${esc(target.refs.map(ref=>ref.provider).join('/'))}</option>`).join('');
  }
  async function submit(node, operation) {
    const status = node.querySelector('[role=status]'), buttons = node.querySelectorAll('button:not([data-close])');
    buttons.forEach(button=>button.disabled=true);
    try {
      const result = await operation();
      if (result.saved) node.close(); else status.textContent = 'Session only — export a tracking backup before leaving.';
    } catch (error) { status.textContent = error.message; }
    buttons.forEach(button=>button.disabled=false);
  }
  function editGoal(slot) {
    const state = client.snapshot(), week = weekKey(now(),profileFor(state).timeZone), expected = state.weeklyGoals[`${week}:${slot}`] ?? null;
    const node = dialog(`${expected?'Replace':'Choose'} weekly goal ${slot+1}`);
    node.insertAdjacentHTML('beforeend', `<p>Choose something small for the week of ${week}. Only activity recorded after you save this goal counts. Replacing a goal starts its progress again; skipping costs nothing.</p><form>
      <label>Goal<select name="type">${Object.entries(goalLabels).map(([key,label])=>`<option value="${key}"${expected?.type===key?' selected':''}>${label}</option>`).join('')}</select></label>
      <label data-target>Tracked game<select name="targetId">${targetOptions(state,expected?.targetId)}</select></label>
      <label data-count>Distinct games to review<input name="count" type="number" min="1" max="10" value="${expected?.type==='review'?expected.count:10}" required></label>
      <p data-help class="tracking-meta"></p><div class="tracking-actions"><button type="submit">Save goal</button>${expected?'<button type="button" data-skip>Skip this week</button>':''}</div><p role="status"></p></form>`);
    const form = node.querySelector('form');
    function updateType() {
      const type=form.elements.type.value;
      node.querySelector('[data-target]').hidden=type==='review'; form.elements.targetId.disabled=type==='review'; form.elements.targetId.required=type!=='review';
      node.querySelector('[data-count]').hidden=type!=='review'; form.elements.count.disabled=type!=='review';
      node.querySelector('[data-help]').textContent=type==='continue'?'Start or resume this game, or add a dated session note in its journal.':type==='milestone'?'Record a dated, achieved milestone or mastery objective in this game’s journal.':'Use a wishlist review session. Keeping a game counts just as much as archiving it. Goals themselves grant no extra XP.';
    }
    form.elements.type.onchange=updateType; updateType();
    function save(skipped=false) {
      // A form left open over a week boundary must never silently move the goal.
      if (weekKey(now(),profileFor(client.snapshot()).timeZone)!==week) { node.querySelector('[role=status]').textContent='A new week has started. Reopen this goal to choose for the new week.'; return; }
      const type = skipped ? expected.type : form.elements.type.value;
      submit(node,()=>client.saveWeeklyGoal({slot,type,expected,skipped,targetId:skipped?expected.targetId:type==='review'?null:form.elements.targetId.value,count:skipped?expected.count:type==='review'?Number(form.elements.count.value):1}));
    }
    form.onsubmit=event=>{event.preventDefault();save();}; node.querySelector('[data-skip]')?.addEventListener('click',()=>save(true)); node.showModal();
  }
  function preferences() {
    const state=client.snapshot(), profile=profileFor(state), level=levelProgress(state);
    const node=dialog('Progress preferences');
    node.insertAdjacentHTML('beforeend', `<form><label>XP per level<input name="levelStep" type="number" min="50" max="1000" step="1" value="${profile.levelStep}" required></label><p class="tracking-meta">Each level needs this much more XP than the one before (100 by default). Changing the curve changes your level and cosmetic unlocks, never your earned XP.</p><label>Completion card frame<select name="frame"><option value="plain">Plain · always available</option><option value="brass">Brass · level 2</option><option value="folio">Folio · level 5</option></select></label><p class="tracking-meta">Titles: Explorer → Wayfinder (3) → Chronicler (5) → Archivist (10). All library features are available at every level.</p><button type="submit">Save preferences</button><p role="status"></p></form>`);
    const form=node.querySelector('form'); form.elements.frame.value=visibleFrame(state);
    const update=()=>{const proposed=levelFor(level.total,Number(form.elements.levelStep.value));for(const option of form.elements.frame.options) option.disabled=option.value==='brass'&&proposed<2||option.value==='folio'&&proposed<5;if(form.elements.frame.selectedOptions[0]?.disabled)form.elements.frame.value='plain';};
    form.elements.levelStep.oninput=update;update();
    form.onsubmit=event=>{event.preventDefault();submit(node,()=>client.rewardPreferences({expected:profile,levelStep:Number(form.elements.levelStep.value),frame:form.elements.frame.value,visible:client.snapshot().settings.gamificationVisible}));};node.showModal();
  }
  function linkIdentity(id) {
    const state=client.snapshot(), link=state.rewardLinks[id], node=dialog(link?'Correct a reward link':'Link duplicate game rewards');
    let preview=null;
    node.insertAdjacentHTML('beforeend', `<p>${link?'Separating these identities recalculates rewards for each game.':'Link only copies of the same game and edition. Distinct editions can remain separate.'} Playthroughs, notes and ownership stay on their original records. First-finish, mastery and weekly distinct-game eligibility are combined while linked.</p><form>
      ${link?`<p>${link.targetIds.map(targetId=>esc(state.targets[targetId].title)).join(' ↔ ')}</p>`:`<label>First game<select name="first">${targetOptions(state)}</select></label><label>Second game<select name="second">${targetOptions(state)}</select></label>`}
      <button type="button" data-preview-link>Preview XP adjustment</button><p data-impact aria-live="polite"></p>
      <label class="history-check"><input type="checkbox" name="confirmed" required> ${link?'I reviewed this correction.':'I confirm these are the same game and edition.'}</label><button type="submit" disabled data-confirm-link>${link?'Separate rewards':'Confirm reward link'}</button><p role="status"></p></form>`);
    const form=node.querySelector('form');
    form.onchange=event=>{if(event.target.tagName==='SELECT'){preview=null;node.querySelector('[data-confirm-link]').disabled=true;node.querySelector('[data-impact]').textContent='Preview the changed selection again.';}};
    node.querySelector('[data-preview-link]').onclick=()=>{
      try { preview=client.previewRewardLink(link?{id}:{first:form.elements.first.value,second:form.elements.second.value});const delta=preview.after-preview.before;node.querySelector('[data-impact]').textContent=`${preview.before} XP → ${preview.after} XP (${delta>0?'+':''}${delta} XP). This adjustment will be saved in your reward history.`;node.querySelector('[data-confirm-link]').disabled=false; }
      catch(error){node.querySelector('[role=status]').textContent=error.message;}
    };
    form.onsubmit=event=>{event.preventDefault();if(preview)submit(node,()=>client.confirmRewardLink(preview,form.elements.confirmed.checked));};node.showModal();
  }
  function render() {
    const openDetails=[...host.querySelectorAll('details[open]')].map(node=>node.dataset.details), focused=host.contains(document.activeElement)?document.activeElement.id:null;
    const state=client.snapshot(),profile=profileFor(state),visible=state.settings.gamificationVisible;
    host.innerHTML=`<header><div><p class="eyebrow">A little encouragement</p><h2 id="rewardsTitle">This week, at your pace</h2></div>${profile?`<div class="tracking-actions">${visible?'<button id="rewardPreferences" type="button">Preferences</button>':''}<button id="rewardVisibility" type="button" aria-expanded="${visible}" aria-controls="rewardBody">${visible?'Hide progress rewards':'Show progress rewards'}</button></div>`:''}</header>`;
    if(!profile) {
      host.insertAdjacentHTML('beforeend','<p>Optional XP, cosmetic levels and three small weekly goals. Rewards start when you enable them; existing finishes and imports earn no new points.</p><button id="enableRewards" type="button">Enable progress rewards</button>');
      host.querySelector('#enableRewards').onclick=()=>client.run(()=>client.enableRewards());return;
    }
    const week=weekKey(now(),profile.timeZone);
    host.querySelector('#rewardVisibility').onclick=()=>client.run(()=>client.rewardPreferences({expected:profile,levelStep:profile.levelStep,frame:visibleFrame({...state,settings:{...state.settings,gamificationVisible:true}}),visible:!visible}));
    host.insertAdjacentHTML('beforeend',`<div id="rewardBody"${visible?'':' hidden'}><p class="reward-help">Week of ${week} · ${esc(profile.timeZone)} · Monday start. Choose up to three goals. No streaks, deadlines to catch up on, or missed-week penalties.</p><div class="weekly-goals">${[0,1,2].map(slot=>{
        const goal=state.weeklyGoals[`${week}:${slot}`],progress=goal&&weeklyGoalProgress(state,goal);
        return `<article class="weekly-goal" data-goal-slot="${slot}"><p class="eyebrow">Goal ${slot+1}</p><h4>${goal?goalLabels[goal.type]:'Leave some room'}</h4><p>${goal?esc(goal.type==='review'?`${goal.count} distinct wishlist games`:state.targets[goal.targetId].title):'One small step is enough.'}</p>${goal?`<p class="goal-status">${progress.status} · ${progress.count} / ${goal.count}</p>`:''}<div class="tracking-actions"><button id="editGoal${slot}" type="button" data-goal="${slot}">${goal?'Replace or skip':'Choose a goal'}</button>${goal?.status==='active'&&!progress.done?(goal.type==='review'?`<a href="wishlist.html?workspace=${client.namespace}">Open wishlist</a>`:`<button type="button" data-goal-track="${esc(goal.targetId)}">Track game</button>`):''}</div></article>`;
      }).join('')}</div>
      <details data-details="rules"><summary>How XP works</summary><ul><li>100 XP when you finish a game (once per game; replays don't repeat it).</li><li>100 XP for each game you mark as played or finished before, once per game.</li><li>2 XP for every triage decision and every wishlist review decision — keeping counts the same as removing.</li><li>50 XP for a dated, achieved additional mastery objective, separate from a main-game finish. One mastery tier per game.</li><li>10 XP for a reflection on each eligible locally finished playthrough. Editing text adds nothing.</li><li>20 XP for reviewing ten distinct games in wishlist review sessions, once per week. Keeps and archives count equally.</li></ul><p>Only activity recorded after activation qualifies. Existing finishes and historical imports never earn first-finish XP. Future dates and a personal objective you haven't written down keep their history without points. Buying, importing, logging time and completing weekly goals grant no additional XP. Corrections reverse invalid rewards and can restore the same reward later.</p><p>Your reward calendar stays in ${esc(profile.timeZone)} even when your device timezone changes. These are personal, locally recorded rewards, not verified platform achievements.</p></details>
      <details data-details="audit"><summary>XP history &amp; adjustments (${Object.keys(state.rewardAdjustments).length})</summary><div class="reward-audit">${Object.values(state.rewardAdjustments).sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id)).slice(0,100).map(entry=>{
        const ledger=state.rewardLedger[entry.entitlementId],label=ledger.type==='reflection'?state.targets[state.playthroughs[ledger.subjectId]?.targetId]?.title:state.targets[ledger.subjectId]?.title;
        return `<p><strong>${entry.to-entry.from>0?'+':''}${entry.to-entry.from} XP</strong> · ${esc(rewardLabels[ledger.type])}${label?` · ${esc(label)}`:''}<br><small>${esc(new Date(entry.at).toLocaleString())} · ${esc(entry.reason)}</small></p>`;
      }).join('')||'<p>No rewards earned yet. Start with a game you want to play.</p>'}</div><p class="reward-help">Showing the latest 100 adjustments. Your backup keeps the full audit trail; the current total counts each reward once.</p></details>
      <details data-details="links"><summary>Duplicate game identities</summary><p>Review duplicate copies before consolidating their reward eligibility.</p><button id="rewardLink" type="button">Link duplicate rewards</button>${Object.values(state.rewardLinks).filter(link=>link.active).map(link=>`<p>${link.targetIds.map(id=>esc(state.targets[id].title)).join(' ↔ ')} <button type="button" data-unlink="${esc(link.id)}">Review separation</button></p>`).join('')}</details>
      <details data-details="past"><summary>Past weekly goals</summary>${Object.values(state.weeklyGoals).filter(goal=>goal.week!==week).sort((a,b)=>b.week.localeCompare(a.week)||a.slot-b.slot).slice(0,30).map(goal=>`<p>${goal.week} · ${goalLabels[goal.type]} · ${esc(goal.targetId?state.targets[goal.targetId].title:`${goal.count} wishlist reviews`)} · ${weeklyGoalProgress(state,goal).status==='In progress'?'Week ended':weeklyGoalProgress(state,goal).status}</p>`).join('')||'<p>Past weeks will appear here. An unfinished goal has no penalty.</p>'}</details></div>`);
    host.querySelector('#rewardPreferences')?.addEventListener('click',preferences);host.querySelector('#rewardLink').onclick=()=>linkIdentity();
    host.querySelectorAll('[data-goal]').forEach(button=>button.onclick=()=>editGoal(Number(button.dataset.goal)));
    host.querySelectorAll('[data-goal-track]').forEach(button=>button.onclick=()=>openTarget(button.dataset.goalTrack));
    host.querySelectorAll('[data-unlink]').forEach(button=>button.onclick=()=>linkIdentity(button.dataset.unlink));
    host.querySelectorAll('details').forEach(node=>node.open=openDetails.includes(node.dataset.details));
    if(focused)document.getElementById(focused)?.focus();
  }
  window.addEventListener('focus',render);
  return { render };
}
