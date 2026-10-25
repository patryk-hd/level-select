import { showSearchSuggestions } from './search-ui.js';
import { trackingClient } from '../tracking/client.js';
import { titleSearch, matchesSearch } from './core.js';
import { setupTracking, mountTracking, openTrackingBackup, progressLabel } from '../tracking/ui.js';
import { orderedQueue, progress } from '../tracking/compat.js';
import { findTarget } from '../tracking/domain.js';
import { copyApp, escapeHtml as esc } from '../lib.js';
import { setupSuggestions } from './suggestions.js';
import { setupTriage } from './triage.js';
import { setupHome } from './home.js';
import { setupProgress } from './progress.js';
import { mountUpdate } from './update-ui.js';
import { setupChallenges } from './challenges.js';
import { setupGoals } from './goals.js';
import { bindHovercards } from './hovercard.js';
import { setupRewards } from './rewards.js';
import { setupHistory } from './history.js';
import { pageReady } from '../navigation.js';

const $ = id => document.getElementById(id);
const client = await trackingClient(); setupTracking(client); bindHovercards();
const views = { upnext: 'Up Next', playing: 'Playing', paused: 'Paused', backlog: 'Backlog', finished: 'Finished', retired: 'Retired', all: 'All tracked' };
let selectedTarget = '', selectedDescriptors = [], opener;
const suggestions = setupSuggestions({ client, onRouteChange: () => render(), openChoice: choice => openTarget(choice.id, choice.options.map(option => option.descriptor)) });
const triage = setupTriage({ client });
const home = setupHome({ client, openTarget: id => openTarget(id) });
const progressView = setupProgress(client);
const historyAlbum = setupHistory(client);
const rewards = setupRewards(client, openTarget);
const challenges = setupChallenges(client, openTarget);
const goals = setupGoals(client, openTarget);
function route() { const query = new URLSearchParams(location.search); return { view: Object.hasOwn(views, query.get('view')) ? query.get('view') : 'upnext', q: query.get('q') ?? '' }; }
// Plan views always live on the My plan tab, whatever the address bar said when they were drawn.
function url(view = route().view, q = route().q) { const query = new URLSearchParams(location.search); query.set('section', 'plan'); query.set('workspace', client.namespace); query.set('view', view); if (q) query.set('q', q); else query.delete('q'); return `${location.pathname}?${query}`; }
// Quick actions on a plan row. Finishing a game you are playing dates it today; a game
// you finished before is recorded without a date. Every action can be undone.
function planActions(state, target) {
  const status = progress(state, target.id);
  if (['finished', 'retired'].includes(status)) return '';
  const remove = !['playing', 'paused'].includes(status) ? `<button type="button" class="is-quiet" data-plan-action="remove" data-target="${esc(target.id)}">Remove</button>` : '';
  return `<button type="button" data-plan-action="finished" data-target="${esc(target.id)}">Finished</button><button type="button" data-plan-action="retired" data-target="${esc(target.id)}">Retire</button>${remove}`;
}
const PLAN_DONE = { remove: 'removed from your plan', finished: 'marked finished', retired: 'retired' };
let lastPlanAction = null;

