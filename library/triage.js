import { escapeHtml as esc } from '../lib.js';
import { triageQueue, TRIAGE_LABELS } from '../tracking/triage.js';
import { ratingText } from '../tracking/score.js';
import { awardSummary } from '../tracking/awards.js';
import { vgcLineHtml } from './score-ui.js';
import { localDate } from './wishlist-planning.js';
import { storeKey } from './core.js';
import { sendOff, bringBack } from './motion.js';

const SESSION_SIZE = 10;
const KEYS = { 1: 'soon', 2: 'maybe', 3: 'played', 4: 'pass' };
// Where a decided card goes, and the stamp it gets on the way.
const SEND_OFF = { soon: ['right', 'Play soon'], maybe: ['down', 'Maybe later'], played: ['right', 'Played'], pass: ['left', 'Not for me'], skip: ['up', 'Skipped'] };
const DONE_TEXT = { soon: 'Added to Up Next in My plan.', maybe: 'We’ll ask again in about three months.', played: 'Marked finished (date unknown). It won’t come back unless you add it again.', pass: 'It won’t be suggested again. It stays in your library.' };
const PC_SOURCES = new Set(['steam', 'gog', 'epic', 'humble', 'amazon', 'ea app', 'origin', 'ubisoft connect', 'uplay', 'battle net', 'itch io', 'xbox']);
const isPcStore = source => PC_SOURCES.has(storeKey(source));
const platformLabel = name => String(name).replace(/^PC \(Windows\)$/, 'PC').replace(/^Sony /, '').replace(/^Nintendo /, '');

