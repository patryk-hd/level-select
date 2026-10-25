// Critic reviews from the "Video game reviews" box on a game's English Wikipedia page:
// one score per publication (EGM, Famitsu, GamePro, Mean Machines, AllGame, IGN…),
// tied to the platform it reviewed whenever the article says so ("EGM_SNES = 9/10",
// "GR = SNES: 89%<br>GBA: 83%"). Scores are facts; the page is credited where they show.

// Our systems and the codes Wikipedia uses for them (template codes first, then the
// labels editors write inline). "GEN" as a field suffix means "general", but inline it
// nearly always means Genesis.
export const SYSTEM_CODES = {
  nes: ['NES', 'FC', 'FAMICOM'], snes: ['SNES', 'SFC', 'SUPERNES', 'SUPERFAMICOM'], n64: ['N64', 'NINTENDO64'],
  gc: ['NGC', 'GCN', 'GC', 'GAMECUBE'], gb: ['GB', 'GAMEBOY'], gbc: ['GBC', 'GAMEBOYCOLOR'], gba: ['GBA', 'GAMEBOYADVANCE'],
  ds: ['DS', 'NDS', 'NINTENDODS'], ms: ['SMS', 'MS', 'MASTERSYSTEM', 'SEGAMASTERSYSTEM'],
  md: ['SMD', 'MD', 'GEN', 'GENESIS', 'MEGADRIVE', 'SEGAGENESIS', 'SEGAMEGADRIVE'], gg: ['SGG', 'GG', 'GAMEGEAR', 'SEGAGAMEGEAR'],
  scd: ['SCD', 'MCD', 'SEGACD', 'MEGACD'], '32x': ['32X', 'S32X'], saturn: ['SSAT', 'SAT', 'SATURN', 'SEGASATURN'],
  dc: ['SDC', 'DC', 'DREAMCAST'], ps1: ['PS', 'PS1', 'PSX', 'PSONE', 'PLAYSTATION'], ps2: ['PS2', 'PLAYSTATION2'], psp: ['PSP'],
  xbox: ['XBOX', 'XB'], atari2600: ['A2600', '2600', 'ATARI2600', 'VCS'],
  tg16: ['TG16', 'TG', 'PCE', 'PCENGINE', 'TURBOGRAFX16', 'TURBOGRAFX'], pcecd: ['TCD', 'PCECD', 'TGCD', 'TURBOCD', 'CDROM2'],
  neogeo: ['NG', 'NEOGEO', 'AES', 'MVS', 'NGCD', 'NEOGEOCD'], arcade: ['ARC', 'ARCADE'],
  dos: ['DOS', 'MSDOS', 'PC', 'WIN', 'WINDOWS'], pc: ['PC', 'WIN', 'WINDOWS', 'PCWINDOWS', 'MICROSOFTWINDOWS'], amiga: ['AMI', 'AMIGA', 'CD32', 'A500', 'AMIGA500'], c64: ['C64', 'COMMODORE64'],
  spectrum: ['ZX', 'ZXS', 'SPECTRUM', 'ZXSPECTRUM'], msx: ['MSX', 'MSX2'],
  sg1000: ['SG1000', 'SG'], atari5200: ['A5200', '5200'], atari7800: ['A7800', '7800'], lynx: ['LYNX', 'ATARILYNX'], jaguar: ['JAG', 'JAGUAR', 'JAGCD'],
  ngpc: ['NGPC', 'NGP', 'NEOGEOPOCKET', 'NEOGEOPOCKETCOLOR'],
  wii: ['WII'], wiiu: ['WIIU'], '3ds': ['3DS', 'N3DS', 'NINTENDO3DS'], switch: ['NS', 'NSW', 'SWITCH', 'NINTENDOSWITCH'], switch2: ['NS2', 'SWITCH2', 'NINTENDOSWITCH2'],
  ps3: ['PS3', 'PLAYSTATION3'], ps4: ['PS4', 'PLAYSTATION4'], ps5: ['PS5', 'PLAYSTATION5'], vita: ['VITA', 'PSV', 'PSVITA'],
  x360: ['X360', 'XBOX360'], xone: ['XONE', 'XB1', 'XBOXONE'], xsx: ['XSXS', 'XSX', 'XS', 'XBOXSERIES', 'XBOXSERIESXS', 'XBSX'],
};
// Other platforms: a score labelled with one of these is about another version.
const OTHER_CODES = ['3DO', '3DS', 'CPC', 'AST', 'ST', 'ATARIST', 'JAG', 'JAGUAR', 'LYNX', 'CV', 'INT', 'IOS', 'MAC', 'MOB', 'NG', 'NS', 'NS2', 'SWITCH', 'PS3', 'PS4', 'PS5',
  'VITA', 'PSVITA', 'WII', 'WIIU', 'X360', 'XONE', 'XSXS', 'VIC', 'VIC20', 'ANDROID', 'LIN', 'LINUX', 'NGAGE', 'NSHI', 'STADIA', 'A5200', 'A7800', 'X68K', 'X68000', 'FMT', 'PC98', 'CDI', 'NGP', 'NGPC', 'WS', 'WSC', 'BBC', 'ACORN', 'ELECTRON', 'APPLEII', 'APPLE2', 'XBLA', 'PSN', 'VC', 'GCN2'];
