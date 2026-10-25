# Shared tracking foundation

The shared tracking store is authoritative for Recommendations, Owned Games, Steam Wishlist and Play Plan. Existing user records are previewed before migration; accepting the upgrade switches the screens together while retaining the old localStorage keys. An empty workspace initializes automatically. Sample and personal data use separate IndexedDB records, even when only one imported dataset is available.

**Modules**

- `domain.js`: independent ownership, wishlist decisions, backlog commitments, playthroughs and activity. The caller supplies event IDs and timestamps. Starting a replay preserves the previous playthrough; an imported played flag never starts or completes one.
- `legacy.js`: constructs a migration from recommendation v1, owned overrides, wishlist notes and removals. Unknown references remain recoverable targets. Playnite ingestion uses the existing per-copy IDs; grouped legacy notes remain separately scoped rather than being guessed onto one copy.
- `backup.js`: versioned JSON, bounded validation, unresolved-reference reporting, conflict previews and explicit merge choices. Immutable events cannot be replaced. Repeated merges do not duplicate records. Pinned systems are unioned.
- `persistence.js`: IndexedDB adapter and a serialized repository. Revision comparison and writing happen in one transaction. The repository reports success only after transaction completion. A failed save retains an exportable session draft and leaves the previous durable state intact. Unreadable stored data is exposed as a recovery copy and is never overwritten.
- `browser.js`: low-level browser entry point, migration preview/commit, backup preview/commit, and optional BroadcastChannel invalidation.
- `compat.js`: legacy view projections, source-scoped annotations, reviewed identity connections, Up Next ordering and replay preparation.
- `client.js`: one browser client per page, dataset/namespace selection, migration rollout and shared actions. Screens use `trackingClient()` rather than opening competing stores.
- `ui.js` / `styles.css`: migration, recovery and backup dialogs plus consistent copy-scoped progress controls.
- `suggestions.js`: read-only copy eligibility, explained ordering, scoped editorial rank, URL filters and roulette selection.
- `wishlist.js`: structured decisions, distinct review sessions, undo-compatible review events, pair comparisons, confirmed acquisition handoff and conservative target-price checks.
- `../library/wishlist-planning.js`: decision forms, review/comparison dialogs and acquisition controls.
- `../library/suggestions.js`: suggestion cards, copy actions and per-workspace recent draws in sessionStorage. Recent draws are disposable UI state and are not part of tracking backups.
- `group-notes.js`: projects preserved pre-regrouping annotations in their original
  scope and explicitly appends reviewed notes to a new entry. Source/destination
  conflict checks protect stale drafts. No schema change or history merge is needed.
- `../library/backlog.*`: Play Plan, queue ordering, priority, optional suggested limits and manual entries.
- `history.js`: validated playthrough corrections, journal mutations, plan membership metrics, history filters and local-year summaries.
- `history-ui.js`: shared finish/correction dialog and per-playthrough notes/milestones.
- `../library/history.js`: completion cards, cover fallbacks, yearly albums, platform filters and plan statistics.
- `rewards.js`: versioned eligibility, local activity receipts, current reward balances, reversible adjustments, fixed weekly calendars, goals, levels and reward identity links.
- `../library/rewards.js` / `rewards.css`: optional progression, goal editors, cosmetic preferences, audit history and previewed identity corrections.
- `identity.js`: shared explicit reward identity groups, also used to prevent duplicate challenge cells.
- `matches.js` / `matches-ui.js`: reviewed catalog-to-copy associations, expected-value conflict checks and detail-panel review controls. These do not link tracking targets or provider ratings.
- `challenges.js`: owned-copy candidates, six templates, maximum category matching, frozen revisions, local evidence, badge validation and challenge reward entitlements.
- `../library/challenges.js` / `challenges.css`: previews, copy selection, substitutions, regeneration, milestone progress, revision history and archival.

**Using the repository**