function render() {
  const state = client.snapshot(), { view, q } = route(), queue = orderedQueue(state);
  const playing = Object.values(state.playthroughs).filter(play => play.status === 'playing').length;
  const finished = Object.values(state.playthroughs).filter(play => play.status === 'finished').length;
  $('planNamespace').value = client.namespace; $('planSearch').value = q;
  $('planWorkspace').textContent = client.namespace === 'sample' ? 'Sample workspace — separate from your personal tracking.' : client.shared ? 'Saved by Level Select on your computer, for every browser and phone you use.' : copyApp() ? 'Saved on this phone. Each newer copy brings your computer’s plan.' : 'Personal workspace — saved in this browser.';
  $('planOverview').innerHTML = `<p><strong>${queue.length} / ${state.settings.upNextLimit ?? 5}</strong>Up Next · suggested size</p><p><strong>${playing} / ${state.settings.playingLimit ?? 2}</strong>Playing · suggested size</p><p><strong>${finished}</strong>Finished playthroughs</p>`;
  $('planTabs').innerHTML = Object.entries(views).map(([key, label]) => `<a href="${esc(url(key))}" data-view="${key}"${key === view ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  let targets = view === 'upnext' ? queue.map(entry => state.targets[entry.targetId]) : Object.values(state.targets).filter(target => view === 'all' || (view === 'backlog' ? Boolean(state.backlog[target.id]) && !['playing','paused','finished','retired'].includes(progress(state,target.id)) : progress(state,target.id) === view));
  const searchableTargets = targets;
  targets = targets.filter(target => matchesSearch(target,q));
  showSearchSuggestions($('planResults'), targets.length ? targets : searchableTargets, q, title => {
    history.replaceState({},'',url(view,title)); render(); $('planSearch').focus();
  });
  if (view !== 'upnext') targets.sort((a,b) => (q.trim() ? titleSearch(q).compare(a,b) : 0) || (state.backlog[b.id]?.priority ?? 0) - (state.backlog[a.id]?.priority ?? 0) || a.title.localeCompare(b.title));
  $('planCount').textContent = `${targets.length} ${targets.length === 1 ? 'game' : 'games'} · ${views[view]}`;
  $('planResults').innerHTML = targets.length ? targets.map(target => `<article class="plan-row"><div><h2>${esc(target.title)}</h2><p>${esc(target.platforms.join(' · ') || 'Unknown platform')} · ${esc(progressLabel(progress(state,target.id)))}${target.unresolved ? ' · Source currently unavailable' : ''}</p></div><div class="plan-buttons">${view === 'upnext' ? `<button type="button" data-move="-1" data-target="${esc(target.id)}" aria-label="Move ${esc(target.title)} up"${queue[0].targetId === target.id ? ' disabled' : ''}>↑</button><button type="button" data-move="1" data-target="${esc(target.id)}" aria-label="Move ${esc(target.title)} down"${queue.at(-1).targetId === target.id ? ' disabled' : ''}>↓</button>` : ''}${planActions(state, target)}<button type="button" data-open="${esc(target.id)}">Details</button></div></article>`).join('') : `<div class="plan-empty"><h2>${q ? 'No games match this search.' : 'Choose your next game.'}</h2><p>${q ? 'Try different words from the game title.' : 'Add an owned game, a recommendation, or a manual entry. Keep the queue as small as you like.'}</p><button type="button" data-add>Add games</button></div>`;
  $('upNextLimit').value = state.settings.upNextLimit ?? 5; $('playingLimit').value = state.settings.playingLimit ?? 2;
  suggestions.render();
  triage.render();
  home.render();
  progressView.render();
  historyAlbum.render();
  rewards.render();
  goals.render();
  challenges.render();
}
function openTarget(id, descriptors = []) {
  const state = client.snapshot(), target = state.targets[id]; if (!target && !descriptors.length) return;
  selectedTarget = id; selectedDescriptors = descriptors; $('planDetailsTitle').textContent = target?.title ?? descriptors[0].title;
  mountTracking($('planTracking'), client, descriptors.length ? descriptors : [{ ref: target.refs[0], title: target.title, platforms: target.platforms, unresolved: target.unresolved }]);
  const annotations = Object.values(state.annotations).filter(item => item.targetId === id && item.notes);
  $('planNotes').innerHTML = annotations.length ? `<h3>Saved notes</h3>${annotations.map(item => `<p><small>${esc(item.source.provider)}</small><br>${esc(item.notes)}</p>`).join('')}` : '';
  if (!$('planDetails').open) { opener = document.activeElement; $('planDetails').showModal(); }
}
function candidates() {
  const q = $('candidateSearch').value.toLowerCase().trim(), source = $('candidateSource').value;
  let descriptors = source === 'owned' ? client.library.flatMap(game => game.copies.map(copy => ({ ...client.descriptor('playnite',copy.id), sources:copy.sources }))) : source === 'wishlist' ? client.wishlist.map(game => client.descriptor('steam',game.appid)) : client.catalog.games.map(game => client.descriptor('catalog',game.id));
  const searchableDescriptors = descriptors;
  descriptors = descriptors.filter(desc => matchesSearch(desc,q));
  showSearchSuggestions($('planCandidates'), descriptors.length ? descriptors : searchableDescriptors, q, title => {
    $('candidateSearch').value = title; candidates(); $('candidateSearch').focus();
  });
  if (q.trim()) descriptors.sort(titleSearch(q).compare);
  descriptors = descriptors.slice(0,30);
  const state = client.snapshot();
  $('planCandidates').innerHTML = descriptors.length ? descriptors.map((desc,index) => { const target = findTarget(state,desc.ref), added = Boolean(state.backlog[target?.id]); return `<div class="plan-candidate"><span>${esc(desc.title)}<small>${esc(desc.platforms.join(' · '))}${desc.sources?.length ? ` · ${esc(desc.sources.join(', '))}` : ''}</small></span><button type="button" data-candidate="${index}"${added ? ' disabled' : ''}>${added ? 'Added' : 'Add'}</button></div>`; }).join('') : '<p>No matching games in this workspace. Try Game Atlas or add a game manually.</p>';
  $('planCandidates').querySelectorAll('[data-candidate]').forEach(button => { button.onclick = async () => { const desc = descriptors[Number(button.dataset.candidate)]; const result = await client.run(()=>client.action(desc,'queue')); if(result) $('addStatus').textContent = `${desc.title} added${result.saved ? '.' : ' for this session. Export a backup to keep it.'}`; candidates(); }; });
}
function openAdd() { opener = document.activeElement; $('addStatus').textContent = ''; candidates(); $('addGamesDialog').showModal(); }
$('planTabs').onclick = event => { const link = event.target.closest('a'); if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); history.pushState({},'',link.href); render(); };
$('planSearch').oninput = event => { history.replaceState({},'',url(route().view,event.target.value)); render(); $('planSearch').focus(); };
$('planNamespace').onchange = event => { const target = new URL(location.href); target.searchParams.set('workspace',event.target.value); location.href=target; };
$('planBackup').onclick = () => openTrackingBackup(client);
$('planUpdate').onclick = () => { const dialog = $('updateDialog'); dialog.showModal(); mountUpdate(dialog); };
$('updateDialog').querySelector('[data-close-dialog]').onclick = () => $('updateDialog').close(); $('addGames').onclick = openAdd;
$('planResults').onclick = async event => {
  const action = event.target.closest('[data-plan-action]');
  if (action) {
    const target = client.snapshot().targets[action.dataset.target], kind = action.dataset.planAction;
    const result = await client.run(() => client.planAction(kind, action.dataset.target));
    if (result) { lastPlanAction = { targetId: action.dataset.target, point: result.point }; showPlanStatus(`${target?.title ?? 'Game'} ${PLAN_DONE[kind]}.`, true); }
    render(); return;
  }
  const button = event.target.closest('button'); if (!button) return;
  if (button.hasAttribute('data-add')) openAdd();
  if (button.dataset.open) openTarget(button.dataset.open);
  if (button.dataset.move) { await client.run(()=>client.move(button.dataset.target,Number(button.dataset.move))); render(); const replacement = [...$('planResults').querySelectorAll('[data-move]')].find(item=>item.dataset.target===button.dataset.target&&item.dataset.move===button.dataset.move); replacement?.focus(); }
};
$('candidateSearch').oninput = candidates; $('candidateSource').onchange = candidates;
$('manualGame').onsubmit = async event => {
  event.preventDefault(); const values = new FormData(event.target), title = values.get('title').trim(), platform=values.get('platform').trim(); if (!title) return;
  const result = await client.run(()=>client.action({ ref:{provider:'manual',id:crypto.randomUUID()}, title, platforms:platform?[platform]:[] },'queue'));
  if(result) { event.target.reset(); $('addStatus').textContent=`${title} added${result.saved ? '.' : ' for this session. Export a backup to keep it.'}`; }
};
$('planPreferences').onsubmit = async event => { event.preventDefault(); await client.run(()=>client.setLimits(Number($('upNextLimit').value),Number($('playingLimit').value))); };
document.querySelectorAll('[data-close]').forEach(button=>{button.onclick=()=>button.closest('dialog').close();});
for(const id of ['planDetails','addGamesDialog']) $(id).addEventListener('close',()=>opener?.isConnected&&opener.focus());
window.addEventListener('popstate',render);
client.subscribe(change=>{ render(); if($('addGamesDialog').open)candidates(); if(change.type==='refresh'&&$('planDetails').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))openTarget(selectedTarget, selectedDescriptors); });
render();
pageReady();

function showPlanStatus(message, undo = false) {
  $('planActionStatus').innerHTML = `${esc(message)}${undo ? ' <button type="button" class="text-button" data-plan-undo>Undo</button>' : ''}`;
}
$('planActionStatus').onclick = async event => {
  if (!event.target.closest('[data-plan-undo]') || !lastPlanAction) return;
  const result = await client.run(() => client.undoPlanAction(lastPlanAction.targetId, lastPlanAction.point));
  if (result) { lastPlanAction = null; showPlanStatus('Undone.'); }
  render();
};
