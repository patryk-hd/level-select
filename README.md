# Level Select

A local-first game browser connecting curated recommendations, a Playnite-owned
collection, and a Steam wishlist. Search and filter across systems, genres,
release years, ownership and play status, with list and cover views.

**Where the project stands and what comes next: [docs/STATUS.md](docs/STATUS.md).**
It holds the roadmap, how scores work and the decisions log. Earlier plans written
with Codex (GPT) are archived in [docs/archive](docs/archive/).

Scores come from IGDB (critic and player ratings with review counts, plus
time-to-beat), Steam reviews and Playnite's imported scores, always labelled with
their source. Play Plan's suggestions rank your unplayed games by that score.

## Quick start

To give Level Select to someone without a terminal, build a one-click installer for
Windows or macOS: see [docs/INSTALL.md](docs/INSTALL.md).

Requires Node.js 22 or later (keep it updated: Node's security releases fix it in place). The browser app has no package dependencies.

```sh
npm run dev
```

Open http://127.0.0.1:8765. The first visit starts a one-minute setup guide (theme,
where your games live, a map of the app); **Setup guide** in the sidebar reopens it.
A fresh clone includes a clearly labeled demo library: 130 real games across PC,
consoles and emulators, with public box art and review scores from the catalog, and a
wishlist of real Steam games. Which store each game is on, play time and progress are made
up. No account, API key, CSV export or artwork archive is needed to try it.
`npm run sample:build` rebuilds the demo from the catalog and Steam's public store pages.

