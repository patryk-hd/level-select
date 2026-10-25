# Next stages: trustworthy scores and a usable local MVP

Prepared 2026-09-16 from the [product review](PRODUCT-MVP-REVIEW.md) and the user's
follow-up: correct, useful Steam, VideoGamesCritic and retro scores are a core
requirement for managing the backlog and wishlist.

This is the current delivery sequence. It supersedes conflicting next-step
recommendations in the earlier plans, including the review's suggestion that a
small ratings slice alone could be enough. Existing technical contracts remain
applicable. This document plans implementation; unchecked items are not delivered.

The user approved proceeding with the [September 19 feature comparison](FEATURE-STRATEGY-COMPARISON.md).
Its proposed improvements are recorded below. The September 25 scope freeze now
controls what must ship before the personal trial; optional additions are deferred.

**Product goal:** enjoy more of the games already owned, discover worthwhile
classics, and maintain a considered wishlist. Keep local, account-free use.
**MVP requirement:** working adapters, populated real data and useful score-based
decisions. A one-game seed, fixture-only tests or an entirely unrated retro view
do not satisfy it. UX trials can begin early, but MVP acceptance waits for the
ratings gates below.

## Scope freeze — 2026-09-25

The user has asked to finish a usable app and begin testing, rather than keep
adding features. Work now closes existing gaps. The detailed stage lists below
remain a record of proposals, **not a requirement to implement every unchecked
feature before testing**. The following finish gates control the local release:

1. **Useful real scores:** finish the current Steam wishlist pass and the verified
   owned-product pass; meet the existing VGC and bounded retro coverage gates.
   Keep exact identities, source labels, honest missing states and safe refresh.
2. **Working daily flows:** verify browse → choose a copy → Up Next → play →
   pause/finish, plus a ten-game wishlist review. Fix broken handoffs and misleading
   ownership/score claims; reuse existing controls wherever they work.
3. **Recovery and delivery:** verify import/restart/backup restoration, stable
   local launch, desktop/mobile usability and private-data separation. Publish a
   short coverage/gap report and instructions the user can follow.
4. **Personal trial:** start using the existing flows now; complete the formal
   two-week acceptance trial after the required source and recovery gates pass.
   New work during the trial addresses observed blockers.

Deferred until trial evidence justifies them: preferred-copy pinning, readiness
notes, mood/session tags, duration enrichment, new score widgets or suggestion
preferences, wishlist aging, navigation redesign, new animations and extra
planning/reward systems. Keep the existing explicit copy chooser and current
suggestion filters. No new connectors, accounts or custom blended scores.
The Steam/VGC/retro usefulness floors are unchanged; this is a feature freeze,
not acceptance of empty score views.

## Checklist conventions and scope

- [x] Review the documentation, code and current desktop experience.
- [x] Record scores as a core MVP requirement and define the stages below.
- [ ] Close the four finish gates above; retain the source acceptance evidence
  from stages 2–4 and record any workflow/recovery blockers from stages 1 and 5–7.
- [ ] Run the two-week personal trial and address observed blockers in stage 8.

Check an item only after its behavior/data has been verified. Record implementation,
real-data coverage and user validation separately; a completed adapter does not
mean a completed integration. Pilot sizes below are proposed acceptance targets,
not claims about current coverage or provider guarantees.

Population priority: current wishlist and owned library, deduplicated by verified
identity; prioritize Up Next/Playing for early delivery without starving the rest.
Then populate the retro pilot and selected launch-system lists. Do not require all
4,551 catalog entries to have scores before local acceptance.

### Catalog focus — 2026-09-17

The former Recommendations section is now **Game Atlas**, the single discovery
destination. The duplicate Systems navigation entry is removed; old Systems links
still open the Atlas directory. Families and systems share one chooser. Every system
is visible by default; the provisional 12-system shortlist and its explanatory
dialog are removed. Users pin consoles, PC or storefront cards and select
**Favorites catalog**, with pins stored in the existing tracking backup.

**Browsing breadth and verification scope are separate.** Deliver stage 4's
bounded 50-release pilot first, then prioritize additional console work using
verified ownership/backlog relevance and usable source coverage. PC Steam coverage
remains an independent MVP requirement.

- [x] Default to all systems and offer persistent, bookmarkable favorites without
  hiding direct system links or saved picks. Empty favorites explain how to pin.
