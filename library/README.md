# Owned library & Steam wishlist

A local, static browser for your Playnite game library: search, filter, and
browse your collection with cover art, platform badges, and duplicate/
multi-platform grouping — plus a second page for triaging your Steam wishlist.

Two pages, linked from the sidebar:

- `index.html` — the owned library, built from a Playnite CSV export.
- `wishlist.html` — the Steam wishlist, built from `steam-wishlist.json`.

## Viewing it

This is now part of Level Select. From the project root, run `npm run dev`
and open `http://127.0.0.1:8765/library/index.html`. The shared navigation links
Recommendations, Owned games, Steam wishlist and Systems. Use a local server;
JavaScript modules do not work reliably by opening the HTML file directly.

Without local imports, the server and normal build use the examples in
`library/sample/`. Sample ownership, playtime, prices and reviews are illustrative.
Importing a snapshot replaces the sample for that view without editing the UI.

## Connections and saved edits

Play Plan now shares progress and backups with the existing screens. On upgrade,
review saved tracking before editing; legacy browser keys remain available for
recovery. Sample and personal workspaces stay separate. See the
[tracking guide](../tracking/README.md) for migration, backup and current limits.

Multiple copies of a title are currently grouped into one entry; same-name reboot
grouping still needs correction. Title and alias matches suggest catalog entries
without claiming ownership. Expand **Review library matches** in either game's
detail panel to compare individual copies, confirm an edition, reject a match or
reset it. Confirmed other-platform copies never imply ownership on the listed
system. Changed title/platform/year metadata requires another review. Decisions
are included in version 7 tracking backups and do not merge play histories or
transfer ratings; provider mappings remain separately reviewed.

Use **Backup & import** to export/import favorites, visibility, notes, and Steam
wishlist removals. Existing storage keys are preserved when using the same origin.
Browser storage is tied to the address and port; moving to a different origin
requires exporting from the old site and importing here. The original site's
`overrides.json` export is accepted, and the existing overrides export still works.

Game-title search in Game Atlas, Owned Games, Steam Wishlist and Play Plan uses
local title/alias matching. All query words must occur in one title or alias; only
the last word may be incomplete (`divi`, `super mari`). Numbers remain exact, so
`division 2` cannot match Division 20. Capitalization, accents, punctuation and
possessives are normalized. Descriptions, publishers, tags, platforms and stores
do not expand title results; use the available filters for those attributes.

Search defaults to relevance: full titles, consecutive phrases, other complete-word
matches, then prefixes. Explicit title, score and date sorts remain selected.
An active system-rank cutoff keeps its editorial order. Up Next keeps its manual
queue order and wishlist Top by genre keeps its rating order. If there are no direct matches in the current filtered selection, up to
five **Did you mean** buttons offer title corrections. These allow one edit or
adjacent letter swap across the entire query, in a word of at least five letters,
never in numbers. Selecting a suggestion searches that title without changing
filters or any saved game data. Suggestions never become automatic ownership,
edition or review-source matches. No service, index server or network call is needed.

Searches, filters, views, page sizes and game details have bookmarkable URLs.
Platform and source filters must match the same owned copy. Wishlist removals
remain local; they never change your Steam account.

## Updating the library

CSV rebuilds now separate entries with differing title, release year, platform,
developer or candidate Steam product ID. Copies missing year/platform/developer
information remain separate. Matching imported details form a browsing group,
not a confirmed edition identity; each copy retains its history and ratings.

The updater reads the previous generated snapshot to preserve stable groups and
old note references. Before regrouping an existing output it saves a private
`library-data.before-regrouping-<content-hash>.js` recovery file beside it. Malformed
previous snapshots stop the update. When writing a preview elsewhere, pass
`--previous /path/to/current/library-data.js` as well as `--out`.

After a split, **Preserved group notes** shows any notes/favorite/hidden choices
from the earlier group. Review and explicitly append notes to a release if they
apply; old records remain intact. Set favorite/hidden separately for the new entry.
Old bookmarked group links offer the resulting releases. Browser edits remain in
tracking backups; generated lineage and artwork still require the source dataset.

To roll back regrouping, stop rebuilding, copy the appropriate recovery file over
`library/data/library-data.js`, run `npm run library:connect`, then reload. This
does not roll back browser tracking: notes written to a new release remain in the
tracking backup and reappear when that release group is restored.

1. In Playnite, export your library to CSV (the same format used originally —
   columns like `Name`, `Platforms`, `Sources`, `Tags`, etc.).
2. Rebuild the site data:

```bash
./library/tools/update.sh --csv ~/Downloads/playnite_library.csv
```

