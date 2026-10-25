import { escapeHtml as esc } from '../lib.js';
import { continueList } from '../tracking/home.js';
import { entryFor } from '../tracking/wishlist.js';

const SECTIONS = ['home', 'plan', 'challenges', 'history', 'progress'];
const platformLabel = name => String(name).replace(/^PC \(Windows\)$/, 'PC').replace(/^Sony /, '');

// The Play page: a home that answers "what now?", plus My plan, Challenges (list goals and
// owned-game challenges), History and Progress tabs.
export function setupHome({ client, openTarget }) {
  const $ = id => document.getElementById(id);

  // Old links (?view=… for plan lists, #playHistoryAlbum) still land on the right tab.
  function current() {
    const query = new URLSearchParams(location.search), section = query.get('section');
    if (SECTIONS.includes(section)) return section;
    if (query.has('view')) return 'plan';
    if (location.hash === '#playHistoryAlbum') return 'history';
    if (['#playChallenges', '#playGoals'].includes(location.hash)) return 'challenges';
    if (location.hash === '#progressRewards') return 'progress';
    return 'home';
  }
  function showSection() {
    const section = current();
    for (const panel of document.querySelectorAll('[data-play-section]')) panel.hidden = panel.dataset.playSection !== section;
    for (const link of document.querySelectorAll('[data-section-link]')) {
      const query = new URLSearchParams(location.search);
      query.set('section', link.dataset.sectionLink);
      if (link.dataset.sectionLink !== 'plan') query.delete('view');
      link.href = `?${query}`;
      if (link.dataset.sectionLink === section) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  $('playSections').addEventListener('click', event => {
    const link = event.target.closest('[data-section-link]'); if (!link) return;
    event.preventDefault(); history.pushState({}, '', link.href); showSection(); window.scrollTo({ top: 0 });
  });
  addEventListener('popstate', showSection);

  function renderContinue() {
    const items = continueList(client.snapshot(), { library: client.library, catalog: client.catalog });
    $('playContinue').hidden = !items.length;
    $('continueCards').innerHTML = items.map(item => `<button type="button" class="continue-card" data-continue="${esc(item.targetId)}">
      <span class="continue-cover">${item.cover ? `<img src="${esc(item.cover)}" alt="" loading="lazy">` : `<span>${esc(item.title.slice(0, 2).toUpperCase())}</span>`}</span>
      <span class="continue-copy"><span class="eyebrow">${item.status === 'paused' ? 'Paused' : 'Playing'}</span>
        <strong>${esc(item.title)}</strong>
        <small>${esc([...new Set(item.platforms.map(platformLabel))].join(' · '))}</small>
        ${item.lastNote ? `<span class="continue-note">“${esc(item.lastNote.text.length > 140 ? `${item.lastNote.text.slice(0, 140)}…` : item.lastNote.text)}”</span>` : '<span class="continue-note is-empty">No session notes yet</span>'}
      </span></button>`).join('');
  }
  $('continueCards').addEventListener('click', event => {
    const card = event.target.closest('[data-continue]'); if (card) openTarget(card.dataset.continue);
  });

  // How many wishlist games still wait for a decision, and how many you already own.
  function renderWishPrompt() {
    const state = client.snapshot(), owned = new Set(client.library.flatMap(game => game.copies.map(copy => copy.igdb?.id).filter(Boolean)));
    const open = client.wishlist.filter(game => !['archived', 'acquired'].includes(entryFor(state, { provider: 'steam', id: String(game.appid) })?.decision));
    const unreviewed = open.filter(game => !entryFor(state, { provider: 'steam', id: String(game.appid) })?.decision).length;
    const alreadyOwned = open.filter(game => game.igdb?.id && owned.has(game.igdb.id)).length;
    const goal = state.settings.wishlistGoal, goalText = Number.isInteger(goal) ? (open.length <= goal ? ` Goal of ${goal.toLocaleString()} reached.` : ` ${(open.length - goal).toLocaleString()} to go to your goal of ${goal.toLocaleString()}.`) : '';
    $('wishPromptSummary').textContent = open.length
      ? `${open.length.toLocaleString()} games on your wishlist, ${unreviewed.toLocaleString()} never reviewed${alreadyOwned ? ` · ${alreadyOwned} you already own on another store or platform` : ''}.${goalText}`
      : 'Your wishlist is empty.';
  }

  showSection();
  return { render() { renderContinue(); renderWishPrompt(); showSection(); } };
}