- [x] Show unique imported-game totals and recorded completions on PC/store cards;
  attribute finishes to the matching copy, including completed games being replayed.
- [x] Align both catalog filter rows on the same responsive columns; standardize
  field heights, chevrons and constrained widths across pages and dialogs.
- [x] Allow private browser caching for local artwork with ETag revalidation;
  retain fresh app/data responses and explain the limits of remote/offline artwork.
- [x] Keep legacy ranks within one system. Family lists sort by one provider's
  unchanged score and rank within that selection; missing scores stay unranked.
  Title/date lists show positions, not a fabricated family-wide reception rank.
- [x] Add PC/storefront entry points. PC is a platform; Steam/GOG/Epic filters
  apply to the same owned copy. Classic PC remains the DOS/early-Windows catalog.
- [x] Share 44px control dimensions across catalog, owned, wishlist and play-plan
  filters, including mobile layouts.
- [x] Use console-style cards for PC and storefront destinations, with explicit
  platform/storefront labels and imported-library links. Do not imply that a
  storefront has a console ranking or a completed direct integration.
- [x] Replace the sparse Library tools disclosure with visible backup/source
  actions; keep pinned-system shortcuts in their own section.
- [ ] Complete the existing bounded retro pilot, then use measured coverage and
  personal relevance to choose the next console audits. Modern PC Steam coverage
  stays in stage 2. Classic PC remains an explicit part of the pilot.

Older/less-used systems retain their legacy data; new source auditing, rankings
and polish for them are deferred until after MVP. This navigation change does not
populate live scores or claim platform-specific scope for work-level aggregates.

Verification: 158 Node tests passed, including the launcher checks rerun with
localhost binding enabled. Isolated browser checks covered the new chooser,
family ranking, pagination, bookmarks, PC/store links and shared desktop/mobile
control dimensions, plus the existing score-mode, matching and backlog workflows.
The shareable build, private-data scan and diff checks passed. Score examples in
browser tests are fictional; they do not count toward real provider coverage.

Atlas favorites follow-up: all 160 Node tests passed (launcher tests rerun with
localhost binding enabled). Browser checks cover all-system defaults, persistent
console/store favorites, empty states, per-copy completion counts, scoped ranks,
PC/store navigation, equal responsive filter columns and dialog field sizing.
Desktop/mobile screenshots were inspected. The new local-image cache is checked
for private cache headers, ETags and body-free 304 responses. Browser score and PC
fixtures remain fictional; this work does not add provider coverage.

### Local title-search increment — completed 2026-09-18

- [x] Share title/alias-only search across Game Atlas, Owned Games, Steam Wishlist,
  Play Plan and its game picker; final-word prefixes support `divi` and `super mari`.
- [x] Prefer full titles and consecutive phrases by relevance; preserve explicit
  score/date/title sorts, manual Up Next order and Top by genre rating order.
- [x] Offer up to five selectable spelling suggestions only after zero direct
  matches in the current filtered scope. Allow one edit/adjacent swap in a word
  of at least five letters; never relax numbers or drop a query word.
- [x] Keep search tolerance separate from ownership and provider mapping decisions.
- [x] Verify prefixes, aliases, numeric sequels, spelling correction, active filters,
  relevance, reloads, explicit sorting and mobile suggestion controls.

This is a local browsing improvement. It does not add external search services,
automatically merge editions or populate provider scores.

## Score policy

“Correct” means the correct identity and scope, a faithfully reported source value,
documented calculation, and accurate freshness/counts. It does not mean a provider
is an objective measure of enjoyment or that all games can receive a score.