const key = label => String(label ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const CODE_SYSTEMS = new Map();
for (const [system, codes] of Object.entries(SYSTEM_CODES)) for (const code of codes) CODE_SYSTEMS.set(code, [...(CODE_SYSTEMS.get(code) ?? []), system]);
for (const code of OTHER_CODES) if (!CODE_SYSTEMS.has(code)) CODE_SYSTEMS.set(code, []);
const isCode = label => CODE_SYSTEMS.has(key(label));

// Magazines that only covered one machine: their unlabelled scores are about that version
// (Zzap!64 reviewed the C64 game, CRASH the Spectrum one). Multi-format ones stay unlabelled.
const OUTLET_CODES = [
  [/^(?:zzap!?(?:64)?|z64|commodore (?:user|format|force)|64'?er)$/i, 'C64'],
  [/^(?:crash|y ?sinclair|your (?:sinclair|spectrum)|sinclair user|suser)$/i, 'ZX'],
  [/^(?:amiga (?:format|power|action|computing|joker|user international|force|mania)|am ?(?:format|power|computing|action)|cu amiga|the one (?:amiga|for amiga games))$/i, 'AMI'],
  [/^(?:st ?format|st (?:magazine|action|user))$/i, 'AST'], [/^amstrad action$/i, 'CPC'], [/\bmsx\b/i, 'MSX'],
  [/^(?:n64(?: magazine| gamer| pro)?|64 magazine|dengeki nintendo 64)$/i, 'N64'],
  [/^(?:pc ?zone|pc ?format|pc gamer(?: us| uk)?|pcg(?:us|uk)|pc powerplay|cgw|computer gaming world)$/i, 'PC'],
];
const outletCode = outlet => OUTLET_CODES.find(([pattern]) => pattern.test(outlet.trim()))?.[1] ?? null;

// The names behind the review box's abbreviations, for showing which publications reviewed a game.
const OUTLET_NAMES = { GR: 'GameRankings', MC: 'Metacritic', OC: 'OpenCritic', Fam: 'Famitsu', EGM: 'Electronic Gaming Monthly', GI: 'Game Informer',
  GSpot: 'GameSpot', GSpy: 'GameSpy', GameRev: 'Game Revolution', EuroG: 'Eurogamer', CVG: 'Computer and Video Games', NGen: 'Next Generation',
  NP: 'Nintendo Power', NLife: 'Nintendo Life', ONM: 'Official Nintendo Magazine', NWR: 'Nintendo World Report', OPM: 'Official PlayStation Magazine',
  OPMUK: 'Official PlayStation Magazine (UK)', OXM: 'Official Xbox Magazine', GT: 'GameTrailers', GMaster: 'GamesMaster', XPlay: 'X-Play', TOT: 'Total!',
  CP: 'Consoles +', JXV: 'Jeuxvideo.com', MMS: 'Mean Machines Sega', MM: 'Mean Machines', N64: 'N64 Magazine', GRadar: 'GamesRadar', Destruct: 'Destructoid',
  SP: 'Super Play', PCGUS: 'PC Gamer (US)', PCGUK: 'PC Gamer (UK)', PCZone: 'PC Zone', ASM: 'Aktueller Software Markt', TGM: 'The Games Machine',
  Z64: 'Zzap!64', YSinclair: 'Your Sinclair', SUser: 'Sinclair User', AmFormat: 'Amiga Format', AmPower: 'Amiga Power', AmComputing: 'Amiga Computing',
  AmAction: 'Amiga Action', VGCE: 'VideoGames & Computer Entertainment', HC: 'Hobby Consolas', VG: 'VideoGamer.com', TA: 'TouchArcade', Allgame: 'AllGame',
  CGW: 'Computer Gaming World', GB: 'Giant Bomb', Poly: 'Polygon', RPS: 'Rock Paper Shotgun', PO: 'Player One', '1UP': '1Up.com' };
export const outletName = outlet => OUTLET_NAMES[outlet] ?? outlet;

// Fields that aren't reviews.
const LAYOUT = /^(?:title|subtitle|state|align|na|width|qualifier|noprose|refs|collapsed|show_title|italic|headerstyle|subtitlestyle|uk|aggregators|reviewers|awards|award\d+(?:pub)?)$/i;
const AGGREGATORS = new Set(['MC', 'GR', 'OC', 'TOPCRITIC', 'MCU', 'MCUSER']);

// The template and its old name ({{VG Reviews}}), after comments and citations are gone.
const clean = text => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
function templates(text) {
  const out = [], start = /\{\{\s*(?:video game reviews|vg ?reviews)\s*\|/ig;
  text = clean(text);
  for (let match; (match = start.exec(text));) {
    let depth = 0, index = match.index;
    for (; index < text.length; index++) {
      if (text.startsWith('{{', index)) { depth++; index++; } else if (text.startsWith('}}', index)) { depth--; index++; if (!depth) break; }
    }
    out.push(text.slice(match.index + 2, index - 1));
  }
  return out;
}
function fields(body) {
  const parts = []; let depth = 0, link = 0, current = '';
  for (let index = 0; index < body.length; index++) {
    const two = body.slice(index, index + 2);
    if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
      if (two === '{{') depth++; else if (two === '}}') depth--; else if (two === '[[') link++; else link--;
      current += two; index++; continue;
    }
    if (body[index] === '|' && !depth && !link) { parts.push(current); current = ''; continue; }
    current += body[index];
  }
  parts.push(current);
  return parts.slice(1).map(part => { const at = part.indexOf('='); return at < 0 ? null : [part.slice(0, at).trim(), part.slice(at + 1).trim()]; })
    .filter(pair => pair && pair[0] && pair[1]);
}
// Wikitext → plain text with line breaks kept; {{Rating|4|5}} becomes "4/5", and the
// templates that only format a word ({{abbr|FC|Family Computer}}, {{ill|Maniac|de}}) keep it.
function plain(value) {
  let text = value.replace(/\{\{\s*rating\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)[^}]*\}\}/gi, '$1/$2')
    .replace(/\{\{\s*(?:abbr|ill|interlanguage link|nowrap|small|nobold|tooltip|sic|vgy)\s*\|\s*([^|{}]*)[^{}]*\}\}/gi, '$1')
    .replace(/\{\{\s*lang\s*\|[^|{}]*\|\s*([^|{}]*)[^{}]*\}\}/gi, '$1')
    .replace(/\{\{\s*(?:sfn|sfnp|efn|refn|harvnb|cn|citation needed|r|rp|nbsp|·|small)[^{}]*\}\}/gi, ' ');
  for (let previous; previous !== text;) { previous = text; text = text.replace(/\{\{[^{}]*\}\}/g, ' '); }
  return text.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/&nbsp;/g, ' ').replace(/[−–]/g, '-');
}
const GRADES = { 'A+': 100, A: 95, 'A-': 91, 'B+': 88, B: 85, 'B-': 81, 'C+': 78, C: 75, 'C-': 71, 'D+': 68, D: 65, 'D-': 61, F: 50 };
// Every score in one line, on a 0–100 scale. EGM and Famitsu panels ("9/10, 9/10, 8/10"
// or "10/9/9/9") average to one value.
export function lineScores(line) {
  const text = line.trim(), scores = [];
  const chain = /^(\d+(?:\.\d+)?)(?:\s*\/\s*\d+(?:\.\d+)?){2,}$/.exec(text.replace(/\s+/g, ''));
  if (chain) {
    const parts = text.replace(/\s+/g, '').split('/').map(Number);
    return parts.every(part => part <= 10) ? [parts.reduce((sum, part) => sum + part, 0) / parts.length * 10] : [];
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/gi)) {
    const value = Number(match[1]), scale = Number(match[2]);
    if (scale >= 3 && scale <= 100 && value <= scale) scores.push(value / scale * 100);
  }
  if (!scores.length) for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) { const value = Number(match[1]); if (value <= 100) scores.push(value); }
  if (!scores.length) { const grade = /^([A-F])\s*([+-]?)$/.exec(text); if (grade && GRADES[grade[1] + grade[2]] != null) scores.push(GRADES[grade[1] + grade[2]]); }
  return scores;
}
// "SNES: 9/10", "PC (Pixel Remaster): 88/100", "8.8/10 (US)" → the platform code, null when
// the line names no platform, or undefined for a label that isn't a platform (a region…).
function lineLabel(line) {
  const front = /^\s*([^:\d][^:]{0,40}?)\s*:\s*(.*)$/.exec(line);
  const back = !front && /^(.*?)\(([^)]{1,30})\)\s*$/.exec(line);
  const label = front?.[1] ?? back?.[2];
  if (!label) return { code: null, rest: line };
  const rest = front ? front[2] : back[1];
  const words = label.split(/[\s(),/]+/).filter(Boolean);
  const code = [key(label), ...words.map(key)].find(word => CODE_SYSTEMS.has(word));
  return { code: code ?? undefined, rest, inline: true };
}