```js
import { openTracking } from './tracking/browser.js';
import { applyCommand } from './tracking/domain.js';
import { rewardTransition } from './tracking/rewards.js';

const tracking = await openTracking({
  namespace: 'personal', // Use 'sample' only for the sample workspace.
  catalog, library, wishlist,
  onNotice: showStorageMessage,
});

const preview = tracking.prepareMigration(new Date().toISOString());
// Present recovery errors, unresolved references, additions and conflicts first.
// Resolve each conflict as 'current' or 'incoming', keyed by 'section/id'.
if (preview.ok && preview.migrated) {
  const result = await tracking.commitMigration(preview, userResolutions);
  // saved:false means session-only: offer export rather than saying it was saved.
}

const audit = { eventId: crypto.randomUUID(), at: new Date().toISOString() };
await tracking.update(state => rewardTransition(state, applyCommand(state, {
  type: 'queue', targetId, priority: 1,
  eventId: crypto.randomUUID(), at: new Date().toISOString(),
}), audit));

const backup = tracking.exportBackup(new Date().toISOString());
// Serialize/download backup; do not include it in the source or public build.
await tracking.close();
```

Mutators are synchronous pure functions over a cloned state. Network calls and file parsing happen before `update`. A stale write raises `RevisionConflict` after refreshing the durable view; show the conflict and let the user retry their intended change against that state. Do not automatically reapply whole old snapshots.

`prepareMigration` reads existing data without editing it. It builds a separate incoming workspace and previews a merge, so a delayed migration cannot silently overwrite new tracking. The preview revision must still match at commit time. Keep the legacy files/keys until the integrated UI has saved a complete backup and its migration is accepted. The unprefixed legacy recommendation key is personal data, even when the app displays sample ownership; it must never be copied into sample tracking.

The tracking backup contains tracking records and imported ownership facts supplied to this repository. It does not contain the original library CSV, full generated catalog/metadata, artwork, or original legacy browser keys retained for recovery. It is not a substitute for the publishing plan's future complete dataset backup. Storage currently limits a workspace to a portable 5 MB backup and bounds record counts, text, depth and schema. Validation errors preserve the original input.

Schema and backup version 7 add `productReviews`, keyed by immutable Playnite copy
ID. Versions 1–6 upgrade with no product approvals. Each decision preserves the
candidate ID and origin, corrected product ID, review time and a fingerprint of
copy title/year/platform/store/imported ID/origin. Accepted decisions invalidate
when those fields change; rejects remain rejected, and missing copies retain their
records. Reset is an explicit unresolved record. Conflicting backup or cross-tab
decisions require review. This only associates Steam scores; ownership, queue,
notes, histories and reward identities are not merged or changed.

`products.js` supplies the inventory, fingerprint and validation shared by browser
review, score lookup and CLI refresh. `products-ui.js` supplies the one-copy review
queue in Owned Games → Library tools → Review Steam products, plus copy detail
entry points. A Steam PC copy and explicit user confirmation are required. Title
lookup IDs, CSV IDs and legacy unknown IDs are candidates until reviewed.

Schema and backup version 6 added `matchReviews`, keyed by encoded catalog and
Playnite copy IDs. Version 1–5 data gains an empty review section: old generated
title matches never become accepted automatically. Each decision records its
method, review time and title/platform/year fingerprints. Accepted matches become
unresolved when those identity fields change; rejected matches remain rejected.
Removed copies retain their review records for recovery but cannot claim ownership.
Reset is a stored `unresolved` decision, so backup conflicts cannot silently
resurrect an earlier acceptance. Export and restore use the existing tracking
backup UI; personal reviews are never read by the public build pipeline.

Schema and backup version 5 added challenges, immutable challenge revisions,
challenge activity evidence and badge proofs. Version 1–4 data normalizes with
empty challenge sections, preserving previous rewards and unknown dates.
Version 4 added progression profiles, activity evidence, a reward
ledger, adjustment audit, reward identity links and weekly goals. Older versions
normalize with empty reward sections and never earn XP merely by upgrading.
Version 3 added `journalEntries` and optional playthrough details.
Version 1 workspaces/backups first gain the version 2 `reviewSessions` section;
version 1/2 data then normalizes with an empty journal section. Reading does not
write an upgrade. The next successful atomic save persists version 7.
The IndexedDB database/store layout is unchanged. Older app builds reject the
new schema rather than dropping its fields. Keep a pre-upgrade backup for use
with an older build. Sessions preserve their frozen target IDs and decision-event
references; undo removes a game's counted decision without deleting history.
Conflicting active sessions or dangling review references block a backup merge
and leave the original saved state intact.