Run from the project root. With no arguments, `./library/tools/update.sh` uses
`library/playnite_library.csv`. New external exports are read from `--csv`; copy the
latest export to that default location if you want no-argument updates to use it.
Previously imported artwork is reused. To import new artwork, pass
`--backup-root /path/to/playnite_library_backup` (containing `libraryfiles/` and
`library/games.db`). The script also refreshes the recommendation connections.
Invalid headers, duplicate IDs, empty titles and empty exports leave the existing
snapshot unchanged. Python 3 and Node.js 20+ are required.

### Genres

Playnite's CSV export has no genre column (and its `Categories` column is
usually empty), so genres come from IGDB — the same database Playnite's own
metadata plugin uses, which unlike the Steam store also covers console and
emulated titles.

It needs a free Twitch application (IGDB is owned by Twitch). At
[dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps), register an
application — OAuth Redirect URL can be `http://localhost`, category
"Application Integration" — then copy its Client ID and generate a Client
Secret:

```bash
export IGDB_CLIENT_ID=your_client_id
export IGDB_CLIENT_SECRET=your_client_secret
./library/tools/update-genres.sh
```

That fetches genres for every library title (one search per title at IGDB's
4 requests/second, so roughly ten minutes for a 2,400-game library) and then
rebuilds both pages. The
credentials are read from the environment only; the derived access token is
cached in `~/.cache/playnite-library-site/`, deliberately outside this folder,
since the local web server serves everything inside it.

Re-running is cheap — only titles that aren't already cached are requested, so
adding games to Playnite costs just those new titles.

**Genre sources.** Each game takes the first source that has it: IGDB, then the
Steam store cache, then Wikidata. Whichever answers, the label is mapped onto
one shared set of main categories (Action, Adventure, RPG, Strategy,
Simulation, Racing, Sports, Casual, Massively Multiplayer), so a game is filed
the same way on both pages no matter where its data came from. A fine-grained
genre such as "Action-adventure" contributes both Action and Adventure, exactly
as Steam would tag it, and the specific label is still searchable in the Genre
dropdown.

Two alternative sources exist if you'd rather not create a Twitch app, though
both are weaker: `tools/steam_enrich.py --library` (Steam only, so no console
games) and `tools/wikidata_genres.py --library` (no key at all, but Wikimedia
throttles hard). The Main genre / Genre filters only appear once some genres
exist.

Games with the same name (case/whitespace-insensitive) are grouped into a
single card, even if Playnite has them as separate entries per platform. Each
group's card shows a badge for every platform it's owned on; the details
panel lists every underlying copy (platform, source and playtime). **Rating field**
selects imported critic, imported community, personal Playnite or legacy values.
A rating sort/filter requires one matching copy; narrow platform/store filters
for multi-copy titles. **Rating evidence by copy** explains source limitations.
Reimport the original CSV to recover components from an old maximum-only snapshot.
Default order is alphabetical; artwork does not affect reception ordering.

## Play history and completion

The shared Play plan panel offers **Finish** with an achieved objective and
expandable optional dates, time, rating and reflection. Finishing creates a card
in **Play Plan → Your play history**. The album supports year, platform, status
and text filters, including an Unknown dates group. Ratings are personal values
from 0 to 5 in half-point steps; they do not modify reception scores or rankings.

**Edit record** changes the same playthrough and its card/statistics. Use it to
correct a finish, retirement, dates or reflection. The latest reversible change
can also be undone from the shared tracking panel. Starting a replay preserves
earlier records; reopening an older record is blocked if another playthrough of
that target is already active. Unknown dates can stay blank. Dates display in
your local timezone, and editing other fields preserves their original precision.

Use **Session notes & milestones** while playing, or **Journal** on any card.
A milestone can be planned or marked achieved, with an optional calendar date.
Notes belong to one playthrough and survive replays. Hiding an entry retains it
for restoration and audit history. Optional playthrough time is a manually entered
total in minutes, never a sum of imported lifetime hours and session entries.

Plan completion counts only current backlog commitments. Finishes contribute to
the numerator; retirements stay in the denominator and have their own count.
Removing a commitment changes membership; starting a replay makes a finished
member remaining again. Year summaries count finished/retired playthroughs,
including replays, separately from the current plan. Net plan size change is
recorded additions minus removals, including undo and repeated commitments. Older
Up Next events without membership details are explicitly marked as partial data.
Existing imports do not grant finishes or add games to this plan.

History, journals, rewards, goals, challenges and library match reviews are included
in version 7 tracking backups, with support for version 1–6 imports. Cards currently stay in the app; image/PDF
exports remain deferred.

Enable optional rewards in **Play Plan → Your progress**. First local, dated
main-game finishes or written personal objectives earn 100 XP once per game;
reflections earn 10 XP per eligible locally finished playthrough. An achieved,
dated additional mastery objective in the journal earns 50 XP once per game after
a main-game finish. Ten distinct wishlist review decisions earn 20 XP once per
week, including keeps. Imports, purchases, existing finishes, raw playtime and
repeated status changes grant no additional XP. Unknown/future dates and
unspecified objectives retain their history without points.