| Source | MVP role | Display and ordering contract |
| --- | --- | --- |
| Steam reviews | Direct player reception for verified Steam products in the wishlist and library. | Show positive percentage and review count. Offer a clearly named conservative approval sort using the existing Wilson method, plus raw approval. Never label the Wilson value as Steam's displayed percentage. |
| VideoGamesCritic | Required, attributed external reception mode across verified mappings. | Keep the supplied VGC score unchanged. Show available components separately. Broad game/platform metadata is game-level context, not proof of a particular port's score. |
| IGDB | First implementation candidate for retro identity and additional retro reception; reuse the existing adapter. | Keep community and critic ratings/counts separate. Treat broad game aggregates as game-level context unless exact release scope is established. Validate live coverage before adopting it as the retro solution. |
| MobyGames | Bounded alternative/supplement evaluation if IGDB coverage or release detail is inadequate. | Confirm accessible fields, platform scope, access cost and reuse conditions before choosing an adapter. Do not assume a website score is exposed by the API or has platform scope. |
| Attributed retro reviews / system lists | Context and, where usable, original-platform evidence for the launch-system pilot. | Preserve source scores/scales or actual list positions. Unordered selections are endorsements. Do not turn linked reading into an invented numeric rating or consensus. |
| Imported and personal ratings | Preserve existing data and the user's opinion. | Clearly label imports and personal values; never silently substitute them for a missing provider rating. |

No maximum across copies or sources, no universal blended score, no double counting
VGC alongside its underlying sources, and no popularity/artwork/price bonus in
reception ordering. Zero and missing remain different. A remake or PC port cannot
supply the original console release's score. Small samples remain visible.

## Stage 1 — Reliable game identity and refresh-safe mappings

**Depends on:** existing tracking/evidence foundations. **Start here.**

- [ ] Inventory the current library, wishlist and catalog with stable references;
  distinguish work, edition, platform release, store product and owned copy.
- [ ] Record origin/trust for external IDs. An imported `steamAppId` obtained by
  title lookup is a candidate, not a verified product link.
- [x] Correct same-title reboot/edition grouping and misleading cross-platform
  ownership claims. Show uncertain associations as possible matches.
- [ ] Reuse provider IDs and explicit product links first; let name, aliases,
  developer, dates and edition/platform metadata support candidate review.
- [ ] Persist accepted, rejected and unresolved candidates plus match provenance;
  provide a small accept/reject/correct queue. Auto-accept only corroborated,
  deterministic identity rules covered by tests.
- [ ] Preserve decisions across import, refresh, restart and mapping backup/restore.
  Keep private mappings out of public builds; include them in a documented local
  recovery path rather than relying on Git.
- [ ] **After trial:** add preferred-owned-copy selection without automatically
  merging histories
  or asserting that the highest score identifies the technically best version.
- [ ] **After trial:** add an optional ready/setup-needed/unknown note for the selected copy.

**Acceptance:** original/remake, same-name reboot, port, regional alias, bundle/DLC,
demo and multiple-copy cases resolve correctly or remain visibly unresolved. No
unreviewed ambiguity creates an ownership claim or score transfer. Reimport keeps
tracking IDs, notes, queue, history and corrections intact.

Likely areas: `library/core.js`, `library/tools/build_site.py`,
`tracking/client.js`, `ranking/crosswalk.mjs`, local mapping storage and tests.

### Stage 1 delivery log — 2026-09-16

First increment: copy-specific review in Recommendations and Owned Games.
Stage 1 as a whole is still open.

- [x] Replace automatic title/platform ownership claims with possible matches.
  Compare each copy's platform, source and year; support confirm, reject and reset.
- [x] Store decisions and identity fingerprints in schema/backup version 6;
  upgrade versions 1–5 without accepting legacy title matches. Preserve reviews
  across reload, source regrouping, missing copies and tracking backup restoration.
- [x] Require another review when accepted title/platform/year metadata changes;
  detect stale writes and keep rejected matches rejected across refresh.
- [x] Use reviewed same-platform matches or explicit tracking links for Play Next
  and challenge editorial context. Match review leaves histories, notes, queue,
  ownership records, XP and provider observations untouched.
- [x] Verify domain edge cases and both detail panels, cross-tab updates, mobile
  layout and fresh-workspace backup restoration using isolated fixture data.

Recovery: **Backup & import → Export tracking backup** includes these decisions.
Restore through the same preview/merge flow and explicitly resolve conflicting
reviews. Keep the original CSV/generated datasets separately; this is still a
tracking backup, not a complete library backup. Public builds use sample data and
cannot include private browser decisions.

Next increment: preserve and classify imported external-ID provenance, correct
same-title edition grouping without losing legacy notes, then add a central
review/correction queue and preferred-copy selection. Per-game review is available
now; arbitrary replacement matching and the central queue are not yet implemented.
No live provider coverage was added by this increment; stages 2–4 remain required.