- **Game Atlas:** browse every system, pin favorites (including PC/storefronts), or compare a family using one score source. Systems are ranked by critic reviews of each version (from Wikipedia's review boxes) and IGDB player ratings (`npm run retro:lists`); the few with too little review data keep the original lists. A switch shows the original lists (fact-checked, original order) on every system.
- **Owned Games:** titles and copies grouped across platforms and stores.
- **Play Plan:** choose copies, order Up Next, track progress, browse completion albums and statistics, and get suggestions or a roulette pick.
- **Steam Wishlist:** structured decisions, target prices, ten-game reviews, comparisons and acquisition tracking.
- **My Atlas:** every Game Atlas game you've saved: favorites, wishlist, owned and play progress, with a filter for each.
- **Mods:** the best mods and ROM hacks of all time, ranked by how many respected sources pick them (`npm run mods:lists`), one tab per system, with each popular game's essential mods from Nexus Mods and Modrinth.

## Start the personal trial

Use the existing launcher or `npm run dev`, keeping the same browser and local
address so your saved tracking remains available. Open **Play Plan**: your queue
and suggestions now come before statistics, rewards and history.

1. Export a tracking backup from **Backup & import**.
2. Pick three games across modern and retro systems, choose the right copies and
   add them to Up Next. Start one, save a session note, then pause/resume it.
3. Review ten Steam wishes, try an undo, and reload to check that decisions persist.
4. Record any wrong match, unclear score, lost change or difficult action. Fixes
   to those daily flows take priority over adding controls.

Refresh the imported wishlist's saved Steam reviews with:

```sh
npm run ratings:refresh -- --wishlist --provider steam --max-requests 50 --drain
npm run ratings:refresh -- --status
```

Reload the page after refresh. Ctrl+C pauses safely; repeat the first command to
resume. If Steam asks us to wait, the command saves the retry time and stops.
The status command is offline. See [refresh and recovery details](ranking/README.md#k2-provider-snapshots).
Owned Steam copies require the existing product review and an exported tracking
backup; title-search IDs are never silently accepted.

Fetch IGDB ratings, Steam ids and time-to-beat for your library, wishlist and the
retro catalog (resumable; needs `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`), then
Steam reviews for your owned Steam games:

```sh
npm run igdb:refresh
npm run ratings:refresh -- --owned-igdb --provider steam --max-requests 50 --drain
```

## Saved tracking and upgrades

Open **Play Plan** from the navigation. Add games from your owned library,
recommendations or wishlist, or enter a title manually. Backlog selection is
separate from ownership. Matching releases share progress only after you confirm
the edition and platform in **Connect matching tracking**.

In **What should I play?**, filter by system, store/source, genre, favorites and
playing intent. Owned games are the default; opt into **Owned + planned games**
for manual entries whose ownership is not recorded. Up Next order takes priority;
editorial ranks only break ties within a selected system. Roulette uses the same
eligible choices and can exclude the last ten draws in this tab. Drawing does
not start a game or add it to your backlog. Suggestion filters are bookmarkable.

In **Steam Wishlist**, open a game to set its decision, interest priority, reason,
target price and review/snooze dates. **Review up to 10 games** saves progress,
counts keeps equally with archives, and offers Undo. **Compare two games** helps
choose between entries without removing the unchosen game. Record an acquisition
after confirming the edition; choose whether to add it to Backlog or Up Next.
Acquired games have their own view and export. The default records ownership
without adding a backlog commitment. See [wishlist instructions](library/README.md#the-wishlist-page).

On the first visit after this upgrade, **Review saved tracking** previews existing
favorites, progress, notes, pins and wishlist removals. Accept the migration in
**Backup & import** before editing. The original browser keys stay intact;
unknown games and unknown historical dates are preserved. All four screens then
share one copy of your tracking: the app keeps it in `library/data/tracking/` (each browser
keeps a copy in IndexedDB), and every screen refreshes when another tab or a paired phone
changes it. A copy served without the app (a static build) keeps it in the browser only.

Use **Export tracking backup** regularly, particularly before moving browser or
origin. Sample and personal workspaces have separate records and backups. This
backup covers saved tracking and history, not the full imported dataset or artwork.
When storage fails, an explicit session-only notice offers export and recovery.
Tracking backups now use version 7 to include history, journals, rewards, goals,
challenges, library matches and Steam product reviews; earlier backups/workspaces
remain supported. Save a fresh backup after upgrading.

Open a game in **Game Atlas** or **Owned Games**, then expand **Review library
matches** to compare the catalog release with each imported copy. Confirm the
edition, reject a different game, or reset to unreviewed. Title and alias matches
are suggestions until reviewed. Confirming an association updates ownership
filters and allows same-platform editorial context in Play Next; it does not merge
play histories or transfer provider scores. Changed title/platform/year metadata
requires reviewing an accepted match again. Decisions live in the browser's
tracking workspace and are included in **Export tracking backup**.

## On your phone

**On your phone** (sidebar) lets phones on your home Wi-Fi open Level Select while it runs on
your computer. It's off until you turn it on, and nothing goes through the internet.

- Turning it on starts a second address on your home network (the app's port + 1: 8766 for
  `npm run dev`, 8791 for the installed app; `RETRO_LIBRARY_PHONE_PORT` sets another).
- Pair a phone by scanning the QR code with its camera. A code works once, for 10 minutes.
  The phone keeps a signed cookie until you forget it there or turn phone access off.
- Only this computer's own network addresses are answered, and a phone can browse, get
  picks and track. Importing, updating and adding games stay on the computer.
- Your tracking (plans, progress, XP, notes) is kept by the app in `library/data/tracking/`,
  so this computer's browsers and your phones share one copy; each browser keeps a copy too.
  A browser that tracked games before hands them over the first time. If its tracking
  differs, nothing is lost: **Backup & import** offers it to download and merge.
- The first time, macOS may ask to allow incoming connections, or Windows to let Level
  Select through the firewall on private networks: allow it, or phones can't connect.

**Away from home**, the same page keeps a copy of your library where your phone can reach it,
for the Level Select phone app (an installable web app that works offline):

- Choose a folder your cloud app keeps in sync (iCloud Drive, Google Drive, Dropbox and
  OneDrive are found by themselves) or any other folder. Level Select writes
  `Level Select/level-select-copy.json` there, and rewrites it after every **Update data**
  and a minute after your plan changes. No cloud? Download it and AirDrop or send it.
- Set a passphrase (recommended): the copy is then encrypted (PBKDF2-SHA-256, AES-256-GCM).
  The passphrase is saved in `library/data/secrets.json` only.
- The copy holds your library, wishlist, scores and plan. Artwork stays on the computer: the
  copy uses each game's public cover (IGDB, Steam or the Game Atlas).
- On the phone, the app opens the file (Files, Drive) and keeps it, offline: nothing is
  uploaded. Each newer copy brings the computer's plan; the phone's own finished games and
  rewards are never overwritten. To bring the phone's changes back, export a tracking
  backup there and import it on the computer (**Backup & import**).
- `npm run build -- --phone` makes the phone app in `dist-phone/`. It needs https: the
  showcase site serves it at `phone/` (`LEVEL_SELECT_PHONE_APP` points the computer's QR
  code elsewhere).

## Play history and statistics

Choose **Finish** in a game's Play plan panel to record its achieved objective.
Optional details include dates, personal playthrough time, a rating from 0 to 5,
and a reflection. **Your play history** in Play Plan groups cards by year and
offers platform/status/search filters. Unknown dates have their own album.
Replays get separate records, and **Edit record** corrects an existing card.

Use **Session notes & milestones** while playing, or **Journal** on a history
card. Entries can be edited, hidden and restored. Time is entered as a total for
that playthrough; imported lifetime hours are kept separate.

Plan completion is finished games divided by current, explicitly selected backlog
commitments. A six-game plan with three finishes and one retirement shows **3/6
(50%), one retired and two remaining**. Starting a replay makes that game remaining
again while preserving its earlier card. Imports do not change plan membership.
The year summary separately shows recorded additions/removals and net plan size
change; these counts include repeated commitments and corrections.

## Optional progress rewards

In **Play Plan → Your progress**, choose **Enable progress rewards** to start XP,
cosmetic levels and up to three weekly goals. Existing finishes and imports earn
no new points. A dated main-game finish or written personal objective earns 100 XP
once per game; a reflection earns 10 XP per eligible locally finished playthrough.
Replays keep their history without repeating the first-finish reward. In a journal,
an achieved **Additional mastery objective** beyond a recorded main-game finish
earns 50 XP once per game. Ten distinct wishlist review decisions earn 20 XP once
per week; keeping games counts equally with archiving them.

Choose goals to continue a game, reach a milestone or review your wishlist.
Only activity recorded after choosing a goal counts. Dated session notes can
complete a continue goal. Replace or skip goals freely; unfinished weeks have no
penalty. The Monday calendar stays in the timezone saved at activation, including
after a backup restore on another device.

Levels use 100 XP per level by default, configurable from 50 to 1,000. Titles and
card frames are cosmetic. **Hide progress rewards** hides the presentation while
ordinary tracking remains available. **XP history & adjustments** explains earned
and reversed rewards. Correcting a finish or mastery record recalculates its XP;
restoring it restores the same reward. **Duplicate game identities** previews the
XP change before linking copies of the same edition; their histories stay separate.
These are personal local records, with no accounts, leaderboards or external
achievement verification.

## Challenges and personal seasons

Open **Play Plan → Challenges & seasons → Plan a challenge**. Choose a console
passport, decade tour, owned top ten, genre bingo, rediscovery or a personal season.
Previews use owned, available copies and shrink the board for smaller libraries.
Check the edition, platform and metadata matches before confirming. Acceptance
does not automatically queue or start games. Only rediscovery can opt into replays.

Each accepted cell keeps its selected copy, metadata and ranking snapshot. Later
catalogue edits leave it unchanged. **Substitute** previews a replacement while
preserving progress in the other cells; **Preview regeneration** starts a fresh
revision. **Rules & revision history** keeps the earlier rules, membership and
badge evidence. Missing imported copies retain their saved progress.

A new dated local finish of the declared objective fills a cell. One game fills
one cell; the same finish may contribute to different accepted challenge types.
Achieved journal milestones show progress before completion. Evergreen plans have
no deadline. Optional personal-season dates use the saved timezone and require
both the finish and its recording to fall within the window. Corrections update
the board, badge and XP together; ordinary imports cannot manufacture activity.

With progress rewards enabled, completing a board earns one bonus: 20 XP per cell
for passport, decade tour, rediscovery and personal season; 25 for owned top ten;
15 for genre bingo. Revisions never stack bonuses. Archive a plan to make room for
another of the same type; its history and earned badge remain. Tracking plans
still work when XP is disabled or hidden.

## Use your own library

Open **Import games** in the sidebar. Each source has a card with step-by-step
instructions; connect any mix of them. Everything is read on your computer and
saved in `library/data/` (never committed).

| Source | What you do | What you get |
|---|---|---|
| **Steam account** | Choose the account found on this computer, or paste your profile link | Which profile the next two read |
| **Steam wishlist** | Set *Game details* to Public, then **Import wishlist** | Your wishlist with prices, release dates and reviews. No browser extension needed |
| **Steam games** | Create a free Web API key at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) and paste it | Every game you own on Steam, with play time |
| **GOG Galaxy** | **Import from GOG Galaxy** (or upload `galaxy-2.0.db` from another computer) | Steam, Epic, GOG and every store or console linked in Galaxy |
| **Playnite** | Export a CSV with the *Library Exporter Advanced* add-on and drop it on the card | Your Playnite library, including emulated games and artwork |
| **ES-DE** | **Import from ES-DE** | Your ROMs with ES-DE's scraped names, descriptions and box art, even with the ROM drive unplugged |
| **ROM folders** | **Choose folder…** | Games found by file name in that folder |

The same game from the same store appears once. Playnite's copy wins, then
GOG Galaxy's, then Steam's. A ROM that's also in Playnite appears once too.

After connecting, choose **Update data** (or run `npm run update`). It re-reads
every connected source, rebuilds only what changed, rescans ROM folders, fetches
IGDB scores and time to beat for new games and Steam reviews for new products,
and shows what was added and removed. Python 3 is needed for the rebuild steps.

Your Steam Web API key is kept only in `library/data/secrets.json` (readable by
you alone). It's never shown again and never included in backups. **Forget
key** removes it, and you can revoke it on the same Steam page.

Saving files yourself still works: a Playnite CSV at
`library/playnite_library.csv` and a wishlist JSON at
`library/steam-wishlist.json` are picked up by **Update data**. ROM folders can
also be added from a terminal:

```sh
npm run roms:scan -- --add "/path/to/ROMs"
```

**Store currency** for wishlist prices is set in `library/data/store.json`, e.g.
`{"country": "de", "currency": "EUR"}` (default UK/GBP).

The individual steps still work on their own:

```sh
npm run library:update -- --csv /path/to/playnite_library.csv
```

On systems without Bash, use these equivalent commands:

```sh
python3 library/tools/build_site.py --csv /path/to/playnite_library.csv
node scripts/connect-library.mjs
```

For artwork, add `--backup-root /path/to/playnite_library_backup` to the CSV
builder. Missing artwork uses placeholders. To migrate data and artwork from an
existing copy of the original Playnite browser:

```sh
npm run library:import -- --source /path/to/playnite-library-site
```

Reload the local site after import. Each view uses its local snapshot when
available and its sample otherwise. See [library instructions](library/README.md)
for wishlist imports, optional metadata services and saved-edit migration.

## Provider ratings and source modes

Game details can show saved Steam approval, attributed VideoGamesCritic figures
and optional IGDB ratings for reviewed mappings. Start with
`npm run ratings:refresh -- --plan`, then `npm run ratings:refresh` to fetch the
small public Elden Ring seed. Add explicit Steam products with `--steam <appID>`;
`--wishlist` opts in IDs from your imported wishlist. Reload after refreshing.

In **Wishlist → Filters & sort → Rating source**, select Saved Steam ratings
(the default), VGC Score, optional IGDB or Imported Steam ratings. Cards, details
and genre cutoffs use that source. Unmapped games stay unranked; the initial real
seed still covers only Elden Ring. Use `--wishlist` to fetch more exact Steam
products in bounded batches; other providers need reviewed mappings.

Owned Games offers VGC/IGDB under **Rating field**, with **Selected rating:
highest first** sorting; multiple copies need narrowing. Game Atlas and
My Atlas offers these modes in **Sort**. They are work-level ordering, not
platform-specific reception. Coverage notices and “Why this order?” explain
positions and evidence. See [How ratings work](ranking/methodology.html).
Samples use clearly labeled fictional ratings. Personal snapshots/caches are
ignored by Git and excluded from public builds. See the
[provider guide](ranking/README.md#k2-provider-snapshots) for mappings, optional
credentials, cache behavior and limitations.

## Personal data and backups

The repository contains application code, the curated recommendation catalog,
and authored sample data. Personal snapshots in `library/data/`, imported artwork
in `library/assets/`, raw CSV/Steam exports, caches and backups are ignored by Git.
They remain on your computer and are **not backed up by pushing this repository**.
Do not force-add them, even while the repository is private: committed data
remains in Git history if the repository later becomes public.

Favorites, notes, hidden games, My Atlas entries and wishlist removals are kept by the app
in `library/data/tracking/` (private, never committed), with a copy in each browser. Use
**Backup & import** before moving computers. Back up your imported files separately.
Sample library edits use separate storage from personal library edits.

The local server listens only on `127.0.0.1` (and, with **On your phone** turned on, on your home network for paired phones) and serves the app and runtime data;
it does not expose raw exports, caches, backups or credential files. A static
build contains no authentication: anyone with access to its files can read its
included data. Artwork and fonts can make external requests; this is not an
entirely offline application.

## Builds and checks

```sh
npm test                 # Portable logic, launcher and privacy regression tests
npm run check:share      # Check files Git would include
npm run build            # Shareable sample-only site in dist/
```

The normal build always uses sample data, even on a machine with a personal
library. It never copies imported Playnite artwork. Publish **only `dist/`** for
a public demo. Serving the raw repository root does not provide sample fallback;
use the local server or the generated static build.

For your own private/offline copy:

```sh
npm run build:local      # Personal snapshots/artwork in dist-local/
npm run library:verify   # Validate imported copies and artwork (requires imports)
```

`dist-local/` is ignored and kept separate from the shareable `dist/` output.
Treat it as personal data. Both builds work without imported artwork.

GitHub Actions runs sharing checks, tests and the sample build on pushes and pull
requests. It has read-only repository permissions and does not publish the site.
See [contribution and release checks](CONTRIBUTING.md). No scanner guarantees
absence of secrets; inspect the staged diff before committing.

## Mac desktop dashboard

Build the optional launcher with `./launcher/build-app.command` (macOS 13+ and
Xcode or Command Line Tools). Open the resulting **Level Select.app** to start
the local server and browse the library. Keep the project folder: the launcher
points to that checkout. You can move the app to Applications or create a desktop
alias. Rebuild the launcher if you move the checkout.

The dashboard opens **Play** and has shortcuts to Play, Library, Wishlist and Game Atlas,
plus Restart and Stop & Quit. Closing it stops its server. It discovers Node.js,
including nvm installations. `./retro-library.command` is a terminal fallback;
it accepts `start`, `status`, `restart` and `stop`. An occupied port belonging to
another app is reported without terminating that app. No login item is installed.

## Catalog and artwork

Run `npm run catalog` after editing `data/source-catalog.json` or the migration
rules. Rankings retain the original editorial ordering. Normalization removes
known duplicates and isolates questionable entries, but does not independently
verify every game's platform, year or rank. See [catalog notes](docs/CATALOG.md).

Selected recommendation covers are bundled; others load from their recorded
sources. Attribution and limitations are in [artwork credits](docs/ARTWORK.md).
The MIT license covers the project's original application code and documentation;
it does not grant rights to game artwork, trademarks or third-party content.

## Hosting

Any static host can serve the sample-only `dist/` folder, including at a repository
subpath. `npm run build -- --demo` makes the public demo: every page (Play, Game Atlas,
Mods) then shows the demo library, and each says it's a demo.

The showcase site is `site/` (the home page, with screenshots of the demo) plus that demo
in `app/`. `.github/workflows/pages.yml` builds it on every pull request and deploys it to
GitHub Pages from `main` once the repository is public and Pages is set to deploy from
GitHub Actions (Settings → Pages). The existing `.openai/hosting.json` belongs to this project's Sites
preview. Fork maintainers must register their own Site rather than deploy to that
project ID. This setup does not automatically publish or change repository access.

## License

Original application code and documentation: [MIT](LICENSE).
Third-party artwork and content retain their respective rights and notices.

Local artwork is preferred when a cover has a local path. The local server caches image
responses privately in the browser for one day and supports ETag revalidation; code
and library data remain uncached. Remote cover URLs follow their host’s cache policy
and are not automatically saved as permanent local files. PC/storefront cards count
unique imported library games; completion requires a recorded finish attributable
to a matching copy, never merely imported playtime.