// Backlog triage: ten owned games, one card at a time, best-rated first.
export function setupTriage({ client }) {
  const $ = id => document.getElementById(id), dialog = $('triageDialog');
  let session = null;

  // Skipped games stay out of later batches for the rest of the day (this browser only).
  const skipKey = () => `retro-library.triage-skipped.v1:${client.namespace}:${localDate()}`;
  const readSkipped = () => { try { const ids = JSON.parse(localStorage.getItem(skipKey()) ?? '[]'); return new Set(Array.isArray(ids) ? ids.slice(-500) : []); } catch { return new Set(); } };
  const rememberSkip = id => { const ids = readSkipped(); ids.add(id); try { localStorage.setItem(skipKey(), JSON.stringify([...ids])); } catch {} };
  const queue = () => { const skipped = readSkipped(); return triageQueue(client.suggestionChoices(), client.snapshot(), { today: localDate() }).filter(choice => !skipped.has(choice.id)); };

  function renderSummary() {
    const waiting = queue().length;
    $('triageSummary').textContent = waiting
      ? `${waiting.toLocaleString()} owned games have no decision yet. Best-rated first; each card takes a few seconds.`
      : 'Every owned game has a decision. Games marked “Maybe later” come back after three months.';
    $('triageStart').disabled = !waiting;
  }

  function card(choice) {
    const option = choice.option, rating = option.rating;
    const copies = [choice, ...choice.siblings].map(item => item.option);
    const stores = [...new Set(copies.flatMap(item => item.sources))];
    // Playnite leaves some copies without a platform; a PC storefront still means PC.
    const platforms = [...new Set(copies.flatMap(item => item.descriptor.platforms.length ? item.descriptor.platforms : item.sources.some(isPcStore) ? ['PC'] : []).map(platformLabel))];
    const meta = [platforms.join(' · '), stores.join(', '), copies.length > 1 ? `you own ${copies.length} copies` : ''].filter(Boolean).join(' · ');
    const facts = [awardSummary(option.awards)?.headline, option.steam && rating?.source !== 'steam' ? option.steam : null, option.beatHours ? `About ${option.beatHours}h to beat` : null, option.genres.slice(0, 3).join(' · ') || null].filter(Boolean);
    const cover = option.cover ? `<img src="${esc(option.cover)}" alt="">` : `<span>${esc(choice.title.slice(0, 2).toUpperCase())}</span>`;
    return `<article class="triage-card" data-choice="${esc(choice.id)}"${option.cover ? ` style="--art:url('${esc(option.cover)}')"` : ''}>
      <div class="triage-cover">${cover}</div>
      <div class="triage-copy">
        <h2 id="triageDialogTitle">${esc(choice.title)}</h2>
        <p class="triage-meta">${esc(meta)}</p>
        ${rating ? `<p class="triage-score"><strong>${rating.value}</strong><span>${esc(ratingText(rating).replace(/^Score \d+ · /, ''))} · ${esc(rating.via)}</span></p>` : '<p class="triage-score is-empty"><strong>–</strong><span>Not rated yet</span></p>'}
        ${vgcLineHtml(option.vgc)}
        ${facts.length ? `<ul class="triage-facts">${facts.map(fact => `<li>${esc(fact)}</li>`).join('')}</ul>` : ''}
        ${option.summary ? `<p class="triage-summary">${esc(option.summary)}</p>` : ''}
      </div>
    </article>`;
  }

  function render(motion = '') {
    const { games, index, decided, message } = session;
    const done = index >= games.length;
    const counts = Object.fromEntries(Object.keys(TRIAGE_LABELS).map(key => [key, decided.filter(item => item.decision === key).length]));
    $('triageBody').innerHTML = done ? `<div class="triage-done">
        <p class="eyebrow">Session complete</p><h2 id="triageDialogTitle">${decided.length ? 'Nice work.' : 'Nothing decided this time.'}</h2>
        <p>${counts.soon} to play soon · ${counts.maybe} maybe later · ${counts.pass} not for me${games.length - decided.length ? ` · ${games.length - decided.length} skipped` : ''}</p>
        ${counts.soon ? '<p>Your “play soon” games now lead the suggestions in Play Plan.</p>' : ''}
      </div>` : card(games[index]);
    $('triageProgress').textContent = done ? `${games.length} of ${games.length}` : `Game ${index + 1} of ${games.length}`;
    $('triageBar').style.width = `${Math.min(index, games.length) / games.length * 100}%`;
    $('triageActions').hidden = done; $('triageFinish').hidden = !done;
    $('triageUndo').disabled = !decided.length || session.busy;
    for (const button of $('triageActions').querySelectorAll('button[data-triage]')) button.disabled = session.busy;
    $('triageStatus').textContent = message ?? '';
    if (motion) $('triageBody').firstElementChild?.classList.add(motion);
  }

  // While a decision saves, the card stays on screen (it's animating away); only the buttons lock.
  function setBusy(busy) {
    for (const button of $('triageActions').querySelectorAll('button[data-triage]')) button.disabled = busy;
    $('triageUndo').disabled = busy || !session?.decided.length;
  }

  function start() {
    const games = queue().slice(0, SESSION_SIZE);
    if (!games.length) { if (dialog.open) dialog.close(); return renderSummary(); }
    session = { games, index: 0, decided: [], busy: false, message: '' };
    render(); if (!dialog.open) dialog.showModal(); $('triageActions').querySelector('[data-triage="soon"]').focus();
  }

  async function decide(decision) {
    if (!session || session.busy || session.index >= session.games.length) return;
    const choice = session.games[session.index];
    const card = $('triageBody').querySelector('.triage-card');
    session.busy = true; setBusy(true);
    if (decision === 'skip') { rememberSkip(choice.id); await sendOff(card, ...SEND_OFF.skip); if (!session) return; session.busy = false; session.index++; session.message = 'Skipped — it will come up again tomorrow.'; return render('enter'); }
    const [result] = await Promise.all([client.run(() => client.triage(choice, decision, localDate())), sendOff(card, ...SEND_OFF[decision])]);
    if (!session) return; // closed while saving
    session.busy = false;
    if (!result) { bringBack(card); session.message = 'That decision could not be saved. Check Backup & import, then try again.'; return render(); }
    session.decided.push({ choice, decision, undo: result.undo, index: session.index });
    session.index++; session.message = `${TRIAGE_LABELS[decision]}: ${choice.title}. ${DONE_TEXT[decision]}`;
    render('enter');
  }

  async function undo() {
    const last = session?.decided.at(-1);
    if (!last || session.busy) return;
    session.busy = true; render();
    const result = await client.run(() => client.undoTriage(last.choice, last.undo));
    session.busy = false;
    if (result) { session.decided.pop(); session.index = last.index; session.message = `Undone: ${last.choice.title} is back.`; }
    else session.message = 'Undo could not be saved.';
    render('enter');
  }

  $('triageStart').onclick = start;
  $('triageActions').onclick = event => { const button = event.target.closest('button[data-triage]'); if (button) decide(button.dataset.triage); };
  $('triageUndo').onclick = undo;
  $('triageMore').onclick = () => start();
  $('triageClose').onclick = $('triageDone').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { session = null; renderSummary(); });
  dialog.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (KEYS[key]) { event.preventDefault(); decide(KEYS[key]); }
    else if (key === 's') { event.preventDefault(); decide('skip'); }
    else if (key === 'z' || key === 'backspace') { event.preventDefault(); undo(); }
  });
  return { render: renderSummary };
}