Finish corrections mutate the existing playthrough and append a `play-edit`
event with previous/result values. Undo requires the unchanged result and latest
reversible event. Journals have stable entry IDs, expected-value checks and hidden
entry tombstones; each mutation records its previous/result values. New
playthroughs retain played source/platform and a stable ordinal so correcting an
older date cannot move it ahead of a later replay. Original imported history is
not assigned new dates or personal time.

Rewards are opt-in. Activation records the workspace timezone and existing finished
targets as a conservative baseline: correcting or replaying those records does
not make them newly eligible for first-finish XP. New locally recorded, dated
main-game or written personal objectives can earn 100 XP once per target group,
with 10 XP for each finished playthrough's reflection. Unspecified objectives,
unknown/future finish dates and historical records are ineligible. Additional
mastery is one explicit 50-XP tier per group, requiring an achieved journal
objective dated since activation and a dated main-game finish. A week with ten
distinct wishlist review decisions earns 20 XP; ordinary wishlist edits do not.

The shared client captures receipts only from locally added events and reconciles
rewards in the same atomic write as progress. Low-level callers must also wrap
local mutations in `rewardTransition`; imports must **not** capture local receipts.
`mergeBackup` reconciles existing evidence after conflict resolution and accepts
caller-supplied `{at,eventId,reason}` when an adjustment is needed. An imported
finish without receipts extends the baseline; an old backup cannot invalidate
already established local evidence just by omitting it.

`rewardLedger` contains one **current amount** per entitlement. Sum only these
amounts. `rewardAdjustments` is an immutable explanation of changes, not a second
source of credits: independent backups can contain overlapping historical grants.
Local adjustments link to the triggering activity events as well as their reason.
Corrections can set a balance to zero and restore it later without creating a new
entitlement. Events, receipts and adjustment IDs cannot be replaced by an import.
Derived ledger conflicts are reconciled instead of presented as editable scores.

Reward links union explicitly confirmed target identities, keeping scoped history
intact. The UI previews the XP change and checks the same state revision before
confirmation or separation. First-finish/mastery and weekly distinct-game counts
use the linked identity; reflections remain per playthrough. Source-reference
linking cannot discard a target referenced by rewards or goal history.

Weeks start Monday in the activation timezone; device timezone changes do not
change period IDs. Backups with different reward calendars cannot merge. Up to
three goal slots use acceptance time and event sequence so earlier activity at
the same timestamp cannot satisfy a new goal. Continue goals accept a new start,
resume or dated session note; milestones accept a dated achieved entry; reviews
count distinct targets. Replacing/skipping a goal records an audit snapshot and
never grants or deducts XP. There are no streak penalties. The default curve is
100 XP/level (configurable 50–1,000), with cosmetic frames at levels 2/5 and titles
at 1/3/5/10. Hiding rewards preserves earning and ordinary tracking. These rules
are self-reported local progression, not provider-verified achievements.

**Challenge contracts**

Templates use current owned and available copies, excluding hidden/archived,
retired and previously finished games. Rediscovery can explicitly opt into new
replays and excludes Playing/Up Next games. Manual ownership remains a user
assertion, so acceptance asks the user to confirm access and metadata matches.
Only reviewed same-platform catalog matches or explicit tracking links supply
editorial metadata. Match review never merges tracking identities. Top-ten
membership is scoped to one selected system.
Unknown years/genres do not invent decade or genre cells. Grouped copies and
explicit identity links share one assignment resource. Maximum matching prevents
an overlapping genre from stranding a rarer cell; smaller libraries get smaller
boards, and empty pools offer another template.

