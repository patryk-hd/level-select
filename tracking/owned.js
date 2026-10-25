// Games you own that aren't in the Playnite import: marked "Owned" in Game Atlas or
// bought from the wishlist. Library shows them beside imported games, clearly labelled.

const assetPath = url => url?.startsWith('./') ? `.${url}` : url ?? null;

export function manualOwnedGroups(state, { catalog = { games: [], systems: [] }, wishlist = [], library = [] } = {}) {
  const catalogById = new Map(catalog.games.map(game => [game.id, game]));
  const systems = new Map((catalog.systems ?? []).map(system => [system.id, system]));
  const wishById = new Map(wishlist.map(game => [String(game.appid), game]));
  // A game already imported from Playnite (same IGDB game) is not listed twice.
  const imported = new Set(library.flatMap(group => group.copies.map(copy => copy.igdb?.id).filter(Boolean)));
  const groups = new Map();
  for (const record of Object.values(state.ownership)) {
    if (record.evidence !== 'manual' || !['catalog', 'steam'].includes(record.source?.provider)) continue;
    const { provider, id } = record.source, key = `manual:${provider}:${id}`;
    if (groups.has(key)) continue;
    const game = provider === 'catalog' ? catalogById.get(id) : wishById.get(String(id));
    if (!game || (game.igdb?.id && imported.has(game.igdb.id))) continue;
    const system = provider === 'catalog' ? systems.get(game.systemId) : null;
    const name = game.title, platforms = system ? [system.name] : record.platforms?.length ? record.platforms : ['PC (Windows)'];
    const sources = [provider === 'catalog' ? 'Marked owned' : 'Bought from wishlist'];
    const genres = game.genres ?? [];
    const copy = { id: key, name, platforms, sources, year: game.year ?? null, igdb: game.igdb ?? null, manual: true };
    groups.set(key, {
      id: key, name, manual: true, ref: { provider, id: String(id) }, acquiredAt: record.acquiredAt ?? null,
      platforms, sources, year: game.year ?? null, releaseDate: game.year ? String(game.year) : '', dateSort: game.year ? `${game.year}-01-01` : '',
      genres, mainGenre: genres[0] ?? '', categories: [], tags: [], played: false, timePlayed: 0, playCount: 0, hidden: false, favorite: false,
      cover: provider === 'catalog' ? assetPath(game.cover?.local) ?? game.cover?.url ?? null : game.image ?? null,
      background: provider === 'steam' ? game.image ?? null : null, summary: game.summary ?? '', notes: '',
      search: [name, ...platforms, ...sources, ...genres].join(' ').toLowerCase(), copies: [copy],
    });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
