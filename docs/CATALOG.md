# Catalog migration notes

The original eight self-contained HTML pages held 4,737 entries across 50 system/category lists. Their exact structured data is retained in `data/source-catalog.json`.

The initial migration produces 4,551 entries. All 186 records omitted from the active catalog are preserved in `data/review-queue.json`, with the original system, rank, title, genre, year, and reason. Duplicate aliases include the retained record ID. The total active + review count equals the source count.

## Changes

- Exact repeated names and selected regional/title aliases are consolidated within a system. Releases on different systems are retained separately.
- Entries explicitly marked `alt` are held for review because no distinct edition metadata was provided. They are not assumed to be verified separate releases.
- TBA releases and obvious placeholders are held for review.
- Super Mario All-Stars is removed from NES while its SNES entry is retained. [Nintendo's developer interview](https://iwataasks.nintendo.com/interviews/wii/super-mario-all-stars/1/0/) identifies its Super Famicom/Super NES release.
- Warcraft: Orcs and Humans is removed from SNES. [Blizzard's timeline](https://worldofwarcraft.blizzard.com/en-gb/story/timeline/chapter-01) identifies the original as a PC/Mac game.
- The former DOS list is called Classic PC (DOS & Windows), because it contains both DOS and Windows games. It does not claim all titles run in DOSBox.
- Arcade groupings are identified as collections rather than universally presented as individual hardware platforms. The former Cave list explicitly includes other arcade shooters.
- Source genre strings are mapped to consistent, multiple tags. Source strings remain available as `genreLabel`.
- Redundant platform suffixes are removed only when they match the actual platform. Original names remain searchable aliases. Legitimate titles such as Double Switch are preserved.
- Recomputed rank values retain the original relative order, with `sourceRank` recording the former position. No universal cross-platform score is calculated.
- Unverified hardware sales figures, end-of-life dates, and unsupported claims of community consensus are removed from the interface.

## Verification limits

The original lists name broad sources but do not link to the individual polls or describe a reproducible aggregate. The retained order is editorial. The migration is not an independent historical audit of all 4,551 retained titles, release dates, release platforms, or editions. In particular, modern platform assignments and regional release years warrant further work.

Artwork matches confirm that an exact normalized title exists in a source's artwork inventory; they do not establish ranking quality or validate every game fact.

## IDs and maintenance

A release ID combines the system ID and a deterministic title hash, so changing ranks, year metadata, or genre tags does not break tracking. `gameId` groups identical normalized titles as a convenience; it is not a verified cross-platform work/edition authority. Tracking uses the release ID.

When correcting a title, maintain aliases and plan an ID migration if the normalized canonical title changes. Never recycle an existing ID for a different game. Backups skip unknown IDs and report the skipped count rather than assigning tracking to a guessed match.

For fully sourced future entries, add record-level release and ranking references; do not turn a footer list of websites into a numerical consensus claim.

## Review-backed lists (2026-10-01)

`npm run retro:lists` (`scripts/retro-lists.mjs`) replaces the editorial order with lists ranked by reviews on every system where reviews support at least 20 games (36 of 50): critic scores from the "Video game reviews" box on each game's English Wikipedia page (parsed by `ranking/critic-reviews.mjs`, only the reviews of that system's version) and IGDB player ratings, combined by `reviewRating` in `tracking/score.js`. The result is committed as `data/retro-lists.json` and merged into `data/catalog.json` by `scripts/build-catalog.mjs`.

- A list keeps up to 100 games with enough evidence (three critic reviews or 15 player ratings; 100 ratings when there are no critic reviews, 30 for arcade games) and a score above the neutral 70.
- A system switches only when its reviews support at least 20 games. SG-1000, Game Gear, 32X, Atari 2600/5200/7800, Lynx, Jaguar, Neo Geo Pocket Color, PC Engine CD and MSX, and the arcade board collections (CPS, NAOMI, Cave), keep the legacy lists.
- Legacy entries keep their release ids: a list game takes over the entry with the same IGDB match or title (system suffixes such as "GG" and bracketed second names are ignored), and its old rank stays as `legacyRank`. Entries a list leaves out stay in the catalog with `rank: null` and `unlisted: true`. Game Atlas shows them in search, Saved Picks and when you own or track them.
- Each run fetches only what's missing or older than 30 days. The cache in `library/data/cache/retro-lists/` holds public data only and stays out of Git. A second run on the same cache gives identical files.

## The original lists, corrected (2026-10-01)

The original lists stay available in Game Atlas through the **Original list** switch, in their original order. `data/legacy-corrections.json` holds the fact check, applied by `scripts/build-catalog.mjs`:

- `rename`: the released title ("Zack and Wiki" → "Zack & Wiki: Quest for Barbaros' Treasure"). The old title stays a searchable alias.
- `remove`: not a released game on that system, with the reason (a rumour, prototype, homebrew, DLC or update, a re-release, a game on another system or arcade board, a duplicate, or no such game). The entry leaves the original list and is renumbered around, but stays in the catalog (`correction.removed`) so tracking keeps its title; Game Atlas shows it only to someone who tracks or owns it.

Every entry IGDB couldn't confirm on its system (714 of 4,551) was checked by hand against IGDB's platform data. Entries that couldn't be ruled out stay as they are. Platform tags in titles ("GG", "XSX", "Atomiswave", "X360", "GCN", "Arcade") are dropped. Release years follow IGDB's date for that system wherever IGDB has the game there (`legacy` in `data/retro-lists.json`). The catalog keeps each entry's corrected title as `originalTitle`, which matching uses, so a rebuild never depends on an earlier one.