An instance points to an immutable revision. Each revision freezes rules, selected
copy/edition metadata, catalogue timestamp, snapshot label and ranking mode/method
(`editorial-system-rank`, version 1). Each cell also retains its own ranking basis
when other cells are substituted. Snapshot labels are deterministic fingerprints,
not security signatures. Acceptance requires a current state revision and does
not queue or start a game. Substitution preserves unchanged cell boundaries;
regeneration starts fresh ones. Earlier revisions and earned badge proofs remain
available. Missing imports never rewrite accepted membership.

Local finishes and achieved milestones receive separate challenge receipts even
with XP disabled. Eligibility requires the selected target/copy, a declared main
game or personal objective, a known finish at/after acceptance and a later event
sequence. Pre-existing finishes cannot qualify through toggling. Milestones show
partial progress and grant no challenge completion bonus. Optional personal-season
windows require both the finish/milestone date and recording date in the saved
timezone to fall within the window; ordinary plans are evergreen.

One game fills one cell. A new finish can count across different accepted types,
but cannot be reused for a new instance of the same type. One active instance per
type is allowed; archive it before accepting another. A backup with two active
instances of one type is rejected until the user archives one. Archiving stops new
badge awards without deleting history or existing rewards.

Badges retain their revision and exact finish receipts. Corrections and identity
links revalidate those proofs; invalid badges remain in the audit with a corrected
label and their XP reverses. Restoring the same proof restores its entitlement.
The ledger holds one challenge bonus per instance, including across revisions and
merged backups. Bonuses are 20 XP/cell for passport, decades, rediscovery and season,
25 for top ten, and 15 for bingo. Smaller boards earn a smaller bonus. A prior valid
badge survives regeneration; a second revision does not stack another bonus.
Badges earned with XP off do not retroactively earn points when XP is enabled.
Imports validate/merge existing receipts and proofs but create no local activity.
Challenge plans stay usable when gamification is hidden.

Identity links require explicit edition/platform confirmation. The integrated confirmation flow may combine references when only one side has progress. It preserves source-scoped annotations and records the confirmed reference and date. Two independently tracked histories remain separate until a later reviewed history-merge flow exists. Titles are display data. A Playnite rename retains the copy identity; absence from a snapshot does not remove its notes/history or assert loss of ownership.

**Validation**

`npm test` includes the deterministic domain, migration, backup, persistence-failure and concurrency checks. No new package dependency is required.

An additional integration runner exercises actual Chromium IndexedDB with synthetic data in a fresh, isolated browser context. All requests are intercepted locally; it does not open a user browser profile, the running application, or personal imports. It requires an existing Playwright installation and Chromium executable:

```sh
node scripts/check-tracking-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
```

The browser check covers migration, durable reopen, atomic interrupted writes, stale writers, backup restoration, namespace isolation and BroadcastChannel updates. The project's default dependency-free test suite does not install a browser; run these checks separately when changing persistence or its UI integration.

The second runner loads the sample build under a subpath, routes every request
locally, and uses authored fixtures as synthetic personal/mixed datasets. It checks
actual migration and backup dialogs, copy linking, cross-tab play/pause/finish/undo,
notes, removals, manual Up Next entries, repeated restore and mobile navigation:

```sh
npm run build
node scripts/check-backlog-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
```

A third runner covers version 1 workspace upgrades, wishlist decisions, price
filters, review resume/undo, comparisons, acquisition handoff, exports, clean
browser backup restore and mobile dialogs:

```sh
node scripts/check-wishlist-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
python3 tests/wishlist_price_test.py
```

History has its own browser runner using a fictional six-game plan and a version
2 IndexedDB fixture. It checks finish details, correction, replay journals, stale
edit protection, album filters, clean restore, cover fallbacks and mobile layout:

```sh
node scripts/check-history-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
```

The 2026-09-14 R2-A checkpoint passes 78 Node tests, 4 Python price-import tests,
14 Chromium storage checks, 13 existing UI scenarios, 8 wishlist UI scenarios and
8 history UI scenarios. Browser checks use fictional fixtures; public builds
remain sample-only.

