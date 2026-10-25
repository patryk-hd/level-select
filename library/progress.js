import { escapeHtml as esc } from '../lib.js';
import { badges, monthlyActivity } from '../tracking/badges.js';
import { goalProgress } from '../tracking/goals.js';
import { levelProgress, profileFor, LEVEL_NAMES, levelTitle, levelStart, REWARD_POINTS, nextTitle, xpBreakdown } from '../tracking/rewards.js';

const SERIES = [['finished', 'Finished'], ['added', 'Added to plan']];
const BADGE_ICONS = { finished: '🏆', triaged: '🗂️', removed: '✂️', platforms: '🕹️', retro: '👾', notes: '📓', topTen: '🥇', goals: '📜', challenges: '🎯', months: '📅', past: '🕰️', replays: '🔁', milestones: '🚩', mastery: '💎', reflections: '✍️', listHistory: '🏛️', listSeries: '👑', listDecade: '📼', listGenre: '🎮' };
// What earns XP, in the order people meet it. Amounts come from the reward rules.
const XP_WAYS = [
  ['finish', 'Finish a game', 'Mark it Finished in My plan'],
  ['past', 'Log a game you finished before', '“Already played” in triage or My plan'],
  ['decision', 'Decide on a game', 'Each triage or wishlist choice, once per game'],
  ['review', 'Review 10 wishlist games', 'Once a week'],
  ['reflection', 'Write a reflection', 'A few words when you finish'],
  ['mastery', 'Master a game', 'A mastery milestone after the main game'],
];
const percent = (value, max) => max ? Math.min(100, Math.round(value / max * 100)) : 0;
const monthName = key => new Date(`${key}-01T00:00:00Z`).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });

// Grouped bars, one axis: games added to the plan vs games finished, per month.
function chartSvg(rows) {
  const width = 640, height = 220, left = 32, right = 8, top = 22, bottom = 26;
  const max = Math.max(1, ...rows.flatMap(row => SERIES.map(([key]) => row[key])));
  const ceiling = max <= 4 ? 4 : Math.ceil(max / 5) * 5, plot = height - top - bottom;
  const group = (width - left - right) / rows.length, bar = Math.min(26, (group - 18) / 2);
  const y = value => top + plot - value / ceiling * plot;
  const ticks = [0, ceiling / 2, ceiling].map(value => `<g class="chart-grid"><line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${value}</text></g>`).join('');
  const bars = rows.map((row, index) => {
    const x0 = left + index * group + (group - bar * 2 - 2) / 2;
    const marks = SERIES.map(([key], s) => {
      const value = row[key], x = x0 + s * (bar + 2), h = value / ceiling * plot, r = Math.min(4, h);
      // Rounded at the data end only; square on the baseline.
      const path = h ? `M${x},${top + plot}V${y(value) + r}Q${x},${y(value)} ${x + r},${y(value)}H${x + bar - r}Q${x + bar},${y(value)} ${x + bar},${y(value) + r}V${top + plot}Z` : '';
      return `${path ? `<path class="bar bar-${key}" d="${path}"/>` : ''}${value ? `<text class="bar-label" x="${x + bar / 2}" y="${y(value) - 5}" text-anchor="middle">${value}</text>` : ''}`;
    }).join('');
    const tip = `${monthName(row.month)} ${row.month.slice(0, 4)}: ${row.finished} finished, ${row.added} added to plan`;
    return `<g class="chart-group" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><rect class="hit" x="${left + index * group}" y="${top}" width="${group}" height="${plot + bottom}"/>${marks}<text class="chart-month" x="${left + index * group + group / 2}" y="${height - 6}" text-anchor="middle">${esc(monthName(row.month))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Games added to your plan and games finished per month">${ticks}<line class="chart-axis" x1="${left}" x2="${width - right}" y1="${top + plot}" y2="${top + plot}"/>${bars}</svg>`;
}

export function setupProgress(client) {
  const host = document.getElementById('progressOverview');
  host.addEventListener('pointerover', show); host.addEventListener('focusin', show);
  host.addEventListener('pointerleave', hide); host.addEventListener('focusout', hide);
  function show(event) {
    const groupNode = event.target.closest?.('.chart-group'), tip = host.querySelector('.chart-tip'); if (!groupNode || !tip) return;
    const box = groupNode.getBoundingClientRect(), frame = host.querySelector('.chart-frame').getBoundingClientRect();
    tip.textContent = groupNode.dataset.tip; tip.hidden = false;
    tip.style.left = `${Math.min(frame.width - tip.offsetWidth, Math.max(0, box.left - frame.left + box.width / 2 - tip.offsetWidth / 2))}px`;
  }
  function hide(event) { if (!host.contains(event.relatedTarget)) { const tip = host.querySelector('.chart-tip'); if (tip) tip.hidden = true; } }

  function render() {
    const ladderOpen = host.querySelector('.level-ladder-wrap')?.open ?? true;
    const state = client.snapshot(), profile = profileFor(state), visible = state.settings.gamificationVisible;
    // Badges that need the catalog: finishes from a system's top ten, and completed list goals.
    const finishedIds = client.finishedCatalogIds(), catalogGames = new Map(client.catalog.games.map(game => [game.id, game]));
    const topTen = [...finishedIds].filter(id => { const rank = catalogGames.get(id)?.rank; return rank != null && rank <= 10; }).length;
    const goals = (state.settings.listGoals ?? []).filter(goal => goalProgress(client.catalog, goal, finishedIds).complete).length;
    const level = levelProgress(state), list = badges(state, { topTen, goals }), rows = monthlyActivity(state);
    const earned = list.filter(badge => badge.unlocked).length, decisions = rows.reduce((sum, row) => sum + row.decisions, 0);
    const next = nextTitle(level.total, level.step), earnedBy = Object.fromEntries(xpBreakdown(state).map(row => [row.type, row.amount]));
    const nextBadge = list.filter(badge => !badge.unlocked).sort((a, b) => b.progress / b.goal - a.progress / a.goal)[0];
    host.innerHTML = `
      ${profile && visible ? `<div class="level-hero">
        <div class="level-badge" aria-hidden="true"><small>Level</small><strong>${level.level}</strong></div>
        <div><p class="eyebrow">Level ${level.level}</p><h2>${esc(level.title)}</h2>
          <span class="xp-bar" role="progressbar" aria-label="Progress toward level ${level.level + 1}" aria-valuemin="0" aria-valuemax="${level.span}" aria-valuenow="${level.within}"><span class="xp-fill" style="--xp:${percent(level.within, level.span)}%"></span></span>
          <div class="level-meta"><span><strong>${level.total.toLocaleString()} XP</strong> earned</span><span>${level.next.toLocaleString()} XP to level ${level.level + 1}</span></div>
          <p class="suggestion-help">${next ? `Next title: <strong>${esc(next.title)}</strong> at level ${next.level}, ${next.xp.toLocaleString()} XP away.` : 'You hold the highest title.'}</p></div>
        <details class="level-ladder-wrap"${ladderOpen ? ' open' : ''}><summary>All levels <small>${level.level} of ${LEVEL_NAMES.length}${level.level > LEVEL_NAMES.length ? '+' : ''}</small></summary>
        <ol class="level-ladder" aria-label="Levels and titles">${Array.from({ length: Math.max(LEVEL_NAMES.length, level.level + 1) }, (_, index) => index + 1).map(n => {
          const reached = level.level >= n, current = level.level === n, xp = levelStart(n, level.step);
          return `<li class="${reached ? 'is-reached' : ''}${current ? ' is-current' : ''}"${current ? ' aria-current="step"' : ''}><small>Level ${n}</small><strong>${esc(levelTitle(n))}</strong><span>${current ? `${percent(level.within, level.span)}% to ${n + 1}` : reached ? 'Reached' : `${xp.toLocaleString()} XP`}</span>${current ? `<i style="--xp:${percent(level.within, level.span)}%" aria-hidden="true"></i>` : ''}</li>`;
        }).join('')}</ol></details>
      </div>
      <section class="progress-block" aria-labelledby="xpWaysTitle"><header><h2 id="xpWaysTitle">How you earn XP</h2><p class="suggestion-help">XP only comes from real progress: finishing games and deciding what stays in your backlog and wishlist. Undo takes it back.</p></header>
        <ul class="xp-ways">${XP_WAYS.map(([type, title, how]) => `<li><b>+${REWARD_POINTS[type]}</b><span>${esc(title)}</span><small>${esc(how)}${earnedBy[type] ? ` · you've earned ${earnedBy[type].toLocaleString()} XP` : ''}</small></li>`).join('')}<li><b>+10</b><span>Complete a list goal</span><small>Per game on the list (a top 10 is 100 XP), when a finish after you set the goal completes it${earnedBy.list ? ` · you've earned ${earnedBy.list.toLocaleString()} XP` : ''}</small></li><li><b>+15–25</b><span>Complete a challenge</span><small>Per game on the board, from new finishes after you accept it${earnedBy.challenge ? ` · you've earned ${earnedBy.challenge.toLocaleString()} XP` : ''}</small></li></ul>
      </section>` : ''}
      <section class="progress-block" aria-labelledby="badgesTitle"><header><h2 id="badgesTitle">Badges</h2><p class="suggestion-help">${earned} of ${list.length} earned${nextBadge ? ` · closest: ${esc(nextBadge.title)} (${nextBadge.progress} / ${nextBadge.goal})` : ''}</p></header>
        <ul class="badge-grid">${list.map(badge => `<li class="badge ${badge.unlocked ? 'is-earned' : ''} ${badge === nextBadge ? 'is-next' : ''}"><span class="badge-icon" aria-hidden="true">${BADGE_ICONS[badge.stat] ?? '★'}</span><strong>${esc(badge.title)}</strong><span>${esc(badge.description)}</span>
          <span class="xp-bar" aria-hidden="true"><span class="xp-fill" style="--xp:${percent(badge.progress, badge.goal)}%"></span></span><small>${badge.unlocked ? 'Earned' : `${badge.progress} / ${badge.goal}`}</small></li>`).join('')}</ul>
      </section>
      <section class="progress-block" aria-labelledby="activityTitle"><header><h2 id="activityTitle">Your backlog, month by month</h2><p class="suggestion-help">Finishing more than you add shrinks the pile. ${decisions.toLocaleString()} triage and wishlist ${decisions === 1 ? 'decision' : 'decisions'} in the last six months.</p></header>
        <ul class="chart-legend">${SERIES.map(([key, label]) => `<li><span class="swatch swatch-${key}"></span>${label}</li>`).join('')}</ul>
        <div class="chart-frame">${chartSvg(rows)}<div class="chart-tip" role="status" hidden></div></div>
        <details class="chart-table"><summary>Show as a table</summary><table><thead><tr><th>Month</th><th>Finished</th><th>Added to plan</th><th>Decisions</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(monthName(row.month))} ${row.month.slice(0, 4)}</td><td>${row.finished}</td><td>${row.added}</td><td>${row.decisions}</td></tr>`).join('')}</tbody></table></details>
      </section>`;
    // The level also shows on the Play page header.
    const chip = document.getElementById('playLevel');
    if (chip) { chip.hidden = !(profile && visible); chip.textContent = `Level ${level.level} · ${level.title} · ${level.total.toLocaleString()} XP`; }
  }
  return { render };
}
