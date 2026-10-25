// The best mods of all time, by consensus: how many respected sources pick each mod
// (data/mods-research.json). A supporting source (a community catalogue that lists nearly
// everything good) confirms a pick but counts half. Ties go to the mod more encyclopedias
// cover (Wikipedia languages), then the one more IGDB players rated, then the better
// position in a ranked list. Shared by the build script and the tests.
import { titleKey, baseTitle } from '../library/core.js';

export function consensus(picks, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  let count = 0, points = 0;
  for (const id of Object.keys(picks ?? {})) {
    const source = byId.get(id);
    if (!source) throw new Error(`Unknown source “${id}”.`);
    if (source.supporting) points += 0.5;
    else { count++; points += 1; }
  }
  return { count, points };
}

// The best position a ranked list gives the mod ("#5", "SNES #3 · Metroid #7" → 3).
export function bestPosition(picks) {
  const numbers = Object.values(picks ?? {}).flatMap(label => [...String(label).matchAll(/(?:^|#)(\d{1,3})(?=$|\s|·)/g)].map(match => Number(match[1])))
    .filter(number => number > 0 && number < 1000);
  return numbers.length ? Math.min(...numbers) : Infinity;
}

export function compareMods(a, b) {
  return b.consensus.points - a.consensus.points || (b.notability ?? 0) - (a.notability ?? 0) || (b.igdb?.ratingCount ?? 0) - (a.igdb?.ratingCount ?? 0)
    || bestPosition(a.picks) - bestPosition(b.picks) || a.name.localeCompare(b.name);
}

// Rank overall and within each system (1 = best).
export function rankMods(mods) {
  const sorted = [...mods].sort(compareMods), perSystem = new Map();
  return sorted.map((mod, index) => {
    const systemRank = (perSystem.get(mod.system) ?? 0) + 1;
    perSystem.set(mod.system, systemRank);
    return { ...mod, rank: index + 1, systemRank };
  });
}

// IGDB search results → the entry that is this mod, or null when none is clearly it. The title
// must match; the base game (IGDB's parent), the year or IGDB calling it a mod confirms it.
// Short, generic titles ("Complex", "Contra") need their base game to match.
const KEY = value => titleKey(baseTitle(value)).replace(/^the /, '');
export function pickIgdbMod(want, games) {
  const name = KEY(want.name), game = KEY(want.game ?? '');
  let best = null;
  for (const candidate of games ?? []) {
    const names = [candidate.name, ...(candidate.alternative_names ?? []).map(entry => entry.name)].map(KEY);
    const exact = names.includes(name);
    const partial = !exact && names.some(other => other && (other.includes(name) || name.includes(other)) && Math.min(other.length, name.length) / Math.max(other.length, name.length) > 0.6);
    if (!exact && !partial) continue;
    // Word by word: "Crusader Kings III" isn't "Crusader Kings II"; "Medieval II: Total War"
    // is the base of "Medieval II: Total War: Kingdoms".
    const parent = candidate.parent_game?.name ? KEY(candidate.parent_game.name) : '';
    const parentMatch = Boolean(game && parent && (parent === game || parent.startsWith(`${game} `) || game.startsWith(`${parent} `)));
    // A different base game: the same name, but another game's mod.
    if (game && parent && !parentMatch) continue;
    const year = candidate.first_release_date ? new Date(candidate.first_release_date * 1000).getUTCFullYear() : null;
    const yearMatch = Boolean(want.year && year && Math.abs(year - want.year) <= 2);
    const modType = [5, 12].includes(candidate.game_type);
    const confirmed = parentMatch || (exact && name.length >= 8 && (modType || yearMatch)) || (exact && modType && yearMatch);
    if (!confirmed) continue;
    const score = (exact ? 3 : 1) + (parentMatch ? 2 : 0) + (yearMatch ? 1 : 0) + (modType ? 1 : 0) + Math.min(1, (candidate.total_rating_count ?? 0) / 100);
    if (!best || score > best.score) best = { candidate, score };
  }
  return best?.candidate ?? null;
}

// IGDB's website types worth a link, and what to call them.
const SITE_TYPES = { 1: 'Official site', 13: 'Steam', 17: 'GOG', 15: 'itch.io', 16: 'Epic', 3: 'Wikipedia' };
const HOSTS = { 'moddb.com': 'ModDB', 'nexusmods.com': 'Nexus Mods', 'romhacking.net': 'Romhacking.net', 'smwcentral.net': 'SMW Central', 'github.com': 'GitHub' };
export function modLinks(websites) {
  const links = [];
  for (const site of websites ?? []) {
    let label = SITE_TYPES[site.type ?? site.category], url;
    try { url = new URL(site.url); } catch { continue; }
    if (!label || !['http:', 'https:'].includes(url.protocol)) continue;
    const host = url.hostname.replace(/^www\./, '');
    if (label === 'Official site') label = Object.entries(HOSTS).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? label;
    if (!links.some(link => link.label === label)) links.push({ label, url: url.href });
  }
  const order = ['Official site', 'ModDB', 'Nexus Mods', 'SMW Central', 'Romhacking.net', 'GitHub', 'Steam', 'GOG', 'itch.io', 'Epic', 'Wikipedia'];
  return links.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}