Verification: 153 Node tests passed (the two launcher tests were rerun with
localhost binding permitted), plus 60 existing browser scenarios across tracking,
backlog, wishlist, history, rewards and challenges. The new
`scripts/check-matches-browser.mjs` passed four scenario groups covering matching,
cross-tab decisions, restore/invalidation and responsive layout. The shareable
sample build, `check:share` and `git diff --check` passed. These checks use fixtures;
the full personal reimport trial and live score coverage gates remain open.

### Stage 1 product-identity increment — completed 2026-09-18

- [x] Preserve Steam IDs and origin per imported copy; name lookup, optional CSV
  ID/link and legacy unknown origins remain candidates. Do not spread a group ID
  across multiple copies. Retain original per-copy titles and existing group IDs.
- [x] Add a searchable one-copy Steam review queue and detail entry points, with
  confirm/reject/reset and corrected app ID/store URL entry. Require the user to
  inspect the edition/product type. Non-Steam and console copies remain inapplicable.
- [x] Persist decisions with identity fingerprints in schema/backup 7; preserve
  versions 1–6, reject conflicting writes, retain missing-copy decisions and
  invalidate changed accepted identities without merging histories or notes.
- [x] Connect confirmed copies to the existing Steam snapshots in details and
  explicit approval/conservative-approval modes. Other-provider mappings stay separate.
- [x] Add `ratings:refresh --owned --tracking <exported-backup>` and an offline
  `--plan` report. Check reviews against the current import and deduplicate app IDs.
  Keep backup contents local; only confirmed product IDs are selected for Steam.

Read-only inventory of the current local snapshot: **2,364 title groups / 2,750
copies**, including **1,278 Steam PC copies** and 1,472 others. All 2,750 copies in
that older snapshot lack ID provenance. This is import inventory, not a measurement
of browser decisions or live rating coverage. No personal dataset was replaced,
no matches were bulk-approved, and no live score coverage was added.

Verification completed 2026-09-18: **167 Node tests and 10 Python tests passed**.
Nine isolated browser suites passed: product review, source modes, tracking,
catalog matches, play plan, wishlist, history, rewards and challenges. Coverage
includes review/correction, cross-tab conflicts, schema 1–6 upgrades, backup
restoration, import invalidation, copy-specific score display/sorting, mobile
fields and keyboard dismissal. The refresh integration test writes a snapshot
from a fictional Steam response, sends only the confirmed product ID, and leaves
the supplied tracking backup unchanged. Desktop/mobile screenshots were reviewed.
The shareable build, private-data scan and diff check passed. All browser/provider
fixtures are synthetic; these checks do not count toward real score coverage.

At this checkpoint, same-title regrouping/legacy-note migration, the central
catalog-match/correction queue and preferred-copy selection were still pending.
The September 19 increment below completes conservative regrouping and scoped note
preservation. Stage 2's resumable job and real-data acceptance audit remain pending;
the command above uses the existing bounded refresh machinery.

### Stage 1 release-group increment — completed 2026-09-19

- [x] Replace title-only CSV grouping with conservative browsing groups. Require
  matching title, year, platform set, developer set and candidate product ID;
  missing year/platform/developer facts keep copies separate. This is not identity
  confirmation and never merges playthroughs or provider mappings.
- [x] Preserve whole-group IDs where safe, retain stable copy IDs, and record
  old group references when splitting or changing scope. Old detail links offer
  the resulting releases instead of selecting an arbitrary one.
- [x] Keep legacy notes/favorite/hidden choices in their original group scope.
  Show saved records on related releases; explicitly append reviewed notes without
  transferring flags or deleting the original. Refuse stale source/destination edits.
- [x] Preserve group-note scope through repeated imports and tracking backup
  restoration. Parse prior snapshots as JSON rather than executing them; retain a
  byte-for-byte recovery snapshot before changing existing group membership.
- [x] Apply the verified import to the local library. Every copy ID and old group
  reference was retained. Local library/artwork/wishlist integrity checks passed.

Verification: **181 Node tests and 17 Python tests passed**, with the two launcher
tests rerun outside the sandbox to permit localhost binding. Six isolated browser
suites passed: release groups, Steam products, catalog matches, tracking, backlog
and source modes. These cover preserved notes, old links, backup restore, cross-tab
conflicts, mobile controls, keyboard use and independent copy ratings/history.
The sample build, private-data scan and diff checks passed. Browser fixtures remain
fictional; no new live reception coverage is claimed.