// Just the review boxes of a page, small enough to cache: parseReviews reads them later.
export const reviewBoxes = wikitext => templates(wikitext).map(body => `{{${body}}}`).join('\n');

// [{ outlet, code: 'SNES' | null, value, aggregate }] for every review in the page's boxes.
// A box titled for a version ("Windows reception", "PlayStation 4 and Xbox One
// reception", "iOS version") is about that version: its unlabelled scores get its codes.
function titleCodes(title) {
  const words = plain(title ?? '').replace(/\b(?:reception|reviews?|versions?|releases?|re-?release|ports?|remaster(?:ed)?|editions?|and|the|of|for)\b/gi, ' ').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const codes = [];
  for (let index = 0; index < words.length;) {
    let used = 0;
    for (let size = Math.min(3, words.length - index); size > 0 && !used; size--) if (isCode(words.slice(index, index + size).join(''))) { codes.push(key(words.slice(index, index + size).join(''))); used = size; }
    index += used || 1;
  }
  return codes;
}

export function parseReviews(wikitext) {
  const reviews = [];
  for (const body of templates(wikitext)) {
    const entries = fields(body), names = new Map();
    const boxCodes = titleCodes(entries.find(([name]) => /^title$/i.test(name))?.[1]);
    for (const [name, value] of entries) { const custom = /^(?:rev|agg|aggregator)(\d+)$/i.exec(name); if (custom) names.set(name.toLowerCase(), plain(value).trim()); }
    for (const [name, value] of entries) {
      if (LAYOUT.test(name) || /^(?:true|false|yes|no)$/i.test(value.trim()) || /^(?:rev|agg|aggregator)\d+$/i.test(name)) continue;
      let outlet = name, suffix = null;
      const custom = /^(rev|agg|aggregator)(\d+)(?:score)?(?:_(.+))?$/i.exec(name);
      if (custom) { outlet = names.get(`${custom[1].toLowerCase()}${custom[2]}`) || `${custom[1]}${custom[2]}`; suffix = custom[3] ?? null; }
      else { const at = name.lastIndexOf('_'); if (at > 0 && isCode(name.slice(at + 1)) || at > 0 && key(name.slice(at + 1)) === 'GEN') { outlet = name.slice(0, at); suffix = name.slice(at + 1); } }
      const aggregate = custom ? /^agg/i.test(custom[1]) : AGGREGATORS.has(key(outlet));
      // A field suffix names the version reviewed; "_GEN" is the template's "general".
      const fieldCode = suffix && key(suffix) !== 'GEN' ? key(suffix) : null;
      const lines = plain(value).split('\n').map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        // A label that isn't a platform ("US", "Easy Type") leaves the field's platform.
        const label = lineLabel(line), values = lineScores(label.rest);
        if (!values.length) continue;
        const code = label.code || fieldCode || outletCode(outlet), value = values.reduce((sum, item) => sum + item, 0) / values.length;
        for (const each of code || !boxCodes.length ? [code] : boxCodes) reviews.push({ outlet: outlet.trim(), code: each, value, aggregate });
      }
    }
  }
  return reviews;
}

// Which of a page's reviews are about this system's version of the game. Reviews without
// a platform count only when this system had the original release (not a later port).
export function reviewsFor(reviews, system, { original = true } = {}) {
  const codes = new Set(SYSTEM_CODES[system] ?? []);
  const about = review => review.code ? (CODE_SYSTEMS.get(review.code) ?? []).includes(system) || codes.has(review.code) : original;
  // One value per publication: several lines (two Famitsu panels, US and AU scores) average.
  const byOutlet = new Map();
  for (const review of reviews.filter(about)) {
    const outlet = `${review.aggregate ? 'agg:' : ''}${key(review.outlet)}`;
    const entry = byOutlet.get(outlet) ?? { outlet: review.outlet, aggregate: review.aggregate, values: [] };
    entry.values.push(review.value); byOutlet.set(outlet, entry);
  }
  return [...byOutlet.values()].map(entry => ({ outlet: entry.outlet, aggregate: entry.aggregate, value: entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length }));
}
