// Browsing in the style of EmulationStation, shared by Game Atlas and the Library:
// a carousel of systems or shelves, and a spotlight view where a list sits beside a large
// panel for the selected game. Each page builds its own slides, rows and panel content.
import { escapeHtml as esc } from '../lib.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => matchMedia('(max-width: 900px)').matches;
// A CSS custom property holding an image: --art:url("…"). The address is made absolute:
// a relative url() in a custom property resolves against the stylesheet using it
// (theme.css at the site root), not the page.
export const artStyle = (name, url) => url ? `--${name}:${esc(`url(${JSON.stringify(new URL(String(url), document.baseURI).href)})`)}` : '';

// Broken or missing art just disappears (screenshots don't exist for every game).
function hideBroken(root) {
  root.addEventListener('error', event => {
    if (event.target.tagName !== 'IMG') return;
    const holder = event.target.closest('[data-art-slot]'); if (holder) holder.hidden = true; else event.target.hidden = true;
  }, true);
}

// ---------- Carousel ----------
// slides: [{ title, short, eyebrow, subtitle, meta, chips: [text], progress (0–1), covers: [url], color, action: { label, attrs }, more: { label, attrs } }]
// `action.attrs` is an attribute string the page has already escaped.
export function carouselHtml({ label, slides, active = 0 }) {
  if (!slides.length) return '';
  const slide = (item, index) => {
    const covers = (item.covers ?? []).filter(Boolean).slice(0, 5);
    return `<article class="carousel-slide${index === active ? ' is-active' : ''}" data-slide="${index}" role="group" aria-roledescription="slide" aria-label="${esc(item.title)}, ${index + 1} of ${slides.length}" style="--slide-color:${esc(item.color ?? 'var(--accent)')};${artStyle('art', covers[0])}">
      <div class="slide-backdrop" aria-hidden="true"></div>
      <div class="slide-copy">
        ${item.eyebrow ? `<p class="slide-eyebrow">${esc(item.eyebrow)}</p>` : ''}<h2 class="slide-title">${esc(item.title)}</h2>
        ${item.subtitle ? `<p class="slide-subtitle">${esc(item.subtitle)}</p>` : ''}${item.meta ? `<p class="slide-meta">${esc(item.meta)}</p>` : ''}
        ${item.progress != null ? `<div class="slide-progress" role="progressbar" aria-label="Completed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(item.progress * 100)}"><span style="width:${Math.round(item.progress * 100)}%"></span></div>` : ''}
        ${item.chips?.length ? `<p class="slide-chips">${item.chips.map(chip => `<span>${esc(chip)}</span>`).join('')}</p>` : ''}
        <div class="slide-actions">${item.action ? `<button class="primary-button slide-action" type="button" ${item.action.attrs}>${esc(item.action.label)} <span aria-hidden="true">→</span></button>` : ''}${item.more ? `<button class="slide-more" type="button" ${item.more.attrs}>${esc(item.more.label)}</button>` : ''}</div>
      </div>
      <div class="slide-covers" aria-hidden="true">${covers.map((url, n) => `<span class="slide-cover" data-art-slot style="--n:${n}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></span>`).join('')}</div>
    </article>`;
  };
  return `<section class="carousel" aria-roledescription="carousel" aria-label="${esc(label)}">
    <div class="carousel-track" tabindex="0" aria-label="${esc(label)} · left and right arrow keys move">${slides.map(slide).join('')}</div>
    <div class="carousel-bar">
      <button class="carousel-step" type="button" data-carousel-step="-1" aria-label="Previous">←</button>
      <div class="carousel-strip" role="tablist" aria-label="${esc(label)}">${slides.map((item, index) => `<button type="button" role="tab" data-carousel-go="${index}" aria-selected="${index === active}" style="--slide-color:${esc(item.color ?? 'var(--accent)')}">${esc(item.short ?? item.title)}</button>`).join('')}</div>
      <button class="carousel-step" type="button" data-carousel-step="1" aria-label="Next">→</button>
    </div>
  </section>`;
}

// Keeps the active slide centred; arrow keys, the strip and the step buttons move it.
// `onChange(index)` lets the page remember where you were across redraws.
// While the carousel scrolls itself to a slide, the slides it passes are not "active": only
// the target is marked, so the strip doesn't flick through every system on the way.
const centredLeft = (container, child) => container.scrollLeft + child.getBoundingClientRect().left - container.getBoundingClientRect().left - (container.clientWidth - child.offsetWidth) / 2;
export function bindCarousel(root, { active = 0, onChange = () => {} } = {}) {
  const carousel = root.querySelector('.carousel'); if (!carousel) return null;
  const track = carousel.querySelector('.carousel-track'), strip = carousel.querySelector('.carousel-strip');
  const slides = [...track.children], tabs = [...carousel.querySelectorAll('[data-carousel-go]')];
  let current = -1, frame = 0, steering = false, settle = 0;
  hideBroken(carousel);
  const mark = (index, smooth = true) => {
    if (index === current) return;
    current = index;
    slides.forEach((slide, n) => slide.classList.toggle('is-active', n === index));
    tabs.forEach((tab, n) => tab.setAttribute('aria-selected', String(n === index)));
    strip.scrollTo({ left: centredLeft(strip, tabs[index]), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    onChange(index);
  };
  const nearest = () => {
    const middle = track.getBoundingClientRect().left + track.clientWidth / 2;
    let best = 0, distance = Infinity;
    slides.forEach((slide, n) => { const rect = slide.getBoundingClientRect(), gap = Math.abs(rect.left + rect.width / 2 - middle); if (gap < distance) { distance = gap; best = n; } });
    return best;
  };
  const go = (index, smooth = true) => {
    const target = (index + slides.length) % slides.length;
    steering = smooth && !reduced();
    track.scrollTo({ left: centredLeft(track, slides[target]), behavior: steering ? 'smooth' : 'auto' });
    mark(target, smooth);
  };
  track.addEventListener('scroll', () => {
    // A swipe or trackpad scroll follows along; a scroll the carousel started just settles.
    clearTimeout(settle);
    settle = setTimeout(() => { steering = false; mark(nearest()); }, 140);
    if (steering) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => mark(nearest()));
  }, { passive: true });
  track.addEventListener('keydown', event => {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (moves[event.key]) { event.preventDefault(); go(current + moves[event.key]); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); go(event.key === 'Home' ? 0 : slides.length - 1); }
  });
  carousel.addEventListener('click', event => {
    const step = event.target.closest('[data-carousel-step]'), tab = event.target.closest('[data-carousel-go]'), slide = event.target.closest('.carousel-slide');
    if (step) go(current + Number(step.dataset.carouselStep));
    else if (tab) go(Number(tab.dataset.carouselGo));
    // A side slide peeking in comes to the centre first.
    else if (slide && !slide.classList.contains('is-active') && !event.target.closest('button')) go(slides.indexOf(slide));
  });
  go(Math.max(0, Math.min(active, slides.length - 1)), false);
  return { go, get current() { return current; } };
}

// ---------- Spotlight ----------
// The page renders rows as buttons with data-spot="<id>" inside `list`; `panel(id)` returns
// the panel for one game. On a narrow screen there's no room for the panel: rows open the
// game straight away instead.
export function spotlightHtml(list, label) {
  return `<div class="spotlight"><div class="spotlight-list" aria-label="${esc(label)}">${list}</div><aside class="spotlight-panel" aria-live="polite" aria-label="Selected game"></aside></div>`;
}

export function bindSpotlight(root, { panel, onOpen, selected = null, onSelect = () => {} }) {
  const view = root.querySelector('.spotlight'); if (!view) return null;
  const target = view.querySelector('.spotlight-panel'), rows = () => [...view.querySelectorAll('[data-spot]')];
  hideBroken(view);
  let current = null;
  const select = id => {
    if (!id || id === current) return;
    current = id;
    for (const row of rows()) row.setAttribute('aria-current', String(row.dataset.spot === id));
    target.innerHTML = panel(id);
    target.classList.remove('is-changing'); void target.offsetWidth; target.classList.add('is-changing');
    onSelect(id);
  };
  view.addEventListener('click', event => {
    const row = event.target.closest('[data-spot]');
    if (!row) return;
    if (narrow()) onOpen(row.dataset.spot); else select(row.dataset.spot);
  });
  view.addEventListener('dblclick', event => { const row = event.target.closest('[data-spot]'); if (row && !narrow()) onOpen(row.dataset.spot); });
  view.addEventListener('focusin', event => { const row = event.target.closest('[data-spot]'); if (row && !narrow()) select(row.dataset.spot); });
  view.addEventListener('keydown', event => {
    const row = event.target.closest('[data-spot]'); if (!row) return;
    const list = rows(), index = list.indexOf(row);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key];
    if (next != null && list[next]) { event.preventDefault(); list[next].focus(); select(list[next].dataset.spot); list[next].scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
    if (event.key === 'Enter') { event.preventDefault(); onOpen(row.dataset.spot); }
  });
  // A panel taller than the window would be cut off while it sticks to the top: it sticks
  // by its bottom edge instead, so scrolling down reaches the end of it.
  const GAP = 16;
  const fit = () => { target.style.top = `${Math.min(GAP, innerHeight - target.offsetHeight - GAP)}px`; };
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(target);
  const onResize = () => { if (target.isConnected) fit(); else removeEventListener('resize', onResize); };
  addEventListener('resize', onResize, { passive: true });
  const first = rows().find(row => row.dataset.spot === selected) ?? rows()[0];
  if (first) select(first.dataset.spot);
  fit();
  // Redraw the panel in place, e.g. once descriptions have loaded.
  const refresh = () => { if (current) target.innerHTML = panel(current); };
  return { select, refresh };
}

// Screenshots for a cover from libretro-thumbnails: the same file in its Snaps and Titles folders.
export const libretroShots = url => /\/Named_Boxarts\//.test(url ?? '') ? ['Named_Snaps', 'Named_Titles'].map(folder => url.replace('/Named_Boxarts/', `/${folder}/`)) : [];
export const igdbShot = id => `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${encodeURIComponent(id)}.jpg`;
export const shotsHtml = urls => urls.length ? `<div class="spotlight-shots">${urls.slice(0, 4).map(url => `<span class="spotlight-shot" data-art-slot><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></span>`).join('')}</div>` : '';