Recovery snapshots are private files beside the generated library, named
`library-data.before-regrouping-<content-hash>.js`. Tracking backups continue to
hold browser notes/history; keep the source datasets separately. Automatic grouping
is intentionally conservative and may show multiple entries for the same work.

Stage 1 remains open for identity acceptance. Preferred-copy selection/readiness
are now deferred; a central catalog match/correction queue remains proposed,
with existing per-game correction controls available for the trial. The existing
central Steam-product queue is a separate delivered feature. Stages 2–4 still need real-data acceptance.

## Stage 2 — Complete Steam review integration and bounded refresh

**Depends on:** stage 1 for owned-copy associations; explicit wishlist app IDs can
be processed independently while those associations are being reviewed.

- [x] Extend the current refresh command into a persistent job with resume,
  progress and provider-specific retry times. Process uncached entries before
  repeatedly refreshing covered entries; reuse requests across all views.
- [ ] Populate all valid wishlist product IDs and all verified Steam products in
  the owned library. Report unverified owned IDs in the matching queue.
- [x] Validate consistent language, purchase-type and off-topic settings. Explain
  any difference from Steam's store headline rather than claiming unexplained
  numerical parity. Retain query parameters with every observation.
- [x] Use summary positive/negative/total counts, not the number of reviews on a
  returned page. Verify zero reviews, genuine zero approval and malformed totals.
- [x] Preserve raw approval, counts, retrieval time and a versioned conservative
  calculation. Do not label old cached data fresh merely because it was rebuilt.
- [x] Expose a straightforward local refresh/status workflow. If a browser button
  is added, narrowly scope its local endpoint; otherwise provide a guided command
  and clear progress. Refresh never requires opening every game or editing code.
- [x] Preserve last good data through offline use, throttling, failures and
  interrupted writes; support safe resume without duplicate work.

**Acceptance:** every requested product has an explicit outcome; no unexplained
not-processed remainder. Successful no-review/unavailable outcomes are distinct
from failed fetches. Retry-pending jobs are not called complete. Audit a fixed set
of at least 20 varied real products against the same source/query snapshot,
including tiny samples and no-review cases when available. Calculated values agree
with independently tested fixtures. Data remains usable offline and after restart.

Likely areas: `scripts/enrich-ratings.mjs`, `ranking/refresh.mjs`,
`ranking/providers/steam.mjs`, `ranking/storage.mjs` and refresh tests.

### Stage 2 delivery — 2026-09-25

The refresh command now records its selection before requesting data, checkpoints
quota and each normalized response, and resumes a finite cohort across bounded
batches with `--drain`. `--status` reads saved progress offline. Counts distinguish
rated, successful no-review, unavailable, retry-pending and not-processed states;
a failed page-snapshot save remains incomplete even when all responses are cached.
Ctrl+C saves partial work. Retained evidence survives errors, retries honor provider
backoff, and a provider outage stops after three consecutive transport failures.

Play Plan now puts its existing queue and suggestions before overview counters,
statistics, rewards, history and challenges. Direct links to choosing and history
remain near the top. No tracking schema, new preference control or reward rule was
added. The README contains a short daily-use trial and the refresh/resume commands.

Verification: **194 Node tests and 17 Python tests passed**. Five isolated browser
suites passed for backlog/tracking, history, rewards, source modes and provider
panels. They cover restoration, undo, cross-tab edits, retained ratings, copy scope,
keyboard interaction and mobile layouts. Read-only checks against the real local
library also passed; they used a temporary browser and did not change the user's
saved tracking. Desktop/mobile screenshots were inspected. The sample build,
private-data scan, imported-library integrity and whitespace checks passed.

Owned Steam population remains separate: this pass does not infer product approval
from imported title-search candidates or access the user's browser tracking. A
current exported product-review backup is needed for the owned-product pass.
VGC still has only the existing one-game seed (two target mappings); the required
VGC usefulness floor and the retro pilot/source decision remain open. No live IGDB
credentials were configured or exercised in this increment. The app is available
for early personal use, but these source gates prevent calling the whole MVP done.

## Stage 3 — VideoGamesCritic discovery and useful collection coverage

