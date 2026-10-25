import { escapeHtml as esc } from '../lib.js';

// A decided card gets a stamp ("Kept", "Removed") and is sent off in the direction of the
// decision while the choice is saved: keep → right, remove → left, later → up, wait → down.
// Resolves once the card is gone, or straight away when motion is reduced.
export function sendOff(card, direction, stamp) {
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  card.insertAdjacentHTML('beforeend', `<span class="decision-stamp is-${direction}" aria-hidden="true">${esc(stamp)}</span>`);
  card.classList.remove('enter'); // its deal-in animation would win over the send-off
  card.classList.add('is-leaving', `leave-${direction}`);
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 600);
    card.addEventListener('animationend', event => { if (event.target === card) { clearTimeout(timer); resolve(); } });
  });
}

// Put a card back where it was when saving failed.
export function bringBack(card) {
  if (!card) return;
  card.classList.remove('is-leaving', 'leave-left', 'leave-right', 'leave-up', 'leave-down');
  card.querySelector('.decision-stamp')?.remove();
}
