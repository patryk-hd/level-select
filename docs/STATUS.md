# Status and roadmap

The one living plan for Level Select. Updated 2026-09-28. Older plans written
with Codex (GPT) are kept for reference in [docs/archive](archive/); where they
disagree with this page, this page wins.

## Goal

A personal app for managing my game library (Playnite import), retro classics and
Steam wishlist, whose best features help me **decide what to play next** and
**shrink my wishlist**, backed by scores I can trust. Once the MVP works for me,
decide whether it becomes open source or a paid product.

## Principles

- **Gamer experience first.** Covers, clear choices, few words, fast decisions.
- **Useful and honestly labelled beats provably perfect.** Show where each score
  comes from and how many reviews back it; let me fix a wrong match afterwards
  instead of approving thousands up front.
- **Finish before adding.** No new systems (accounts, connectors, more gamification)
  until the MVP trial is done.

## Milestones

### M1 · Scores that actually appear — in progress

- [x] Play Next orders by rating instead of title; every suggestion explains its score.
- [x] Owned Windows games show as "PC", not the retro "Classic PC" list.
- [x] One shared rating rule for all views ([tracking/score.js](../tracking/score.js)).
- [x] IGDB pass (`npm run igdb:refresh`): ratings with counts, Steam ids and
      time-to-beat for owned games, wishlist and the retro catalog.
- [x] Steam reviews for owned Steam games (`npm run ratings:refresh -- --owned-igdb --drain`);
      Steam-only scores are shifted onto the IGDB scale (Steam runs ~10 points higher).
- [x] Scores on Owned Games (new default "Score" rating), Wishlist details and Game
      Atlas cards; "Score" sort in the Atlas; time-to-beat chips.
- [x] Demos, betas, soundtracks and comics are never suggested.
- [x] Fix matches: every Score section offers *Looks right* / *Wrong game* / *Use
      another IGDB game* (paste an igdb.com link). Library → "N matches to check"
      lists the uncertain ones. Corrections live in private
      `library/data/igdb-overrides.json`, win over automatic matching and survive
      refreshes; a pasted link is resolved on the next `npm run igdb:refresh`.

### M2 · A Play Next that decides

- [x] **Tonight** picker: Mood (genre-based guess) and Length (IGDB time-to-beat)
      chips → three cover cards with score and reasons. One slot per game, even when
      you own several editions.
- [x] *Not tonight* on a suggestion card (hidden until tomorrow; the plan is unchanged).
- [x] **Backlog Triage** (Play Plan): ten cards at a time, best-rated first:
      *Play soon* (joins the backlog as "Want soon") / *Maybe later* (asks again in
      90 days) / *Not for me* / *Skip*, with undo and keys 1–3, S, Z. Copies of the
      same game share one card.

### M3 · Wishlist Decision Engine

- [x] Wishlist decision card: Steam %, IGDB score, price, time on the wishlist,
      time-to-beat, and either "You already own this" (68 games match an owned copy)
      or the best-rated similar games you own. *Buy soon / Keep / Wait for a sale /
      Remove / Ask me later*, keys 1–4, S, Z.
- [x] Easiest calls first: already-owned, then weakest reviews, then longest-waiting.
- [x] "Remove on Steam" checklist with store links; unreviewed games say "Not reviewed".
- [x] Wishlist size goal with progress (on the Wishlist page and the Play home);
      saved in tracking backups. XP for review decisions already exists when
      progress rewards are on (ten decisions → 20 XP per week).

### M4 · One Play home, plain language — done

- [x] Play is the home: Continue (playing/paused games with your latest session
      note) · Tonight's picks · backlog triage · wishlist prompt. My plan, History
      and Progress are tabs; old links still land on the right tab.
- [x] Navigation reads Play · Library · Wishlist · Game Atlas · My Atlas · Import games (Saved Picks was renamed My Atlas on 2026-10-03: it holds owned and tracked games too, not only favorites).
- [x] Wishlist cards say "Steam 98% · 73k reviews"; rating summaries drop the
      technical wording and only mention refreshes that actually failed.

### Then: two weeks of real use

Fix only what gets in the way. Measure: time to choose a game, whether suggestions
led to play, wishlist size over time.

## How scores work

| Source | Used for | Notes |
| --- | --- | --- |
| **IGDB** | The main score for ranking, on every platform | Critic and player ratings with counts. Combined by evidence: a critic review counts as five player ratings, and a neutral 70 worth 25 ratings pulls thin evidence toward the middle. Editions without reception borrow their parent game's, labelled "from …". |
| **Steam reviews** | Badge on Steam games; score when IGDB has none | % positive with review count. Not mixed into the IGDB score: Steam percentages run higher and would unfairly lift PC games. |
| **Playnite** | Last-resort score | Imported critic/player scores without counts; always marked "few ratings". |
| **VideoGamesCritic** | Shown next to our score: cards (Library, Wishlist, Play, triage), game details, the wishlist review | VGC Score (critics from OpenCritic + Steam players, patch-aware), shown unchanged as "VGC 85" in its own colour, always with "Powered by VideoGamesCritic" linking to the game (their terms; on cards the credit sits under the card); never averaged into another score or used for ranking. Private cache `library/data/vgc.json`; 60 lookups an hour without a key, 5,000 a day with a free `VGC_API_KEY`. Steam games only. |
| **Game Atlas lists** (Wikipedia + IGDB) | Rank and score of games on the 37 review-backed lists (every system where reviews support 20+ games) | Critics: the scores in the "Video game reviews" box on the game's English Wikipedia page (EGM, Famitsu, GamePro, Mean Machines, Zzap!64, IGN…), only those about that system's version: labelled by platform, from a one-machine magazine, or unlabelled on the game's own page when that system had the first release. Players: IGDB ratings (25+), for the first release or IGDB's own page for a port. Same blend as above but the neutral 70 counts as 50 ratings, and critics are shifted down 2 points (median gap to players on 2,409 games). See `scripts/retro-lists.mjs`. |
| **Awards** (Wikidata, CC0) | Badges, details, Play and wishlist decisions | Game of the Year and category wins at The Game Awards, BAFTA, D.I.C.E., GDC Awards, Golden Joysticks, Spike VGAs and Japan Game Awards, plus GOTY nominations; hype awards ("Most Anticipated") are ignored. Ranking lift on top of the score: +3 for a GOTY win, otherwise +1 each for category wins and a GOTY nomination (max 2). Public data in `data/awards.json` (shipped; `npm run awards:refresh -- --shared` updates it). `npm run update` refreshes it weekly into `library/data/awards.json` (private, never committed), and your library uses whichever is newer; public builds use the shipped file. |