**Depends on:** stage 1 and the reusable refresh machinery in stage 2.

- [ ] Add candidate discovery using supported ID/detail/search/bulk routes. A bulk
  notable-games feed must not be treated as the entire provider catalog.
- [ ] Prefer explicit verified Steam links for Steam products. Review non-Steam
  candidates and edition conflicts; do not infer Steam identity from a numeric VGC ID.
- [ ] Audit a fixed 50-game set spanning modern games, ports, remakes, console-only
  titles and missing/ambiguous results before broad matching.
- [ ] Run a resumable discovery/refresh pass across the current wishlist and owned
  library, deduplicating provider requests. Record every outcome and retain rejects.
- [ ] Keep VGC values/components unchanged and attributed; expose source update
  time, cache age and supplied confidence where available without inventing them.
- [ ] Respect provider quotas, cache validators and backoff. Anonymous access can
  make a large first pass slow; support an optional user-supplied key without
  making a paid subscription or account creation a hidden dependency.
- [ ] Distinguish game-level reception from exact-release reception everywhere.

**Acceptance:** the 50-game audit has no known incorrect accepted mapping; the
collection pass accounts for every requested item. Deliver at least 20 verified,
rated real games relevant to the user's library/wishlist as the initial usefulness
floor, with the actual coverage denominators reported. If availability prevents
this, record the shortfall and resolve the scope/source decision rather than mark
the integration complete. A provider error cannot erase an existing score.

Likely areas: provider discovery alongside `ranking/providers/vgc.mjs`, shared
mapping review, the refresh job and coverage reports.

## Stage 4 — Deliver a real retro reception baseline

**Depends on:** stage 1 and reusable ingestion. Begin the source feasibility check
early so access or coverage surprises do not emerge at the end of development.

- [ ] Reuse the existing retro audit targets and define a fixed 50-release pilot:
  ten each across NES, SNES, Mega Drive, PS1 and classic PC. Include ambiguous
  originals/ports and less-reviewed games, not only well-known favorites.
- [ ] Validate the existing IGDB adapter with live authorized access, candidate
  search, external IDs and remake/remaster/port relationships. Record missing
  credentials as a blocker to live validation, not as zero provider coverage.
- [ ] Measure numeric-rating coverage and counts separately for community and
  critics; measure game-level and exact-platform evidence separately.
- [ ] **After trial:** evaluate IGDB duration categories/counts as optional enrichment. Missing duration does not block the retro ratings gate.
- [ ] Run one bounded MobyGames feasibility comparison if the first candidate is
  inadequate. Verify current access, fields, costs and scope with actual examples
  before proposing a subscription or implementation. No open-ended provider hunt.
- [ ] Write the retro source decision with measured coverage, limitations and
  the chosen adapter/import path. Implement and populate that path; a research
  report or collection of links alone does not complete this stage.
- [ ] Add a small set of attributed original-platform review/list references for
  the pilot systems where available. Keep individual source evidence separate;
  broader custom consensus remains deferred.
- [ ] Deliver source-specific retro browsing with game-level labels where needed.
  Enable a platform-specific rating/rank only when the underlying evidence has
  that scope. Missing evidence remains browsable and does not count as zero.
- [ ] Retire unsupported legacy ranks/tie-breaks from normal recommendations;
  preserve the catalog, source history, old-link compatibility and frozen challenges.

**Acceptance:** every pilot release has an audited state, and at least 20 verified
retro game/edition identities across at least three pilot systems have usable
numeric reception evidence, with at least five in each included system. Game-level
context is allowed but explicitly labeled; a later port masquerading as the original
does not count. Publish the exact-platform coverage separately and do not advertise
system consensus if it is absent. Populate the selected path for matching retro
titles in the actual library and record its gaps. If the floor is unmet, this stage
remains incomplete; choose a concrete alternative or explicitly revise scope.

Likely areas: `ranking/providers/igdb.mjs`, discovery/crosswalks, a versioned retro
pilot/source manifest, optional selected-provider adapter and catalog source views.

## Stage 5 — Consistent scores that help choose and review games

**Depends on:** stages 2–4 for populated sources; shared UI work can start with
fixtures, but acceptance requires the real snapshots.

