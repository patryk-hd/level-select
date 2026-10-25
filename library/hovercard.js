// Hover cards: a small preview of what a chip stands for (the awards behind "3 awards",
// how a score is made up, the hours to beat). Any element with data-hover="<html>" gets
// one when the pointer rests on it, or when it has keyboard focus. The HTML is built by
// this app from escaped values. The card sits in the top layer, so it shows over dialogs.
import { escapeHtml as esc } from '../lib.js';

export const hoverAttr = html => html ? ` data-hover="${esc(html)}"` : '';

let card = null, current = null, timer = 0;
const SHOW_DELAY = 220, HIDE_DELAY = 90, GAP = 8, EDGE = 8;

function place(anchor) {
  const box = anchor.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight;
  const above = box.top - height - GAP >= EDGE;
  const top = above ? box.top - height - GAP : Math.min(innerHeight - height - EDGE, box.bottom + GAP);
  const left = Math.min(innerWidth - width - EDGE, Math.max(EDGE, box.left + box.width / 2 - width / 2));
  card.style.left = `${Math.round(left)}px`; card.style.top = `${Math.round(top)}px`;
  card.dataset.side = above ? 'top' : 'bottom';
  // The little pointer follows the anchor even when the card is pushed off-centre.
  card.style.setProperty('--arrow', `${Math.round(Math.min(width - 14, Math.max(14, box.left + box.width / 2 - left)))}px`);
}
function show(anchor) {
  clearTimeout(timer);
  if (!anchor.isConnected) return;
  current?.removeAttribute('aria-describedby');
  current = anchor;
  card.innerHTML = anchor.dataset.hover;
  card.hidden = false;
  try { card.hidePopover?.(); card.showPopover?.(); } catch {}
  place(anchor);
  card.classList.remove('is-open'); void card.offsetWidth; card.classList.add('is-open');
  anchor.setAttribute('aria-describedby', 'hovercard');
}
function hide() {
  clearTimeout(timer);
  if (!current) return;
  current.removeAttribute('aria-describedby'); current = null;
  card.classList.remove('is-open'); card.hidden = true;
  try { card.hidePopover?.(); } catch {}
}

export function bindHovercards() {
  if (card) return;
  card = document.createElement('div');
  card.id = 'hovercard'; card.className = 'hovercard'; card.setAttribute('role', 'tooltip'); card.hidden = true;
  if ('popover' in card) card.popover = 'manual';
  document.body.append(card);
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const anchor = event.target.closest?.('[data-hover]');
    if (anchor === current) { clearTimeout(timer); return; }
    clearTimeout(timer);
    if (anchor) timer = setTimeout(() => show(anchor), current ? 0 : SHOW_DELAY);
    else if (current) timer = setTimeout(hide, HIDE_DELAY);
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('focusin', event => { const anchor = event.target.closest?.('[data-hover]'); if (anchor) show(anchor); else hide(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && current) hide(); });
  addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('resize', hide, { passive: true });
}