Choose up to three weekly goals for playing, milestones or wishlist reviews.
Goals count activity recorded after acceptance, can be replaced or skipped, and
carry no missed-week penalty. Weeks start Monday in the saved activation timezone.
Preferences control the level curve and cosmetic card frames. Hiding rewards
keeps tracking available. Duplicate reward links require an edition confirmation
and XP preview; they consolidate eligibility without merging playthroughs.

**Challenges & seasons** in Play Plan now offers six owned-game templates. Review
matching copies and metadata before acceptance. Smaller libraries get smaller
boards. A challenge keeps its selected copies and editorial ranking snapshot
through later imports or catalogue changes. Substitution preserves progress in
the other cells; regeneration starts a fresh revision, retaining earlier history.
Achieved journal milestones show intermediate progress. A new dated finish fills
one cell; different accepted challenge types can share that finish. Optional
season dates use the saved timezone. Completing a board earns a badge and one
bonus if XP was already enabled. Corrections reverse invalid rewards; repeated
imports or revisions cannot stack the same bonus. Archive a plan to start another
of its type. These plans also work with gamification hidden.

## The wishlist page

`wishlist.html` reads `steam-wishlist.json` (the JSON you get from Steam's
wishlist export) enriched with genres, features and store metadata:

```bash
./library/tools/update-wishlist.sh                 # fetch missing metadata, rebuild
./library/tools/update-wishlist.sh --skip-fetch    # rebuild from the cache only
./library/tools/update-wishlist.sh --refresh       # also refresh cached Steam metadata/prices
```

Filter by Steam approval, review count, price, main genre, any genre, feature,
release year, or discount. **Conservative Steam approval** uses the Wilson lower
bound without an independent popularity bonus. Rounded percentages make this
approximate; exact positive/negative counts are used when supplied. Raw percentage
and review volume have separate sorts. **Top by genre** uses the same ordering
among released games with usable evidence. Unranked entries stay available in
grid/list and are preserved by its removal cutoff.

Details explain counts, source date and query scope. Missing dates stay unknown.
Old zero percentages can mean missing data; reimport to confirm. The mean approval
statistic excludes unknowns. These remain saved snapshots; no live review connector
was added in this phase.

### Decisions, reviews and acquisitions

Open a game to save Keep, Want soon, Wait for price, Maybe or Archived, plus an
interest priority, reason, target price/currency and optional review/snooze dates.
The existing Notes field remains separate. Filter by decision, due/snoozed reviews
or target-price status; these filters survive bookmarked URLs. Interest priority
is an optional sort and does not change the existing genre scores.

**Review up to 10 games** freezes up to ten distinct due entries from the current
filtered order. Resume after closing the dialog or reloading. Keep, Want soon,
Wait for price, Snooze and Archive each count as one reviewed game; Undo restores
the last decision and count when it has not been superseded by another action.
There is no removal quota. **Compare two games** offers A, B, Both, Neither and
Skip: selected entries become Want soon, unselected entries become Maybe, and
Skip leaves both unchanged. Neither choice removes games or erases notes.

**Record acquisition** requires confirmation of the wanted Steam/PC edition.
An exact Steam app ID can provide an import hint; a similar title or another
platform never records an acquisition automatically. Owned alternatives explain
shared genres and platform differences. Choose **Keep in library** to record
ownership only, **Add to backlog**, or **Add to Up Next**. None starts a playthrough.
Clear the acquisition date if unknown. These records appear in the wishlist's
Acquired view and shared tracking; the imported Owned Games list updates when you
import your updated library.

Use **Export acquired** for `wishlist-acquisitions.json`, including acquisition
dates and notes. Acquisitions stay separate from removals, including during bulk
genre trimming. Use the unified tracking backup to preserve the full history,
decisions and resumable sessions. Personal exports remain ignored by Git.

### Target prices and freshness

Target-price checks require an amount, a known observation timestamp no more than
seven days old, and matching currencies. Unknown/future dates, stale prices and
currency mismatches have separate filter states and cannot satisfy a target.
Supported target currencies are GBP, USD, EUR, CAD, AUD and JPY; no conversion is
performed. Legacy price filters still use GBP amounts.

New Steam cache fetches record the observation time and currency. Rebuilding
from cache preserves that original date, and older caches retain an unknown date.
Use `--refresh` above for a new observation; it can take time on a large wishlist.
Trimmed exports preserve price provenance. A target met in the imported snapshot
is a prompt to check the store; there are no background checks or price alerts.

### Removing games