- [ ] Share one identity/evidence lookup across Library, Discover, Wishlist and
  Play Plan. The same target/source/snapshot shows the same value everywhere.
- [ ] Present compact source badges, count/freshness cues and the selected
  edition/copy; put detailed methodology in an expandable panel.
- [ ] Offer explicit source-based sorting/filtering, preserve the selection in
  URLs, and keep unrated entries available. State the rated/eligible denominator.
- [ ] Let users compare Steam and VGC side by side, plus the selected retro source
  where available. Explain disagreement without inventing an average winner.
- [ ] Add an explicit reception preference to play-next suggestions. Eligibility,
  manual Up Next order and personal priority come first; the chosen source can
  break ties. Explain the reason, and use a neutral fallback when unrated.
- [ ] Keep numeric ratings, user play priority and list positions distinct. A
  game-level rating sort inside an SNES filter is not a verified SNES-release rank.
- [ ] **After trial:** extend the existing chooser with optional mood/session context
  using explicit local or curated tags. Distinguish session fit from total completion time; unknown
  data stays eligible unless the user explicitly chooses a strict filter. Preserve
  manual queue order and explain up to three choices across modern and retro games.
- [ ] Keep unowned retro discovery actionable through wishlist/access recording;
  never imply that catalog inclusion or achievement history establishes playability.
- [ ] Keep the actual wishlisted Steam product as the purchase target and an
  accessible owned copy as the play action. Retain the explicit copy chooser;
  preferred-copy pinning is deferred.
- [ ] Use ratings in wishlist review/comparison, while keeping price, desire and
  owned alternatives visible. No automatic archive solely for a low score.

**Acceptance:** real examples can be followed across the four views with identical
source values and appropriate scope; filters never select the wrong owned copy.
Manual queue order remains stable. Unrated games remain playable, reviewable and
eligible for discovery. The user can explain a suggestion without reading the
methodology page.

## Stage 6 — Coherent library and wishlist workflows

**Depends on:** stage 1; coordinate score presentation with stage 5.

- [ ] Present locally recorded acquisitions/manual ownership in Library alongside
  imports, with source labels and deduplication after the next import.
- [ ] Present recommendation wishlist flags and imported Steam wishes through a
  coherent wishlist view, retaining distinct editions, source filters and notes.
- [ ] Distinguish unreviewed entries from a deliberate Keep without rewriting
  historical decisions or granting retroactive rewards.
- [ ] Distinguish wishlist source-added date, first seen locally and last reviewed.
  Age can prompt review but must never trigger automatic removal.
- [ ] Simplify the existing review into one game/card and clear Keep/Later/Archive
  actions; retain underlying richer states, snooze, targets, resume and undo.
- [ ] Add a readable Steam removal checklist with product links and separate
  pending/manual-confirmed states. Local archive must not imply Steam removal.
- [ ] Reconcile later imports only when completeness is established; partial,
  private or failed imports cannot erase ownership, decisions or history.
- [ ] Move bulk score-based trimming into an advanced preview/undo flow.
- [ ] Make the current CSV/JSON input formats, update status and recovery steps
  clear in the app. A general browser importer remains a later distribution step.

**Acceptance:** wishlist → acquisition → Library → Up Next → play → finish/retire
works without waiting for reimport to see local ownership. Reimport deduplicates
the source record while retaining decisions/history. Review sessions resume and
the actual Steam handoff is understandable; no automated store writes are implied.

## Stage 7 — Modern, enjoyable presentation without new feature sprawl

**Depends on:** stable primary actions from stages 5–6.

- [ ] Make Play Plan the returning-user home: Continue, Up Next and choose-next
  suggestions appear before statistics, rewards, history and challenges.
- [ ] Show the latest session note beside Continue so the player can resume easily.
- [ ] Simplify navigation toward Play / Library / Discover / Wishlist; preserve
  bookmarked routes, with systems/favorites and history as contextual views.
- [ ] Add cover art and clear copy/platform labels to suggestions and the queue;
  offer direct actions when there is only one verified playable copy.
- [ ] Retain dark/gold styling, consistent spacing and readable typography. Use
  restrained retro accents and good artwork fallbacks.
- [ ] Add brief review/queue transitions and completion/badge feedback. Keep
  reduced-motion support, keyboard alternatives and no mandatory animation waits.
