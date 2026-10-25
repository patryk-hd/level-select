import { escapeHtml as esc } from '../lib.js';
import { planStats, membershipChanges, historyRows, selectHistory, yearSummary, dateYear, endDate, objectiveLabel } from '../tracking/history.js';
import { visibleFrame } from '../tracking/rewards.js';
import { openPlaythroughEditor, openJournal } from '../tracking/history-ui.js';

export function setupHistory(client) {
  const $ = id => document.getElementById(id), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systems = new Map(client.catalog.systems.map(system => [system.id, system.name]));
  const labels = { finished: 'Finished', retired: 'Retired', playing: 'Playing', paused: 'Paused', 'not-started': 'Not started' };
  let visibleCount = 12;
  function filters() {
    const query = new URLSearchParams(location.search);
    return { year: query.get('historyYear') || 'all', platform: query.get('historyPlatform') || '', q: query.get('historyQ') || '', status: Object.hasOwn(labels, query.get('historyStatus')) || query.get('historyStatus') === 'all' ? query.get('historyStatus') : 'finished' };
  }
  function changeFilters() {
    const query = new URLSearchParams(location.search);
    for (const key of ['Year','Platform','Status','Q']) {
      const value = $(`history${key}`).value;
      if (value) query.set(`history${key}`,value); else query.delete(`history${key}`);
    }
    history.replaceState({},'',`${location.pathname}?${query}${location.hash}`); visibleCount = 12; render();
  }
  function art(row) {
    const refs = row.play.playedSource ? [row.play.playedSource] : row.target.refs;
    for (const ref of refs) {
      if (ref.provider === 'catalog') {
        const cover = client.catalog.games.find(game => game.id === ref.id)?.cover;
        if (cover?.local || cover?.url) return { src: new URL(cover.local || cover.url, new URL('../',import.meta.url)).href, source: cover.sourceUrl };
      }
      if (ref.provider === 'playnite') {
        const game = client.library.find(game => game.copies.some(copy => copy.id === ref.id));
        if (game?.cover) return { src: new URL(game.cover, import.meta.url).href };
      }
      if (ref.provider === 'steam') {
        const game = client.wishlist.find(game => String(game.appid) === ref.id);
        if (game?.image) return { src: new URL(game.image, import.meta.url).href };
      }
    }
    return null;
  }
  function card(row) {
    let cover; try { cover = art(row); if (cover && !['http:','https:'].includes(new URL(cover.src).protocol)) cover = null; } catch { cover = null; }
    const play = row.play, date = endDate(play), notes = row.journal.filter(entry => !entry.deletedAt);
    return `<article class="completion-card" data-playthrough="${esc(play.id)}"><div class="completion-cover"><span>${esc(row.target.title)}</span>${cover ? `<img src="${esc(cover.src)}" alt="" loading="lazy" decoding="async">` : ''}</div>
      <div class="completion-copy"><p class="completion-kind">${esc(labels[play.status])}${play.historical?' · Imported history':''}</p><h3>${esc(row.target.title)}</h3>
      <p class="completion-platform">${esc(row.platforms.map(id=>systems.get(id)||id).join(' · ') || 'Platform not recorded')}</p><p>${esc(objectiveLabel(play))}</p>
      <p class="completion-date">${date ? esc(new Date(date).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})) : 'Date unknown'}</p>
      <div class="completion-facts"><span>${play.minutesPlayed == null ? 'Time not recorded' : `${(play.minutesPlayed / 60).toLocaleString(undefined,{maximumFractionDigits:1})} h · this playthrough`}</span><span>${play.rating == null ? 'Not rated' : `${play.rating} / 5 · your rating`}</span></div>
      <p class="history-reflection">${esc(play.reflection || 'No reflection yet.')}</p>${notes.length ? `<p>${notes.length} journal ${notes.length===1?'entry':'entries'} · ${notes.filter(entry=>entry.kind!=='note'&&entry.achieved).length} milestones achieved</p>` : ''}
      <div class="tracking-actions"><button type="button" data-edit-play="${esc(play.id)}">Edit record</button><button type="button" data-open-journal="${esc(play.id)}">Journal</button></div>${cover?.source && /^https?:\/\//.test(cover.source) ? `<a class="completion-source" href="${esc(cover.source)}" target="_blank" rel="noopener">Cover source ↗</a>` : ''}</div></article>`;
  }
  function render() {
    const state = client.snapshot(), stats = planStats(state), rows = historyRows(state), selected = filters();
    const completed = stats.completion == null ? 'No plan yet' : `${stats.finished} / ${stats.total} · ${Math.round(stats.completion * 100)}%`;
    $('planStatistics').innerHTML = `<div><p class="eyebrow">Your selected plan</p><h2>${completed}</h2><p>${stats.finished} finished · ${stats.retired} retired · ${stats.remaining} remaining</p></div><p>Finished games ÷ current backlog commitments. Retired games stay in the total. Starting a replay makes that game remaining again; its earlier finish stays in history. Imports do not add commitments.</p>`;
    const years = [...new Set(rows.map(row=>dateYear(endDate(row.play),timeZone)))].sort((a,b)=>a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a));
    const platforms = [...new Set(rows.flatMap(row=>row.platforms))].sort((a,b)=>(systems.get(a)||a).localeCompare(systems.get(b)||b));
    $('historyYear').innerHTML = `<option value="all">All years</option>${years.map(year=>`<option value="${year}">${year==='unknown'?'Unknown dates':year}</option>`).join('')}`;
    if (!['all',...years].includes(selected.year)) $('historyYear').insertAdjacentHTML('beforeend',`<option value="${esc(selected.year)}">${esc(selected.year)} (no records)</option>`);
    $('historyYear').value = selected.year;
    $('historyPlatform').innerHTML = `<option value="">All platforms</option>${platforms.map(id=>`<option value="${esc(id)}">${esc(systems.get(id)||id)}</option>`).join('')}`;
    if (selected.platform && !platforms.includes(selected.platform)) $('historyPlatform').insertAdjacentHTML('beforeend',`<option value="${esc(selected.platform)}">${esc(selected.platform)} (no records)</option>`);
    $('historyPlatform').value = selected.platform; $('historyStatus').value = selected.status; $('historyQ').value = selected.q;
    const summary = yearSummary(rows,selected.year,timeZone), changes = membershipChanges(state,selected.year,timeZone);
    $('historySummary').innerHTML = `<h3>${selected.year==='all'?'All recorded years':selected.year==='unknown'?'Unknown dates':esc(selected.year)} · all games</h3><p>${summary.finished} finished playthroughs · ${summary.retired} retired playthroughs · ${(summary.minutesPlayed/60).toLocaleString(undefined,{maximumFractionDigits:1})} recorded hours across ${summary.timeRecords} timed records.</p><p>${summary.unknownDates} finished/retired records have unknown dates and are kept outside dated albums. Imported lifetime hours are not included.</p><p>${changes.added} plan additions · ${changes.removed} removals · net plan size change ${changes.net > 0?'+':''}${changes.net}. Counts include corrections and repeat commitments.${changes.unknown?' Earlier Up Next changes lack membership details; these change counts are partial.':''}</p>`;
    const filtered = selectHistory(rows,selected,timeZone), shown = filtered.slice(0,visibleCount), albums = new Map();
    for (const row of shown) { const year=dateYear(endDate(row.play),timeZone); if (!albums.has(year)) albums.set(year,[]); albums.get(year).push(row); }
    $('historyCount').textContent = `${filtered.length} playthroughs · ${Math.min(visibleCount,filtered.length)} shown`;
    $('historyCards').dataset.rewardFrame = visibleFrame(state);
    $('historyCards').innerHTML = filtered.length ? [...albums].map(([year,entries])=>`<section class="history-album"><h3>${year==='unknown'?'Dates unknown':year}</h3><div class="completion-grid">${entries.map(card).join('')}</div></section>`).join('') : '<div class="plan-empty"><h3>Your history starts with a playthrough.</h3><p>Record a finish from any Play plan panel, or choose All playthroughs to see notes for games in progress.</p></div>';
    $('historyMore').hidden = filtered.length <= visibleCount;
    $('historyCards').querySelectorAll('img').forEach(img => { img.onerror = () => img.remove(); });
    $('historyCards').querySelectorAll('[data-edit-play]').forEach(button => button.onclick = () => openPlaythroughEditor(client,button.dataset.editPlay,{onSaved:render}));
    $('historyCards').querySelectorAll('[data-open-journal]').forEach(button => button.onclick = () => openJournal(client,button.dataset.openJournal));
  }
  for (const key of ['Year','Platform','Status']) $(`history${key}`).onchange = changeFilters;
  $('historyQ').oninput = changeFilters;
  $('historyMore').onclick = () => { visibleCount += 12; render(); };
  return { render };
}