R2-B adds a progression walkthrough covering activation, finish/reflection/undo,
mastery, goals, hiding rewards, cosmetic frames, stale duplicate-link previews,
cross-tab updates, repeated backup restore in another timezone and mobile editors:

```sh
node scripts/check-rewards-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
```

The 2026-09-15 R2-B checkpoint passes 92 Node tests, 4 Python tests and 52 isolated
Chromium scenarios (14 storage, 13 backlog, 8 wishlist, 8 history and 9 progression).
Sample build, sharing and whitespace checks pass; desktop and mobile progression
screenshots were reviewed using fictional data.

R2-C adds the challenge browser runner. It uses a version 4 workspace and fictional
owned games, checks a catalogue rank refresh, substitutes a cell, completes and
corrects a board, restores its backup repeatedly and checks mobile/hidden views:

```sh
node scripts/check-challenges-browser.mjs --playwright /path/to/playwright/index.js --browser /path/to/chromium
```

The R2-C checkpoint passes 107 Node tests, 4 Python tests and 60 isolated Chromium
checks (the prior 52 plus 8 challenge scenarios). A synthetic library of 2,000
games with the full public catalogue produced season/bingo/passport/decade previews
in roughly 40–65 ms on the development machine; these are local measurements.

**Current boundaries and next increments**

- Undo corrects the latest reversible queue, wishlist or status event for a target;
  it appends an audit event. Starting a replay preserves prior finishes. Up Next
  selection records its own event so an older queue operation cannot be undone
  across that change. Event ordering survives JSON key reordering.
- Matching candidates are suggestions requiring edition/platform confirmation.
  Progress never links automatically by title. Group-level owned notes remain
  separate from copy-specific progress.
- Play Plan now supplies explained suggestions and filtered roulette. Explicit Up
  Next order wins over other ordering; active games come next, then backlog
  commitments, priorities, favorites, and editorial rank only within one selected
  system. Cross-system ties use title order. No imported best score, lifetime
  hours, VGC score or invented duration enters this ordering.
- Suggestions use owned copies by default. Manually selected games with unknown
  ownership require opt-in. Hidden games require opt-in; archived targets and
  unavailable/missing imported copies are excluded. Finished/retired games need
  an explicit replay. Platform/source filters must match one copy. Confirmed
  copies share one choice; title/platform metadata hints never merge histories.
- Roulette draws from the same filtered eligible set with equal chances, without
  ranking weights. It can exclude the last ten draws; exhaustion requires an
  explicit clear or opting out. Recent draws survive reload in that tab and stay
  separate by workspace. Tracking and backups are unchanged by a draw.
- A synthetic scale check using the full 4,551-entry catalog and 2,000 imported
  copies measured about 19 ms to build choices and 10 ms to filter on the
  development machine; these are local measurements, not performance guarantees.
- R1-C now includes structured wishlist review and acquisition handoff. Acquisition
  creates manual ownership and only queues a game when requested. Exact Steam
  app IDs provide hints; edition/platform confirmation is still required. Acquired
  entries are excluded from ordinary removal actions and have a separate export.
- Prices retain their source observation timestamp and currency. Only a known
  observation within seven days in the target currency can satisfy a target.
  Review/snooze dates use local calendar dates. No background alerts run.
- R2-A supplies completion cards, history albums, playthrough corrections,
  session notes and manual milestones. R2-B supplies XP, mastery, cosmetic levels,
  weekly goals and reviewed reward identity links. R2-C supplies six challenge
  templates, seasonal windows, frozen membership and reversible badges/bonuses.
  Card exports and reviewed merging of two complete histories remain future work.
- Plan statistics use only current backlog membership. Retired items stay in the
  denominator; replays become remaining until finished. Year summaries count
  playthroughs and manually recorded totals separately. Net plan size change is
  additions minus removals, including correction events. Earlier Up Next events
  lacking membership details make change counts partial, never invented.
- Tracking backups remain distinct from the publishing plan's complete dataset
  export. There are no accounts, external services or cloud synchronization.
