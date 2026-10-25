// A game's awards (data/awards.json, attached by the local server): what to say about them
// and how much they count when choosing what to play next or what to keep wishlisted.
const CEREMONIES = ['The Game Awards', 'BAFTA Games Awards', 'D.I.C.E. Awards', 'Game Developers Choice Awards', 'Golden Joystick Awards', 'Spike Video Game Awards', 'Japan Game Awards'];
const SHORT = { 'The Game Awards': 'The Game Awards', 'BAFTA Games Awards': 'BAFTA', 'D.I.C.E. Awards': 'D.I.C.E.', 'Game Developers Choice Awards': 'GDC Awards',
  'Golden Joystick Awards': 'Golden Joysticks', 'Spike Video Game Awards': 'Spike VGAs', 'Japan Game Awards': 'Japan Game Awards' };
const byCeremony = (a, b) => CEREMONIES.indexOf(a.ceremony) - CEREMONIES.indexOf(b.ceremony) || (a.year ?? 0) - (b.year ?? 0);
export const awardPlace = award => `${SHORT[award.ceremony] ?? award.ceremony}${award.year ? ` ${award.year}` : ''}`;
const places = (awards, limit = 2) => `${awards.slice(0, limit).map(awardPlace).join(', ')}${awards.length > limit ? ` and ${awards.length - limit} more` : ''}`;

// { tier: 'goty' | 'winner' | 'nominee', label, short (for badges), headline, gotyWins, categoryWins, nominations } or null.
export function awardSummary(awards) {
  if (!awards?.length) return null;
  const gotyWins = awards.filter(award => award.won && award.goty).sort(byCeremony);
  const categoryWins = awards.filter(award => award.won && !award.goty).sort(byCeremony);
  const nominations = awards.filter(award => !award.won).sort(byCeremony);
  if (gotyWins.length) return { tier: 'goty', label: `Game of the Year${gotyWins.length > 1 ? ` ×${gotyWins.length}` : ''}`, short: `GOTY${gotyWins.length > 1 ? ` ×${gotyWins.length}` : ''}`, headline: `Game of the Year · ${places(gotyWins)}`, gotyWins, categoryWins, nominations };
  if (categoryWins.length) return { tier: 'winner', label: `${categoryWins.length} award${categoryWins.length === 1 ? '' : 's'}`, short: `${categoryWins.length} award${categoryWins.length === 1 ? '' : 's'}`, headline: `${categoryWins[0].name} · ${awardPlace(categoryWins[0])}${categoryWins.length > 1 ? ` (+${categoryWins.length - 1} more award${categoryWins.length === 2 ? '' : 's'})` : ''}`, gotyWins, categoryWins, nominations };
  return { tier: 'nominee', label: 'GOTY nominee', short: 'GOTY nominee', headline: `Game of the Year nominee · ${places(nominations)}`, gotyWins, categoryWins, nominations };
}

// A small lift on top of a game's score when ranking: recognition breaks near-ties but
// never outweighs a clearly better-rated game (3 points at most, for Game of the Year).
export function awardLift(awards) {
  const summary = awardSummary(awards);
  if (!summary) return 0;
  return summary.tier === 'goty' ? 3 : Math.min(2, (summary.categoryWins.length ? 1 : 0) + (summary.nominations.length ? 1 : 0));
}
// Higher first, like compareRatings; unrated games stay behind rated ones.
export const compareWithAwards = (a, b) => (b?.rating ? b.rating.value + awardLift(b.awards) : -1) - (a?.rating ? a.rating.value + awardLift(a.awards) : -1);