Steam has no public API for editing a wishlist, so **Remove** marks a game
locally (in this browser's shared tracking store) rather than touching your Steam
account. Removed games disappear from the "Kept" view and can be restored at
any time. These exports turn that into something actionable:

- **Export removal list** — `wishlist-removals.json` with the title, appid and
  store link for everything you dropped, to work through on the Steam site.
- **Export trimmed wishlist.json** — the original wishlist file minus the
  removed and acquired games, in the same format, so you can replace `steam-wishlist.json`
  with it and rebuild.

In the Top-by-genre view, each genre also offers "Remove the other N", which
keeps that genre's top picks and marks the rest — the fastest way to cut a
large wishlist down. It asks for confirmation, and is reversible with "Restore
all removed".

## Provider rating modes and details

Owned copy and wishlist details read saved provider evidence from
`library/data/ratings.json`. Run `npm run ratings:refresh` from the project root
and reload to inspect the reviewed seed. Add Steam product IDs with
`--steam <appID>` or explicitly opt in the wishlist using `--wishlist`. Owned
Steam copies can be confirmed in **Library tools → Review Steam products**;
VGC/IGDB still need reviewed private crosswalk mappings. Title-search and unknown
IDs remain unconfirmed. Review is per copy and does not merge histories. VGC/IGDB work context cannot stand in for an original release score.

Wishlist defaults to saved exact Steam ratings. Change **Rating source** in
Filters & sort for VGC/IGDB or explicit imported ratings. Source values drive
cards, details, thresholds and genre cutoffs; missing ratings never borrow an
imported score. Owned Games has Steam approval/conservative approval and VGC/IGDB in **Rating field** and uses the selected
mode for its score threshold and score sort, requiring one matching copy.
These views expose attribution, freshness, scope, failed refreshes and full-cohort
positions. Play Plan suggestions are a separate next phase. See the
[provider guide](../ranking/README.md#k2-provider-snapshots) for private mappings,
optional credentials and cache behavior. Sample pages use fictional data.

## Editing games manually

Two ways to correct or annotate entries:

**In the browser (instant, per-device):** open a game's details panel and use
the Favorite star, Hide toggle, and Notes field. These are saved to your
browser's IndexedDB tracking store and survive reloads, but only in that
browser.

**Permanently (survives re-imports):** click "Export overrides.json" in the
Library tools panel to download your current in-browser edits, then save the file as
`library/data/overrides.json` and re-run `./library/tools/update.sh`. You can also hand-edit
that file directly — it's a JSON object keyed by the game's slug id (shown in
the details panel), for example:

```json
{
  "alien-isolation": {
    "favorite": true,
    "notes": "Played on PS4, replaying on PC",
    "hidden": false
  }
}
```

Supported override fields: `favorite`, `hidden`, `notes`, `cover`,
`background`, `nameOverride`.

## Local assets and builds

All of `library/data/`, `library/assets/`, raw CSV/Steam exports and metadata caches
are excluded from Git. Imported overrides and notes can be embedded in generated
snapshots, so generated data must stay local too. Keep a separate backup; cloning
the repository does not restore your personal files or browser storage.

```sh
npm run library:import -- --source /path/to/playnite-library-site
npm run library:verify
```

`npm run build` always creates a sample-only site in `dist/`, even if imports exist.
`npm run build:local` explicitly creates a personal site in `dist-local/`; keep
that output private. Missing artwork never prevents either build. The local
server automatically uses imported snapshots, with samples for missing views.

To import a Steam JSON export without fetching metadata, put it at
`library/steam-wishlist.json` and run `npm run wishlist:update -- --skip-fetch`.
Without a metadata cache, some filters have limited information. Optional refresh
commands contact external services; credentials belong in your environment, never
in source files or exports. Prices, reviews and release flags describe the last
import, not live Steam data.

### Reviewing Steam product identities

The queue shows one copy at a time, with title, year, platform, store and ID origin.
Open the linked product, check the edition/type, then confirm, reject or replace
its app ID/store URL. A changed import invalidates an accepted association.
Other-store and console copies cannot inherit Steam-product reception.

Export your current tracking backup, then preview and refresh confirmed products:

```sh
npm run ratings:refresh -- --owned --tracking /path/to/tracking-backup.json --provider steam --plan
npm run ratings:refresh -- --owned --tracking /path/to/tracking-backup.json --provider steam
```

The backup stays local. The command reports confirmed, unresolved, changed,
rejected and inapplicable copies and deduplicates confirmed app IDs. It still has
the existing request budget; deferred/retry outcomes do not mean complete coverage.
Previously selected products remain in the refresh selection, but a revoked copy
match immediately stops displaying their scores for that copy.

New CSV builds retain each copy's original title and Steam ID provenance. Optional
`Steam App ID` / `SteamAppId` or `Steam Store URL` columns take precedence over the
name-search cache but still need review. Older snapshots report unknown provenance;
rebuilding does not automatically approve them. Existing title-group IDs and notes
are retained; safe reboot/edition regrouping is still a separate migration task.