- [ ] Keep existing rewards optional; surface one challenge at a time and demote
  reward settings/statistics. Do not add more XP rules, streaks or purchases-as-progress.
- [ ] Verify desktop/mobile layouts, focus behavior, touch controls, loading,
  empty/error states and large-library responsiveness.

**Acceptance:** choose-next is immediately discoverable; a repeated local task can
select a game in about one minute and review ten wishes in about five minutes.
These are trial targets, not guarantees. No hidden primary action or horizontal
overflow at tested mobile widths; reduced motion and keyboard operation work.

## Stage 8 — Reliability rehearsal and two-week personal trial

**Depends on:** the frozen finish gates above for formal acceptance. Early daily
use can begin now and should guide fixes; it does not claim full MVP acceptance.

- [ ] Confirm the launcher serves the current checkout on a stable local origin;
  explicitly handle moving any existing browser tracking from an older origin.
- [ ] Rehearse import, refresh, restart, offline use, matching correction, manual
  acquisition, queue, pause/resume, finish/retire, replay and undo with real data.
- [ ] Restore tracking plus mappings and required source datasets into a clean
  workspace. State artwork/cache exclusions; test failure and partial-import paths.
- [ ] Run appropriate Node/Python tests, affected isolated browser scenarios,
  sample build and sharing checks. Keep personal data out of committed fixtures.
- [ ] Produce a coverage report by source, system and view: rated, matched/no
  rating, review needed, no match, not applicable, access blocked, retry pending
  and not processed. Include an audited-match sample and source dates.
- [ ] Use the app for two weeks; record choice time, actual play following a
  suggestion, review friction, actual Steam removals versus local archives,
  misleading evidence and whether tracking was enjoyable.
- [ ] Fix observed blockers, preserve valuable simplicity, and record the MVP
  acceptance decision. Do not require completing a long game during the trial.

**Local MVP exit:** useful verified Steam/VGC/retro reception is present; core
workflows are coherent; recovery succeeds; and the trial demonstrates help with
choosing, playing and wishlist decisions. Passing tests alone is insufficient.

## After the local MVP / excluded from these stages

- [ ] Prioritize browser file intake and portable full-dataset backup for a small
  external pilot; validate provider/artwork distribution rights for that release.
- [ ] Decide hosted browser app/PWA versus a desktop wrapper from actual use.
- [ ] Include readable CSV alongside lossless full-workspace backup for portability.
- [ ] Evaluate optional weekly hours/main-and-side-game planning, RetroAchievements
  read-only progress, direct Steam import and later cross-device sync against
  observed friction. Mobile layouts alone do not imply synchronization.

Accounts, cloud sync, social/community features, leaderboards, new store connectors,
automated Steam wishlist edits, background deal alerts, learned taste models,
custom multi-source retro consensus, patch/time-series analytics, best-port scoring
and new gamification systems remain outside the local MVP. Good scores are in
scope; building a new review aggregation service is not.

## Provider checks and remaining access decisions

Checked 2026-09-16. These are implementation inputs, not live integration results.

- [Steam review documentation](https://partner.steamgames.com/doc/store/getreviews)
  describes query-level totals separately from the returned page count. Store
  comparisons must use matching filters; individual-review ingestion is not needed
  for the initial approval baseline.
- [VGC developer documentation](https://videogamescritic.com/developers) documents
  lookup/search/bulk access, conditional caching and quotas (currently 60 anonymous
  requests/hour, 5,000/day with a free key). Follow live response limits. Its
  [citation policy](https://videogamescritic.com/cite) keeps the branded score
  separate from another aggregate.
- [IGDB documentation](https://api-docs.igdb.com/) exposes separate community and
  critic aggregates/counts and edition/port relationships. Live authentication,
  actual retro coverage and score scope still need validation.
- MobyGames' indexed official [API](https://www.mobygames.com/info/api/) and
  [subscription](https://www.mobygames.com/api/subscribe/) pages identify API/score
  offerings, but direct retrieval returned HTTP 403 in this check. Exact fields,
  platform scope, current terms and costs remain unverified. It is a candidate,
  not a promised dependency; no subscription or credential acquisition occurred.

If credentials or a paid source become necessary, first finish the provider
comparison and present the concrete requirement/cost. Continue unaffected stages
while access is resolved; do not silently downgrade the required retro milestone.