Matching: Steam app ids first (wishlist and owned Steam copies), then title + platform + year with review
volume as tie-break. ROM hacks, mods, DLC and bundles are excluded or penalised.
Low-confidence matches are stored but not used.

## Decisions log

- 2026-09-28 — Switched from Codex (GPT) to Claude Code. Strategy reset: pragmatic
  matching, IGDB as the main score source, planning docs archived in favour of this page.
- 2026-09-28 — Saved tracking can be reshaped freely (little real use so far).

## Trial fixes

- 2026-09-29 — First trial feedback: decisions weren't saving because a pending
  "saved tracking upgrade" blocked every edit (now applied automatically when it has
  no conflicts). Triage: "Play soon" goes to Up Next, new *Already played*, skipped
  games stay out for the day, "Decide on 10 more" works. My plan: *Finished*,
  *Retire* and *Remove* with undo. Wishlist: reviewed games aren't due again
  straight away (Keep: 90 days; Buy soon / Wait for a sale: 30), list view fixed.
  Game Atlas sorts by Score by default and details show the score instead of the
  legacy rank. The launcher and logo open Play. Other editions of a game you've
  handled no longer show up as new suggestions.

- 2026-09-29 — Second trial round: My plan tabs stay on My plan. Progression:
  rewards on by default; +2 XP per triage/wishlist decision, 100 XP per past
  (undated) finish, dated finishes count without an objective; rising level
  curve (100, 200, 300 … per level); "+XP"/level-up moments; 14 badges and a
  monthly added-vs-finished chart on Progress. Undo keeps history (events are
  never deleted). Games marked Owned in Game Atlas and wishlist purchases show
  in Library. Retro platform names from Playnite's emulated-game import map to
  the catalog and IGDB. Wishlist review now judges each wish against what you
  own: "You already own this" (editions/remasters included), else the closest
  owned game (series → franchise → IGDB similar) and how you felt about it
  (your answer, play history or Playnite hours) → play yours first / keep /
  keep the best / probably not for you. "Review against games you own"
  replaces "Compare two games". `npm run igdb:refresh -- --details` refreshes
  series and similar-game data.

- 2026-09-29 — Data updates: one step (`npm run update` or **Update data** in
  the app) archives old exports, rebuilds what changed, rescans ROM folders and
  fetches scores for new games. Playnite's new "Game Id" column supplies real
  Steam app IDs (1,379 copies) and "Genres". ROM folder scanner (file names only)
  adds retro games with Atlas art and scores. Wishlist prices follow the store in
  `library/data/store.json` (UK / GBP; Augmented Steam exports may show converted prices, which are ignored when their currency differs).

- 2026-09-29 — Look and feel: two themes, **Modern** (graphite and gold) and
  **Arcade** (neon, pixel headings, scanlines, buttons that press in), switched
  from the sidebar and remembered per browser (`theme.css`, `theme.js`). Every
  colour is a theme token. Dialogs and the details drawer animate open and
  closed, tabs and folds fade in, result grids rise in when a filter, sort or
  page changes (not on small redraws), and cards lift on hover. Reduced-motion
  settings turn all of it off. Gamification: a player card in the sidebar
  (level, title, XP bar, "+XP" float) on every page; "+XP" toasts say what
  earned them; levelling up opens a celebration with the next title; Progress
  shows the title ladder, how each kind of XP is earned (with your totals) and
  badge progress bars with the closest badge marked.

- 2026-09-30 — Wishlist ownership: "you already own this" no longer matches on
  the name alone (OPERATOR ≠ The Operator; a 2016 DOOM ≠ the 1993 one). IGDB's
  game type and edition parent now reach the app, so a wish is the same game,
  another edition, a newer version of what you own, or a remaster/remake of an
  original you own — the last is judged by how the original went ("You own the
  original · play it first / only if you'll play it again / probably not").
  Time to beat ignores lone "with extras" reports and endless games (>150h), and
  review prices always show your store currency.
- 2026-09-30 — Same-named games: owned Steam copies are matched to IGDB by
  their Steam app id first (1,321 now confirmed that way, up from 1,201), and a
  known app id vetoes a same-named game from another year — the 2022 "Call of
  Duty" app had been matched to the 2003 game. A link that contradicts the copy's
  own Steam app and year is never shown (no score beats another game's score),
  and the wishlist only says "you own this" when Steam apps, IGDB and release
  years agree. Copies IGDB can't identify (Call of Duty HQ) stay unmatched for
  "Matches to check".
- 2026-09-30 — Wishlist comparisons need the same kind of game. IGDB genres,
  themes and camera (first-person, top-down, side view…) are now stored; a
  series or franchise game must play alike (Mario Kart ≠ Super Mario Odyssey),
  and an IGDB "similar game" must share enough — a specific genre, the camera
  family and a theme, scoring 5+ in `tracking/gameplay.js` (tuned on the real
  wishlist) — so The Binding of Isaac is no longer judged against System Shock 2.
  The closest match comes first and the card names it ("same series ·
  first-person war shooter"). "Similar games you own" uses the same rule.
- 2026-09-30 — Awards and VideoGamesCritic. Awards come from Wikidata (three small
  queries; names are read from English or language-neutral labels) and attach by
  Steam app, IGDB page (an edition's parent too) or exact title within a year:
  240 library games, 83 wishlist games and 354 Atlas games have awards. They show
  as badges and a details section everywhere, as a "why" line and a small lift in
  Play suggestions and triage, and in the wishlist review: a GOTY winner with
  nothing you own to judge it by is suggested "Keep", and winners come last when
  deciding what to remove. VGC scores (see the table) show in details and as a
  review tile, with the trend since the latest patch.
- 2026-09-30 — A third theme, **Console** (light, 16-bit plastic, bevelled
  buttons, face-button colours). Review cards are game sheets: art with Steam,
  score, price and length tiles under it, the game's colours glowing behind.
  Decisions stamp the card and send it off (keep → right, remove → left, later →
  up, wait → down) while saving; the next card deals in. Presses leave a small
  burst, XP counts up, bars fill in, pages lift and rise between sections.
  Header controls share one 44px height; the Progress tab shows the level once.

- 2026-10-01 — Game Atlas lists backed by reviews. An audit of the legacy lists
  (4,551 games on 50 lists, carried over from the original project) found no per-game
  sources and no reproducible order. IGDB could match 79% of them, but only 30% had
  enough ratings to judge. Agreement between legacy rank and review score was moderate
  on the big consoles (Spearman ρ 0.6–0.77 for SNES, N64, GameCube, PS1, PS2) and close
  to zero or negative on smaller ones (Amiga 0.02, Atari 5200 0, Lynx −0.49, 32X −0.55).
  177 entries had release years off by more than a year (Star Fox 2 listed as 1995,
  released 2017). Some games sat on the wrong board or system (1942 in the Capcom CPS
  list, King of Fighters 2002 in the NAOMI list). Thin systems were padded to about 100.
  New: `npm run retro:lists` builds up to 100 games per system from critic reviews of
  that version (the review boxes on English Wikipedia; 27,665 reviews) and IGDB player
  ratings (694k), each linked from the game's details. Every system goes through it, NES
  to PS5 and Switch 2; 36 switch, with 3,062 games, 1,685 of them new to the Atlas.
  Systems where reviews support fewer than 20 games (SG-1000, Game Gear, 32X, Atari
  2600/5200/7800, Lynx, Jaguar, Neo Geo Pocket Color, PC Engine CD, MSX) and the CPS,
  NAOMI and Cave collections keep their legacy lists, labelled as such. Expansions that need the base
  game (Blood and Wine) aren't listed. Old entries a new list leaves out stay in the catalog with
  their ids, so tracking and owned copies keep working; search still finds them.
  Rules that keep reviews with the right game: a port counts only reviews of its own
  version, and a home version of an arcade game counts as the first release. A handheld
  or 8-bit computer version launched alongside other versions doesn't take their
  players' ratings. A spin-off that IGDB links to the main game's page doesn't take that
  page's reviews (Ocarina of Time: Master Quest, a Mario medal game). Arcade games count
  only reviews that name the arcade version. Classic PC runs to 1999 and arcade to 2004.

- 2026-10-01 — Original lists kept, fact-checked, and one switch away. Game Atlas has a
  **Ranked by reviews / Original list** switch next to the scope picker; the original
  (legacy) list stays viewable on every system, in its original order. Its facts were
  checked: every entry IGDB couldn't confirm on its system was reviewed by hand, and
  `data/legacy-corrections.json` records 257 corrected titles and 311 entries taken out,
  each with its reason. The removals cover rumours and updates on the Switch 2 list,
  Switch 1 and PC games filed as Switch 2, Virtual Console and "via Wii mode" entries on
  Wii U, CD-ROM games in the TurboGrafx HuCard list, pre-CPS games and NAOMI games in the
  Capcom CPS list, and Neo Geo, Model 2/3, Chihiro and Konami games in the NAOMI list.
  They also take out prototypes, homebrew, DLC, duplicates under another name, and games
  that don't exist. Platform tags left in titles ("GG", "XSX") are gone, and 506 release
  years follow IGDB's date for that system (132 had been off by more than a year). The
  order itself is unchanged: re-ranking from an AI's knowledge would just be another
  unsourced list. Ids never change; entries taken out stay in the catalog, out of
  browsing and search, so anything tracked keeps its name.

- 2026-10-01 — Why some lists are short. Game Boy (51) and Game Boy Color (33) are short
  because the evidence is: most of their games have no Wikipedia reviews and fewer than
  25 IGDB ratings, and dozens of licensed games score 70 or below. Two reviews instead of
  three would add only about ten marginal games each. The PS Vita list (48) was short
  because of bugs, now fixed. Reviews labelled for newer systems ("VITA", "PS4", "NS",
  "XONE"…) weren't recognised. IGDB's own pages for enhanced versions (Persona 4 Golden,
  Link's Awakening DX) lost their players' ratings. And the Vita was treated like a Game
  Boy-era handheld whose versions differ from the home ones. Vita now has 100 and Wii U
  100. Reading every platform label also stopped five ports borrowing other versions'
  reviews (an IGN review of Pac-Man on Neo Geo Pocket had counted for four other
  machines), which leaves Game Gear at 19 games, so it shows its corrected original list.

- 2026-10-01 — Game Atlas lists read in tiers. Browsing a system opens it in list order,
  in either list. The list is grouped under headings: Top 3, Top 5, Top 10, Top 25, then the
  rest, each with its rank range. The top 3 get gold, silver and bronze coins and a warm
  stripe in list view, and become three feature cards in grid view. The top 5 get an
  accent badge, the top 10 accent numbers, the top 25 stronger ones. Each theme draws them
  its own way (Arcade square pixel coins, Console bevelled ones), and they fit on a phone.

- 2026-10-01 — Browsing like EmulationStation. Game Atlas opens on a **carousel** of
  systems: one large slide each, with the family colour, a blurred backdrop from the #1
  game's cover, the top covers fanned out, list size and progress, and a strip of systems
  to jump to (arrow keys, the strip or the side slides move it). The Library has the same
  carousel for shelves: all games, each store, then each console; a shelf sets the
  Platform and Store filters. Both pages have a **Spotlight** layout: the list (in tiers on
  the Atlas) beside a large panel for the selected game. It shows the cover, rank coin,
  score with its evidence, awards, a description and screenshots over a blurred backdrop.
  Arrow keys move the selection; Enter or Open details opens the full details. On a phone
  the panel steps aside and rows open the game. Atlas descriptions are the opening
  sentences of the game's Wikipedia page (only a page about that game). Screenshots come
  from libretro and IGDB, in `data/atlas-details.json` (built by `npm run retro:lists`,
  loaded only by the spotlight). Library descriptions and backgrounds are Playnite's.
  Update data now refreshes **wishlist prices** every time: Steam answers price-only
  questions for 100 games a request, so a 577-game wishlist takes six requests. The first
  run found a sale on (396 prices changed).

- 2026-10-02 — About each system. Every carousel slide shows who made the system and how many
  sold, with an **About** button. The system dialog has a Wikimedia Commons photo, the opening
  of its Wikipedia article and the hardware: maker, release and end dates, units sold (with
  their date), processors, and the systems before and after it. A **From the list** section
  shows the highest-rated and most-reviewed games, the golden year, the most common genre,
  Game of the Year winners, the years covered, and how many you own and have finished. The
  hardware comes from Wikidata (CC0) via `npm run systems:refresh` into
  `data/system-facts.json`, never written by hand; the list facts are computed from the
  catalog, so they follow the list switch.

- 2026-10-02 — Polish and goals.
  - **Carousel:** the current tab sits in the middle of the strip, the last tab highlights,
    and scrolling past systems no longer flickers the tabs. Switching list, grid or
    spotlight keeps the carousel in place. Long system names wrap instead of sliding under
    the covers. The Atlas has an **All systems** back link once you're inside a system.
  - **Play Next:** two new rows of chips.
    - **Genre** shows the eight most common genres among the games that fit.
    - **Recently played** looks at your last five started or finished games (leaving out
      ones you rated low or didn't enjoy). It offers **More like them**, closest matches
      first, or **Something different**: games sharing none of those genres.
  - **Progress:**
    - Every level from 1 to 30 has its own title, and the ladder shows them all. The
      original titles keep their levels.
    - Badges went from 14 to 36, adding top-ten finishes, list goals, challenges, months
      with a finish, past games logged, replays, milestones, mastery and reflections.
  - **Challenges:**
    - The planner lists your systems and stores A–Z with game counts, and disables the
      ones the template can't use.
    - A **Store** filter (Steam, Epic, GOG…) was added.
    - **Owned top ten** works with all systems. Library games not yet matched to the Atlas
      count when the title and system match one list entry; they're labelled "title/platform
      hint" for you to check when accepting.
    - Boards start with your best-rated games and skip demos and extras.
    - The oversized confirmation checkbox at the bottom of the dialog is fixed.
  - **Dropdowns:** Library and Wishlist filters, History platforms and the Wishlist
    compare lists are now alphabetical.
  - **List goals** (Play → Progress): finish the top 10, 25, 50 or 100 of one system's list,
    of every system (ranked by score, one place per game), or of a release year. Any finish
    counts, past ones too. Goals are saved with tracking and included in backups.

- 2026-10-02 — Finishing games, awards and polish.
  - **Mark finished** is in every game dialog (Library, Wishlist, Game Atlas, Play, list
    goals), next to Start playing. **Today** records a dated main-game finish (XP); **Some
    time ago** records one without dates.
  - **Missing data:** a store date of 2021 sent Alien: Isolation's match to a later mobile
    port, so it got no scores at all. Now a release on another platform never beats the
    same title on yours. A re-run matched 14 more owned games, and Alien now has its
    scores, VGC Score and BAFTA award.
    - When Playnite has no cover or description, the IGDB match supplies them (Crash
      Bandicoot N. Sane Trilogy).
    - When a store dated a game later than its release, it shows the original year.
  - **Award seals:** winners get a laurel seal on the cover: gold foil for Game of the
    Year, dark with a gold edge and the count for other awards. Nominees keep the chip.
    There are no coloured borders: they would compete with hover, focus and the Atlas's
    gold/silver/bronze rank medals.
  - **Hover cards** preview what a chip means: the awards behind it, how a score is made up
    (critics and players with counts, Steam, VGC), and the hours to beat.
  - **Fixes:**
    - The Spotlight panel sticks by its bottom edge when taller than the window.
    - Arcade score boxes have padding.
    - Details dialogs keep Close in a solid bar.
    - Empty match panels no longer show as blank boxes.
    - The carousel no longer widens the Library page on phones.
  - **Click feedback:** Console has its own: the four face buttons pop out in a diamond.

- 2026-10-02 — The app is now **Level Select** (it was Retro Library), with an "L" mark and
  icon. Only visible text changed: storage keys, the backup format and the local server's
  endpoint still say `retro-library`, so saved tracking and backups keep working.
  The favicon URL carries a version (`?v=level-select`), because browsers cache tab icons
  for a day. The top-100 and methodology pages now have the icon too.

- 2026-10-02: **Import games.** A new page connects your games without exports or folder paths. Each card has step-by-step instructions.
  - **Steam:**
    - It finds the account signed in on this computer (or takes a profile link).
    - The public wishlist comes from Steam's own API, no browser extension needed.
    - Owned games come with a free Web API key. The key is kept in `library/data/secrets.json`, which only you can read.
  - **GOG Galaxy:** reads Galaxy's local library: Steam, Epic, GOG and linked consoles, with covers. You can also upload `galaxy-2.0.db` from another computer.
  - **Playnite:** drag in a CSV from the Library Exporter Advanced add-on.
  - **ES-DE:** reads its gamelists (scraped names, descriptions, box art) even when the ROM drive is unplugged.
  - **ROM folders:** chosen with the system folder picker.
  - **How it fits together:**
    - Sources write rows into `library/data/sources/`, and the library builder merges them with Playnite's. The same game in the same store appears once (Playnite, then Galaxy, then Steam).
    - ROM ids are the same from ES-DE or a folder scan, so tracking carries over.
    - **Update data** re-syncs every connected source first. An import starts the update by itself.

- 2026-10-03 — **Update progress you can trust.**
  - **Steps:** Update data lists all nine steps from the start. The bar grows only as steps finish and as the running one reports its own count (IGDB "50 of 900", Steam cache, Steam reviews, VGC).
  - **Current step:** highlighted, with its count, time left and time spent.
  - **No flicker:** the panel updates in place instead of being redrawn every 1.5 s.
  - **Problems:**
    - The update writes a heartbeat, and the app warns after 45 s of silence.
    - A step silent for 10 minutes is stopped as stuck, with a clear message.
    - Losing the app retries quietly.
  - **Stop** asks first, then lets the current step save its work (SIGINT), keeps finished steps and marks the rest "Not run". The next update picks up from there.

- 2026-10-03: **Clearer sources and updates.**
  - **Interrupted updates:** an update interrupted by quitting the app shows its last step as interrupted ("!") instead of spinning forever. The update records its current command's process id, so **Stop** can end a step still finishing in the background, and a step never outlives its update.
  - **Step explanations:** each step explains itself (for example what "Fetch Steam reviews" does).
  - **Import games:**
    - Each detected source says which file it was found in and what's read from it.
    - A privacy and permissions section lists what's read locally, what goes over the internet, and the one macOS prompt you may see (ROM folders on external drives or in Desktop, Documents or Downloads).
  - **My Atlas:** "Saved Picks" is now **My Atlas**, because it holds every saved Game Atlas game (favorites, wishlist, owned, play progress), not only favorites.

- 2026-10-03: **Stale ratings lock fixed.**
  - The Steam reviews step keeps a lock so only one refresh runs at a time. A refresh killed mid-way (an app restart) left it behind, and every later update failed with "Ratings refresh already running".
  - The lock now records its owner's process id, and a lock whose owner is gone is taken over automatically. An older lock with no owner counts as left behind after 30 minutes.

- 2026-10-05: **Owned games stand out in Game Atlas.**
  - A green **✓ Owned** pill sits beside the favorite heart:
    - in List, Grid and the Spotlight list;
    - in the Spotlight panel, under the score;
    - with its own look in Modern, Arcade and Console.
  - Covers stay clean. Grid cards use short system names (DC, PS2) so the pill fits. A library copy's pill opens it in Library.
  - The pill also shows for games you ticked as Owned yourself.
  - **Owned in the game dialog:**
    - it's ticked when the game is in your library, and can always be unticked (a wrong match, or a game you sold or lost);
    - unticking sets the library match aside for Game Atlas only, and your library keeps the copy;
    - ticking again brings the match back.
  - **ROMs:** a ROM from ES-DE or a folder scan now matches its Atlas game without review when the system and title agree. Before, each of these (about 490 in my library) said "Possible library match · review". Exceptions:
    - two Atlas games on that system share the title: you still choose;
    - you rejected the match: your decision wins;
    - the ROM is for another system: it no longer asks for a review.

- 2026-10-05: **PC list in Game Atlas.**
  - **PC (2000 onwards)** joins Classic PC (DOS and Windows, to 1999). The split is by the year a game came out on PC.
    - It's one list for all stores: Steam, GOG and Epic are shops, not platforms.
    - It's ranked like every other list, from critic reviews (Wikipedia review boxes) and IGDB player ratings. It picked 100 games from 8,577 candidates.
    - Store charts (sales, Steam review %) aren't used: they measure popularity, and Steam's percentages favour small games.
  - **Your PC copies count as owned on both PC lists.** A store copy matches without review when:
    - the title matches, including store editions ("… - Complete Edition", "GOTY", "The Final Cut");
    - the year is the same, give or take one;
    - only one game of that title is on that list.
  - **What still needs your review:** remasters and re-releases with another year (Skyrim Special Edition, Dead Space 2023). Doom 1993 goes to Classic PC and Doom 2016 to PC.
  - **Result for my library:** 35 of the PC top 100 are owned, and about 490 list games across all systems.
  - **List fixes on every system:**
    - An edition named after its game is merged with the game ("Control: Ultimate Edition", "Horizon Forbidden West: Complete Edition", "Divinity: Original Sin II - Definitive Edition"). Their places went to the next games.
    - A list game keeps its id when IGDB or Wikipedia renames it, so tracking stays connected.

- 2026-10-06: **Coverage check and list fixes.**
  - **Coverage check:** `node scripts/list-audit.mjs --systems pc,dos --reference file.txt` compares a list with a respected reference list and gives the reason for each game we leave out. It reads only the local cache, and reference lists stay local.
  - **References used:** PC Gamer's Top 100 (2025) and Metacritic's all-time top games for PC, PS1, PS2, PS3, PS4, N64 and Switch. Rock Paper Shotgun blocks automated access, so it wasn't used.
  - **Older consoles were fine:** PS1, PS2, N64 and PS3 lists already held about 80–85% of Metacritic's top games.
  - **Bugs found and fixed:**
    - The review parser didn't know the PC list, so it ignored "PC" and "Windows" reviews. GTA V, Red Dead Redemption 2 and KOTOR scored nothing on PC (23 of Metacritic's top 130).
    - A Wikipedia review box titled for one version ("Windows reception", "PlayStation 4 and Xbox One reception") now counts for that version only. Snatcher's reviews moved from PlayStation to Sega CD.
    - A later port still counts only reviews of that port. IGDB's player ratings cover all versions of a game, so the PC original's fans don't rank KOTOR on Switch. Ports with few reviews of their own (GTA V and RDR2 on PC, Hades on Switch) stay off the lists. (A version that briefly counted their players' ratings was taken back.)
    - A game that had an entry on the original lists keeps it, so two similar entries ("International Karate", "IK+") no longer take turns.
  - **Steam and VGC on the PC list:**
    - 87 of 100 PC list games have their Steam app id from IGDB.
    - Cards show "Steam 96%". The game dialog and Spotlight show Steam's review summary and the VGC Score, with the "Powered by VideoGamesCritic" link.
    - The "Fetch VideoGamesCritic scores" update step fetches them and keeps them private. They are context only, never part of the ranking.
  - **Weighting kept as it is:** each critic review counts as five player ratings, and a neutral 70 worth 50 ratings pulls thin evidence toward the middle.
- 2026-10-06: **Steam players for PC ports, and early access.**
  - **PC ports take their players' score from Steam:**
    - Steam reviewers played the PC version. IGDB's rating covers every version, so it still doesn't count for ports.
    - Steam's "% positive" is lowered by 6, the measured median gap to IGDB's scores for top games.
    - It weighs as much as the game's IGDB ratings, not Steam's hundreds of thousands of reviews, so evidence stays on one scale. Counting Steam's full review numbers let niche games at 98% flood the list.
    - It applies only to main games, remakes and remasters, not editions or bundles.
    - Red Dead Redemption 2 (#65), God of War (#17), Yakuza 0, Death Stranding, Braid and the GTA classics joined the PC list. PC Gamer coverage is 36 of 100.
  - **Early access:**
    - A platform's release counts from its full launch. A same-day 1.0 elsewhere isn't a port: Hades, Hades II, Dead Cells and Risk of Rain 2 joined Switch.
    - The platform a game was born on stays its original, early access included (Subnautica on PC). That covers releases IGDB doesn't mark as early access.
    - Baldur's Gate 3 now shows 2023, not its 2020 early access.
  - **Ids:** no list game changed id.
- 2026-10-06: **Ten themes and a theme picker.**
  - **Themes:** Modern (the default), Midnight, Arcade, Cyberpunk and Y2K are dark. Console, Handheld, Retro PC, Anime and Fantasy are light.
  - **Each has its own character:** type, signature details and a click effect. Examples:
    - Anime: hanko seals, manga panels and sakura petals.
    - Cyberpunk: cut corners and a glitch.
    - Retro PC: bevelled windows with navy title bars, and the teal desktop as the sidebar.
    - Fantasy: parchment, a wax-seal level badge and gold sparkles.
    - Handheld: dot-matrix, the case's corner, a green-tinted cover until you point at it, and a D-pad burst.
  - **The originals stay:** Modern is the calm default, Arcade is the 80s cabinet (Cyberpunk is the 2077 HUD), and Console is the 16-bit living room.
  - **The picker:** the sidebar's switch is now "Theme: name ▾". Its menu lists each theme with a colour chip and a line about it.
    - Pointing at a theme (or tabbing to it) previews it live; leaving the menu restores your theme.
    - It works with arrow keys and Escape, and on phones.
  - **Light-theme fixes** (contrast, glows) now follow the theme's tone, so a new light theme gets them automatically.
  - **Small details follow each theme's shapes too:** award seals, top-3 medals, top-10 markers, achievement badges, hover cards, toasts and progress tracks.
    - Cyberpunk: hexagonal medals and cut corners.
    - Y2K: glossy medals and glass.
    - Handheld: the case corner.
    - Retro PC: bevels.
    - Anime: ink rings and offset shadows.
    - Fantasy: gold-rimmed medallions and engraved capitals.
    - Midnight stays flat on purpose.
  - **Dark themes that tell apart at a glance:** each has its own surfaces, not just an accent.
    - Modern: warm charcoal under the gold.
    - Midnight: true black with no filled panels, only hairlines, and light headings.
    - Arcade: saturated synthwave purple, a pink sunset glow and a neon sidebar edge.
    - Cyberpunk: teal-black screens drawn in hazard-yellow lines, a cyan grid and a hazard stripe down the sidebar.
    - Y2K: deep blue glass (unchanged).
  - **Tests:** the theme list, the pre-paint script (`theme.js`) and the CSS palettes are checked to match, and browser-only scripts are syntax-checked.

- 2026-10-06: **Steam reviews refresh only what's due, 100 games a request.**
  - **Before:** "Fetch Steam reviews for new games" re-fetched almost every Steam game on each update.
    - A review summary counted as current for only 24 hours.
    - Games were fetched one per second, so 2,408 games took 40–70 minutes.
    - Every batch of 50 saved a full copy of all ratings that nothing read: 753 MB.
  - **Now ("Refresh Steam reviews"):**
    - New games are fetched always; wishlist games and releases from the last six months weekly; everything else monthly.
    - Steam's store answers 100 games a request, so a full refresh is about 25 requests (~45 s).
    - Delisted games, which the store doesn't return, fall back to the single-game request.
    - The step reports "N new, N due for a check · N still fresh".
    - Only the latest 5 saved copies are kept: 753 MB became 35 MB.
  - **Counts differ a little:** the store's summary filters off-topic activity, so its review count can be lower than the single-game endpoint's. RDR2 shows 851k reviews instead of 925k; the percentage is the same.
  - **Commands:** `npm run ratings:refresh` uses the same batching. Without `--batch`, `scripts/enrich-ratings.mjs` keeps the old single-game path.
- 2026-10-06: **Faster pages: content in 0.2–0.4 s instead of 1.5–2.3 s.**
  - **Measured** with the same check on `main` and this branch, three loads each (medians, before → after): Play 1.55 → 0.36 s, Library 2.2 → 0.38 s, Wishlist 2.33 → 0.32 s, Game Atlas 1.99 → 0.30 s, My Atlas 1.75 → 0.23 s.
  - Every page shows exactly the same text as before.
  - **Server** (`scripts/serve-cache.mjs`):
    - The library snapshot, catalog and ratings were rebuilt from scratch for every request: about 330 ms each, and up to four times per page.
    - They are now built once and reused until any file in `data/`, `library/data/` or `library/sample/` changes, which is checked on each request.
    - Code and data are kept by the browser but checked before each use (`no-cache` with an ETag): an unchanged file is a bodiless 304, and a change shows up at once.
  - **Pages:**
    - The Atlas downloads the 7 MB catalog once, not twice.
    - The catalog, your library, wishlist and ratings download at once instead of one after another.
    - Library and Wishlist no longer run their 10 MB / 1.5 MB data file twice.
  - **Less repeated work:**
    - Library ↔ catalog matching (35–140 ms) is reused until a match decision changes.
    - Play builds its suggestion list once per render, not twice (triage 113 → 15 ms).
    - The Wishlist stops copying your tracking data once per wish (first render 650 → 100 ms).
  - **Hover to preload** (Chromium browsers: Chrome, Edge, Brave, Arc):
    - Pointing at a sidebar link loads that page in the background, so the click opens it at once.
    - A page loaded ahead picks up the theme and tracking changes made since.
    - Safari and Firefox ignore it.
  - **Nothing jumps while a page loads:**
    - Pages used to paint an empty shell, then shift once their data arrived, pushing everything below down (or up).
    - Layout-shift scores before → after: Play 0.56 → 0, Wishlist 0.55 → 0, Library 0.28 → 0, Game Atlas 0.25 → 0, My Atlas 0.11 → 0, Import games 0.06 → 0.
    - The content area now stays hidden until its first full render, then fades in (180 ms) already in place; the sidebar never moves.
    - If a page's script fails, its content shows anyway after 3 s.
- 2026-10-07: **Lists and challenges count each game once, with more lists and their own tab.**
  - **Duplicates:** "Top 10 of all time" listed Persona 5 and Persona 5 Royal, and The Last of Us and its Remastered edition. Challenges could hold Chrono Trigger on two systems, or The Witcher 3 twice.
  - **One game, any version** (`tracking/families.js`): the same IGDB game, or an edition, bundle, remaster, expanded edition or port of it (traced through IGDB's parent links).
    - Remakes (The Last of Us Part I, Resident Evil 4 from 2023, Ocarina of Time 3D), sequels and standalone expansions (Half-Life 2: Episode Two) are games of their own.
    - The same title counts as one game within five years, unless IGDB knows both as different games (Ninja Gaiden on NES and its 2004 reboot).
  - **Lists** (`tracking/lists.js`) show each game once under its original name, at its best version's score; finishing any version counts.
    - Compilations (The Orange Box) are left out.
    - A standalone expansion gives way when its game is on the same list.
  - **Challenges:** a cell can't hold a game another cell has. Each picker lists a game once (per system on a console passport).
  - **New lists:**
    - Top lists by genre (RPGs, first-person shooters, roguelikes, metroidvanias, soulslikes, horror and more) and by decade.
    - The best of 22 iconic series (Zelda, Super Mario, Pokémon, Doom, Final Fantasy…), crossovers excluded.
    - "The games that shaped" first-person shooters, RPGs, strategy, platformers, survival horror and open worlds: an editorial timeline with why each game mattered.
    - Ready-made lists are one click away; a custom goal combines system, genre, year or decade and size.
  - **Data:** the list build now fetches, for list games only, IGDB's camera, series, keywords (roguelike, metroidvania…) and remake links, plus the parents of versions outside the pools (`igdb-extras.json`). Rankings are unchanged.
  - **Play** has a Challenges tab with list goals and owned-game challenges; Progress keeps level, badges and statistics.
  - **Faster challenge planner:** a preview took about 2 s with a 3,600-game library; now 0.1–0.2 s. The suggestion choices and library matches it needs are built once and reused until your tracking changes, and so are each template's candidates.
  - **Same names on one list** get their year: "Resident Evil 4 (2005)" and "Resident Evil 4 (2023)".
  - **XP and badges for lists:**
    - Completing a list goal records a list award (kept if the goal is removed): 10 XP per game on the list, at most 1,000.
    - XP needs at least one of the finishes that completed it to be logged after the goal was set. A list already finished when set earns the badge only.
    - Taking back one of its finishes takes the award back, XP and badge with it, until the list is complete again.
    - New badges: Historian (a "games that shaped" list), Series master, Decade explorer and Genre expert.
    - Tracking schema 8 adds `listAwards`; older workspaces and backups upgrade on read. Awards are recorded by the tracking client (they need the catalog); XP still follows from state alone.
  - **New challenges:** Series sampler (three owned games from one iconic series, 20 XP each) and Genre history run (three owned games from a "games that shaped" timeline, 25 XP each). The planner shows how many owned games fit each series or timeline.
- 2026-10-08: **First-run setup guide, ahead of handing Level Select to a friend.**
  - The first time Level Select opens in a browser, a five-step guide (`welcome.js`, `welcome.css`) explains it in about a minute:
    1. **Welcome:** what it is and three promises (stays on this computer, scores with sources, less browsing).
    2. **Pick your look:** the ten themes as tiles; choosing one restyles the app on the spot.
    3. **Where do your games live?** Steam, GOG Galaxy, Playnite, emulators and ROMs. Each shows its state in this copy of Level Select: ✓ Connected, found on this computer (a Steam account, Galaxy, ES-DE; these start ticked) or Not connected. Connections belong to the copy, not the browser, so a new browser on a set-up copy shows them connected.
    4. **Your map:** the six sections, each in a line, and how XP works.
    5. **Ready:** "Import my games" opens Import games at the first chosen library still to connect (any already connected are named as such), "Open my library" when they all are, or "Explore the Game Atlas" with the example library for someone just browsing.
  - **Skip setup** or Escape ends it. Closing the browser half-way resumes at the same step next time. **Setup guide**, at the bottom of the sidebar, reopens it.
  - A browser that has used Level Select before (anything saved) is never interrupted.
  - Choosing a theme in the guide crossfades the page under it; the sidebar no longer flashes in front of the guide during the crossfade.
  - The guide is loaded only when it opens, so pages load as before. It uses the theme tokens, keeps one height for every step (the buttons don't move) and fills the screen on a phone.
  - The sample library's notice now links to Import games (it pointed at a "Library tools → Update library" path that no longer exists).
- 2026-10-09: **One-click installers for testers, and Level Select on Windows.** Details and tester notes: [INSTALL.md](INSTALL.md).
  - `npm run package -- --windows | --mac` builds `dist-installers/Level-Select-Setup-<version>.exe` and `Level-Select-<version>-mac-<arch>.dmg`.
    - Each carries the app (only files Git sees, never ignored ones) and its own Node.js 22. Windows also carries Python's embeddable package for the library rebuild.
    - The **Installers** workflow builds the Windows installer on GitHub's Windows machines, installs it silently and checks it end to end (`scripts/check-windows-install.mjs`). It then attaches the installer to the run.
  - **Windows:**
    - Per-user install, no administrator rights; Start menu and desktop shortcuts.
    - A notification-area icon (`launcher/windows/LevelSelect.ps1`) opens sections and stops the library.
    - The uninstaller keeps imported games unless you ask.
  - **Mac:** the existing dashboard app, packaged. It copies the app to Application Support on first open (and on upgrade, keeping your data) and runs it with the bundled Node.
  - Installed copies use their own address (8790), so their browser data never mixes with a project-folder copy (8765).
  - **Windows fixes** (`scripts/platform.mjs`):
    - Steam is found through the registry on any drive; GOG Galaxy through `%ProgramData%`; ES-DE installed, portable (`%ESPATH%` and its ROM folder) or through EmuDeck.
    - Playnite's folder is detected, so Import games and the guide say it's there.
    - **Choose folder** opens Windows' folder picker.
    - The updater runs the bundled Python in UTF-8 mode (Windows' code page broke titles like Pokémon).
    - Stop recognises the update's own processes; opening the browser and the server's hidden window work.
  - A missing Python now says what to install instead of "spawn python ENOENT".
  - **Stop on Windows:** Stop asks the update to end through a stop file. Windows ends a process outright instead of signalling it, which left the running step going and its files locked. The installer and uninstaller also end anything still running from the app's folder.
  - Python's checksum is pinned (it matches the one python.org publishes).
  - **Python on a Mac:**
    - Level Select looks for a real Python (Homebrew, python.org, Apple's command-line tools) and never runs Apple's `/usr/bin/python3` stand-in.
    - Without one, Import games starts with a "Python 3" card: three steps for python.org's installer, other ways, and **Check again**.
    - The setup guide mentions it, and Update data explains it instead of failing obscurely.
  - **Privacy:**
    - Installers leave out dot-folders; `.openai/hosting.json` (a Codex hosting project id) is no longer tracked.
    - `LICENSE` names "The Level Select authors".
    - The catalog scripts' User-Agent takes a contact from `LEVEL_SELECT_CONTACT` instead of a built-in GitHub profile.
    - The Mac app's bundle id is neutral.
    - `check:share` now fails if a shared file contains your Git name or email, user name or home folder (read on your computer, never written down).
  - **Security:** the local server answers only requests addressed to `127.0.0.1` or `localhost` on its port. A website rebinding its domain to your computer (DNS rebinding) could otherwise read your library and Steam account.
    - Cross-site requests other than plain links are refused (`Sec-Fetch-Site`). A `<script src>` on another site could otherwise run your library file and read it.
    - The server also sends `Cross-Origin-Resource-Policy: same-origin`, refuses to be framed and sends no referrer.
  - **Your own score keys** (Import games → Scores):
    - **IGDB:** a five-step walkthrough for free Twitch developer keys (two-factor sign-in, a Confidential application, Client ID and a new secret). The keys are checked with Twitch and IGDB before saving.
    - **VideoGamesCritic:** works without a key. The card shows how many games are waiting and how many hourly updates that takes; a free key from videogamescritic.com/developers does them all.
    - Keys are saved only in `library/data/secrets.json`; the page sees only whether each is set. Saved keys win over the environment (`IGDB_CLIENT_ID`…, `VGC_API_KEY`).
    - Installed copies look up IGDB only for your own games (the Atlas ships with its scores), and VGC looks up your games before the Atlas's.
- 2026-10-10: **Installed Steam games, Family Sharing included.** A tester asked whether games from Steam's shared libraries show up. Steam's owned games list (Web API key) never includes Family Sharing games, so a new card, **Import games → Steam → Installed on this computer**, reads Steam's own files:
  - **Which folders:** every library folder Steam lists (`steamapps/libraryfolders.vdf`, one per drive). On Windows, Steam itself is found through the registry.
  - **Which games:** each installed game's `appmanifest_<id>.acf`. Steam's store says what each app is, so soundtracks, tools (Proton, redistributables) and DLC are left out.
  - **Family Sharing:** a game counts as shared when another account's licence installed it (`LastOwner`), or, when Steam's file doesn't say, when the owned games list doesn't have it. Shared games show **Family Sharing** as a store.
  - **No duplicates:** installed games come after every other source, so they only add games no other source has. It needs no account or key, so it also brings in installed games for anyone without a Web API key.
  - Only installed games: Steam doesn't let other apps see a family member's library. No Steam ID is saved.
- 2026-10-10: **Add games by hand.** For what no import reaches: cartridges and discs, Switch or PlayStation games, stores Level Select can't read. **+ Add game** in the Library, or **Import games → By hand**:
  - **Search:** the Game Atlas always (it ships with the app). With IGDB keys, IGDB covers every game on every platform; without them, Steam's store. IGDB results put the title you typed first, then games before their editions, then the most rated.
  - **Check the details:** choose the platform you own it on (with each platform's release year), and whether it's a physical copy or which store it's from. Title and year can be changed. Platform names follow the ones your library already uses. If the game is already in your library, a note says where.
  - **Cover:** the search result's cover is saved with the game, so it shows offline. You can use your own picture instead (PNG, JPEG or WebP, up to 8 MB; checked by its contents, not its name).
  - **In the library at once, without Python:** games are kept in private `library/data/manual-games.json` (covers in `library/data/covers`), and the server adds them to the library as it serves it. A game you already have under the same title gets the new copy, so a Switch copy sits next to your Steam one.
  - **Scores:** an IGDB pick is saved as the confirmed IGDB match, so scores and time to beat need no guessing. A Steam pick gets Steam reviews. Adding a game starts an update that fetches them.
  - **Edit or remove:** open the game in your Library and choose **Edit**.
  - **No duplicates by mistake:** the same game on the same platform from the same store (or physical twice) can't be added; the window says where you have it, with a link. The same platform from another store or format asks first ("Yes, I own this copy too"); another platform is just mentioned. The same IGDB game or Steam app always counts as the same game; titles count when their years are within one. The server checks too.
  - **Scores like any other game:** IGDB (an IGDB pick is the match; others are matched by title, platform and year), VideoGamesCritic (with a Steam id), awards and Game Atlas links. Steam reviews go to copies you own on Steam, as for imported games.
- 2026-10-10: **Fix details of imported games.** **✎ Edit details** on any game in your Library: for an imported copy, fix its title, year, platform or cover (your own picture, or one from a search result: **Search for the right title, year and cover**). The window shows what the import says.
  - Fixes are kept by copy id in private `library/data/corrections.json`, with only what differs from the import, and applied as the server serves the library. They survive every import and rebuild, need no Python, and the update reads them too, so IGDB matches the corrected title.
  - **Undo all my changes** goes back to the import. A game with several copies first asks which copy.
- 2026-10-12: **Mods: the best mods and ROM hacks of all time.** A new section in the sidebar.
  - **Ranking by consensus:** how many respected sources pick each mod, recorded by hand in `data/mods-research.json` with a link to each source:
    - ModDB's Mod Hall of Fame (MODHOF) and Mod of the Year Players' Choice winners (2002–2024);
    - PCGamesN's 100 best mods, PC Gamer's best total conversions, Wikipedia's account of modding;
    - Retro Dodo's ROM hack lists (all time, SNES, Super Mario World, N64, Super Mario 64, Pokémon, NES, GBA, Metroid);
    - PokéCommunity's and r/PokemonROMhacks' Hack of the Year;
    - okimpala's essential SNES and NES hacks, which only confirm other picks (they count half).
  - Ties go to the mod more Wikipedias cover (Wikidata), then the one more IGDB players rated, then its position in a ranked list.
  - **IGDB** adds cover, year, base game, description and links. A match must agree on the title, and on the base game when IGDB names one: "Crusader Kings III" isn't "Crusader Kings II".
  - **Tabs per system** (All, PC, NES, SNES, Nintendo 64, Game Boy Color, Game Boy Advance, Nintendo DS, Mega Drive / Genesis). Filters: kind (total conversions & overhauls, multiplayer, became games, fixes & restorations, gameplay & additions, ROM hacks), search, sort, and **Games I own**. Mods for games in your library are marked.
  - **Medals, as in the Game Atlas:** in ranked order the list reads in tiers (Top 3, Top 5, Top 10, Top 25, the rest), with gold, silver and bronze coins for the top 3. Each mod keeps its place on the tab's list whatever the filters, so **Games I own** still shows where each one ranks.
  - **Essentials:** each popular game's most endorsed mods on Nexus Mods (its 24 most downloaded games) and Minecraft's most followed on Modrinth, adult mods left out. Games you own come first.
  - `npm run mods:lists` rebuilds `data/mods.json`, which ships with the app, so testers need no keys.
  - Not yet recorded: ModDB's 2025 Mod of the Year (its results page couldn't be read). Two notable gaps in the sources' coverage: Project M and Smash Remix.
- 2026-10-12: **IGDB tokens:** when Twitch withdraws a token before it expires, the app asks for a new one once instead of failing until the old one runs out.

## Not before the MVP

Publishing, accounts, cloud sync, social features, new store connectors, automatic
Steam wishlist edits, price alerts, new reward types, preferred-copy / best-version work.

## Commands

```sh
npm run dev                                          # app at http://127.0.0.1:8765
npm run igdb:refresh                                 # IGDB ratings, Steam ids, time-to-beat (resumable)
npm run igdb:refresh -- --status                     # offline coverage summary
npm run ratings:refresh -- --owned-igdb --drain      # Steam reviews for owned Steam games
npm run ratings:refresh -- --wishlist --provider steam --drain
npm run retro:lists                                  # review-backed Game Atlas lists (IGDB + Wikipedia), then the catalog
npm run mods:lists                                   # the Mods section: sources' picks + IGDB, Wikidata, Nexus Mods and Modrinth
npm test
```

IGDB needs `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` in the environment (a free
Twitch developer app, client type *Confidential*).
