# Backlog, wishlist, and progression implementation plan

**Current delivery sequence:** follow [the next-stage checklist](NEXT-STAGES-CHECKLIST.md).
Existing R1/R2 functionality is the foundation. Next work connects verified
Steam/VGC/retro scores to everyday decisions, simplifies workflows and validates
the local MVP; additional gamification and Release 3 expansion remain deferred.

Prepared 2026-09-11; implementation started 2026-09-12. Status as of 2026-09-15: R1-A shared tracking, R1-B Play Plan/suggestions/roulette, R1-C wishlist decisions/reviews/acquisition, R2-A completion cards/history/statistics, R2-B XP/levels/weekly goals, and R2-C challenges/seasons are implemented. Releases 1 and 2 are complete. Optional Release 3 integrations and the separate ranking/publishing plans remain. Defaults below are recommended starting points; open decisions are recorded at the end. The subsequent [ranking implementation plan](RANKING-IMPLEMENTATION-PLAN.md) defines evidence, source integrations, and ranking modes for recommendations and retro challenges.

The [publishing implementation plan](PUBLISHING-IMPLEMENTATION-PLAN.md) covers browser imports, optional cloud accounts, distribution, and community features; coordinate its shared persistence work with R1-A below.

**Implementation checkpoint — 2026-09-12**

The first R1-A package is in [tracking/](../../tracking/README.md): stable source references, separate ownership/intent/progress records, legacy migration previews, versioned backup validation/merge, and atomic IndexedDB persistence with revision checks and recoverable failed writes. Domain tests and an isolated real-browser storage check cover the critical contracts. Existing pages and saved data have not switched to this store yet; R1-A is not complete until the cross-view UI, backup dialogs, and migration rollout meet its acceptance criteria. The integration checklist is recorded with the modules.

**Implementation checkpoint — 2026-09-14**

Delivered: shared IndexedDB reads/writes for recommendation flags and pins, owned
annotations, wishlist notes/removals, and copy-scoped progress; migration review
and recovery; one tracking backup dialog; explicit matching-release confirmation;
Play Plan with ordered Up Next, Playing, Paused, Backlog, Finished and Retired
views; priority and suggested queue sizes; objectives, replay history and undo of
the latest reversible progress change; manual entries; navigation/build integration.

The UI retains legacy storage and source-scoped notes. Imports do not infer
progress. A confirmed link can attach an untracked release to an existing history;
two independently tracked histories require a later reviewed merge flow and are
currently kept separate. Unknown dates remain unknown. Backups contain tracking,
not complete source datasets or artwork. No rewards are awarded in this increment.

Validation includes deterministic domain/storage tests and isolated Chromium
checks for migration, linking, cross-tab progress, replay/undo, wishlist removal,
backup restore, mobile navigation and mixed sample/personal data. Public build
checks use synthetic private markers. See `tracking/README.md` for commands.

The selection increment below completes R1-B suggestions and roulette. Next is
R1-C wishlist review decisions and acquisition handoff. R2 completion cards, statistics,
XP and challenges depend on that reliable history. Ranking and publishing remain
separate later workstreams. The baseline table below describes the starting point
used to write this plan, not the current integrated storage implementation.

**R1-B selection checkpoint — 2026-09-14**

Added “What should I play?” with three explained suggestions, bookmarkable system,
store/source, genre, intent, ownership and visibility filters, copy selection,
and filtered roulette. Eligible Up Next choices preserve their manual order;
active games follow, then backlog commitments, priorities and favorites. Only a
selected system's editorial positions break remaining ties; all-system ties use
title order. Current imported score maxima and lifetime playtime do not influence
this personal ordering. There is no external score integration in this increment.

Ownership is required by default. Users may include manually planned games whose
ownership is unknown. Hidden games are opt-in; archived targets and unavailable
or missing imported copies are excluded. Finished/retired games require explicit
replay intent. A system/source combination must match one copy. Metadata matches
never link progress automatically, and confirmed copies share a single choice.

Roulette uses the same eligible set with equal chances, independent of suggestion
ranking. The last ten draws can be excluded, with explicit reset on exhaustion.
Recent draws are disposable, per-workspace tab state and survive reload; they do
not create activity, backlog entries or backup records. Current imported copies
are preferred over duplicate manual ownership records in suggested actions.

Validated with 58 Node tests and 13 isolated browser scenarios, including the
existing migration/backup flows, roulette exhaustion and reload, unchanged
tracking after draws, filter URLs, copy selection, namespace isolation, and
mobile navigation. The source build remains sample-only. R1-C is next; completion
cards, statistics, XP and challenges remain in R2.

**R1-C wishlist checkpoint — 2026-09-14**

Implemented structured decisions, interest priority, reason, target amount and
currency, local review/snooze dates, bookmarkable filters and optional priority
sorting. Resumable sessions freeze up to ten distinct due entries and count Keep,
Want soon, Wait for price, Snooze and Archive equally. Undo restores the previous
decision and count; stale edits cannot overwrite another tab's decision. Pair
comparison supports A/B/Both/Neither/Skip without deleting the unchosen entry.

Acquisition requires explicit edition/platform confirmation. Exact Steam app IDs
provide import hints and owned alternatives explain genre/platform matches.
Ownership-only is the default; Backlog and Up Next are explicit handoffs and do
not start playthroughs. Notes and history remain intact; unknown dates remain
unknown. Acquired entries have a separate view/export and are protected from bulk
removal. Imported Owned Games data still updates through a library import.

Target-price checks require a same-currency observation at most seven days old.
Unknown/future dates and currency mismatches cannot satisfy a target. Steam cache
fetches now carry observation timestamps; rebuilding an old cache never makes its
price fresh. An explicit `--refresh` retrieves new metadata. No price alerts run.

Tracking/backup schema 2 adds review sessions; version 1 data upgrades without a
write on read, and the next successful save commits the new state atomically.
Legacy notes/removals, unknown targets and existing backup merge safeguards remain.
Validation: 69 Node tests, 4 Python price-import tests, 14 isolated Chromium storage
checks, 13 existing browser scenarios and 8 wishlist scenarios including clean
restore and mobile layout. Build/privacy checks use authored or synthetic data.

Next: R2-A finish details, completion cards, history albums and statistics based on
explicit plan membership. XP, milestones and weekly goals follow in R2-B; this
increment records review progress without granting rewards. Ranking and publishing
remain separate workstreams.

**R2-A history checkpoint — 2026-09-14**

Implemented the shared finish flow with achieved objective, optional dates, total
playthrough minutes, personal 0–5 rating and reflection. Optional finish details
are collapsed initially. Play Plan now includes completion cards, yearly albums,
platform/status/search filters, cover fallbacks and a year summary. Unknown dates
stay outside dated albums. Existing artwork is reused in-app; image/PDF exports
remain deferred as planned.

Corrections update the same playthrough/card and append an audit event; undo is
available for the latest unchanged reversible action. Replays retain separate
records and stable order. Session notes and planned/achieved milestones belong to
individual playthroughs, with editing, hiding and restoration. Imported lifetime
hours never enter personal playthrough totals or create recent completions.

Current backlog commitments define plan membership. A six-game plan with three
finishes and one retirement shows 3/6 (50%), one retired and two remaining.
Removing a commitment changes membership; starting a replay makes that member
remaining again. Net plan size change is reported separately as recorded
additions minus removals, including repeat commitments and corrections. Older Up
Next events without membership details are labeled as partial change data.

Schema/backup version 3 adds journal entries and optional playthrough metadata.
Version 1/2 backups and stored workspaces normalize without writes on read; the
next successful atomic save persists the upgrade. Stale editors retain drafts;
conflicting active playthroughs and invalid journal references are rejected.
Validation: 78 Node tests, 4 Python tests, 14 Chromium storage checks, 13 existing
UI scenarios, 8 wishlist scenarios and 8 history scenarios, including clean restore
and mobile/keyboard checks. Public build and sharing checks pass.

Next: R2-B versioned reward rules, a deduplicated XP ledger, optional levels and
weekly goals. Manual milestones currently record history and grant no rewards.
R2-C challenge templates follow; ranking and publishing remain separate plans.

**R2-B progression checkpoint — 2026-09-15**

Implemented opt-in progression in Play Plan: versioned 100/50/10/20-XP rules,
cosmetic levels and titles, completion card frames, three weekly goal slots,
preferences, reward explanations and adjustment history. Existing finishes are
captured as an activation baseline. Newly recorded dated main-game finishes and
written personal objectives qualify; unspecified objectives, unknown/future dates
and imported historical finishes retain history without new points. Replays do
not repeat first-finish XP; each eligible locally finished playthrough can earn
one reflection reward. Editing text or recording hours adds no points.

Mastery is one additional objective tier per verified target group. It requires
an explicitly written, achieved journal objective dated since activation and a
dated main-game finish. Ordinary milestones remain useful goal steps. Wishlist
bonuses require ten distinct decisions in review sessions, including keeps, once
per week. Purchases, imports and goal completion itself grant no bonus.

Defaults settled through the fictional walkthrough: 100 XP per level, configurable
from 50–1,000; brass/folio frames at levels 2/5; Explorer/Wayfinder/Chronicler/Archivist
titles at levels 1/3/5/10. Core tracking is available at every level. Hiding the
presentation preserves rewards and the chosen cosmetic frame. Goals count new
start/resume/session notes, achieved milestones, or wishlist reviews after their
acceptance. Goal replacements and skips are recorded; no missed-week penalty runs.
Weeks start Monday in the saved activation timezone, including after device moves.

Schema/backup version 4 adds progression, evidence, current reward balances,
adjustments, reward identity links and weekly goals. Older schemas normalize with
empty sections without writes on read. Local progress and reward changes commit
together. Imports reconcile existing evidence and do not manufacture activity.
The ledger holds one current amount per entitlement; its adjustment trail is
explanatory and is never summed again as credits after merging backups. Corrections
reverse invalid amounts and can restore the same reward later.

Duplicate reward links require edition confirmation and a reviewable XP preview
against the current revision. They consolidate eligibility, keeping playthroughs,
ownership and notes on their original records. Link separation is also previewed.
Two complete progress histories still cannot be merged. Backups with different
reward calendars require separate browser workspaces. Local rewards are personal
records, with no provider achievement verification or public leaderboards.

Validation: 92 Node tests, 4 Python tests and 52 isolated Chromium checks (14
storage, 13 backlog, 8 wishlist, 8 history and 9 progression). Reversal/restoration,
duplicate imports, concurrent writes, fixed weekly boundaries, review rewards,
mobile layouts and clean backup restore are covered. Sample build, sharing and
whitespace checks pass. The default build continues to exclude personal data.

Next: R2-C challenge templates and frozen eligible membership. Challenge bonuses,
card exports, external achievements, the ranking overhaul and publishing rollout
remain separate work. See `tracking/README.md` for implementation and checks.

**R2-C challenge checkpoint — 2026-09-15**

Implemented six data-driven owned-game templates: console passport, decade tour,
one system's owned top ten, genre bingo, rediscovery and a six-game personal season.
Candidates require current accessible ownership, exclude hidden/archived/retired
games and exclude prior finishes unless rediscovery explicitly allows new replays.
Preview and copy selection require access/edition/metadata confirmation before
acceptance. Acceptance does not add commitments or start playthroughs. Unknown
metadata is not invented; small libraries get smaller boards or another template.

Copies in an imported game group and explicitly linked targets share one cell
resource. Maximum matching handles overlapping genres. One finish can satisfy
different accepted types, but cannot be reused for a new instance of the same type.
One active instance per template is allowed. Challenge plans work without enabling
XP and remain usable when its presentation is hidden.

Accepted rules, copies, metadata, per-cell ranking basis and catalogue fingerprints
are frozen in immutable revisions. Current ranking mode is explicitly the existing
editorial order within one system, version 1. Catalogue/import refreshes do not
change an accepted objective. Substitutions preview new candidates and preserve
unchanged cell progress. Regeneration starts new boundaries while retaining prior
revisions and earned badge evidence. Archived plans retain their history.

New dated local finishes of declared main-game/personal objectives fill cells.
Journal milestones show partial progress without granting a completion bonus.
Evergreen plans are the default. Optional season windows use the saved timezone
and require both the finish and its recording inside the window. Old finishes,
unknown dates, imports and repeated status changes cannot manufacture completion.

Badges keep exact finish proofs and a revision reference. Corrections and duplicate
identity links revalidate them, reversing invalid XP with the existing adjustment
audit. An earlier valid badge survives regeneration; revisions do not stack
bonuses. Bonuses scale with accepted board size: 20 XP/cell for passport, decades,
rediscovery and season; 25 for top ten; 15 for bingo. A challenge has one current
bonus entitlement. Enabling XP after earning a badge grants no retroactive points.

Schema/backup version 5 adds challenges, immutable revisions, activity evidence
and badge proofs. Versions 1–4 normalize with empty sections without writes on read.
Stale previews, duplicate active instances, missing references and replacement of
immutable evidence are rejected. Progress, badges and rewards commit atomically.

Validation: 107 Node tests, 4 Python tests and 60 isolated Chromium checks, including
8 challenge scenarios. Desktop/mobile layouts were inspected with fictional data.
Two thousand synthetic owned games produced previews in roughly 40–65 ms locally.
The sample build, sharing checks and whitespace checks pass. Public output remains
sample-only; no personal data or artwork is added.

Ranking K0/K1 implemented 2026-09-16: reviewed coverage pilot, copy-specific
imported ratings and corrected wishlist approval ordering. Next is K2 verified
mappings/cached observations, followed by broader K4 views. Challenge snapshots
are ready for future ranking modes. External achievements, duration services, card exports and the publishing
rollout remain separate work; they were not bundled into this phase.

**1. Product objective**


Connect discovery, wishlist decisions, owned games, and play history in one local-first experience. Help the user choose a manageable set of games, enjoy making progress, and preserve a personal record of what they played.

The principal flow is: discover a game → decide whether to wishlist it → record acquisition → optionally select it for a backlog → play → finish or retire → preserve the experience. Ownership, purchase intent, and play progress remain independent. Owning a game never automatically makes it a backlog commitment.

The project's distinctive feature should be retro exploration: turn its curated rankings, platforms, genres, and eras into useful recommendations and optional challenges based on games already owned.

**2. Existing foundations and gaps**

| Area | Current implementation | Required extension |
| --- | --- | --- |
| Recommendation tracking | `lib.js` and `app.js`: favorites, manual ownership, wishlist flag, and untracked/backlog/playing/completed/dropped statuses, keyed by catalog release ID. | Shared tracking accessible from owned games and wishlists; preserve legacy links and values. |
| Owned library | `library/app.js` and `library/tools/build_site.py`: grouped titles, underlying copies, sources, platforms, play count, aggregate playtime, notes, favorites, and played/unplayed filtering. | Explicit backlog selection, progress, preferred copy, playthroughs, and reliable dates. |
| Steam wishlist | `library/wishlist.js`: price/review/genre filters, ranking within genres, notes, ownership indicators, and reversible local removals. | Structured decisions, priority, target price, review sessions, and acquisition handoff. |
| Identity matching | `library/core.js`, `scripts/connect-library.mjs`, and `scripts/snapshot.mjs`: conservative title/alias and platform connections. | Persistent source references and user-reviewed links across views without assuming editions are equivalent. |
| Persistence | Separate recommendation and library/wishlist browser stores and backup formats. | One versioned export covering tracking, history, plans, challenges, rewards, and identity links. |
| Builds/navigation | `navigation-template.js`, `scripts/sync-navigation.mjs`, `scripts/build.mjs`, and `scripts/serve.mjs`. | Include new pages/modules in navigation, serving, and explicit build allowlists. |

Current rankings are editorial and system-specific. They are useful inputs, not a universal score across platforms. Catalog `gameId` values group normalized names for convenience and are not an authoritative edition identity. See `docs/CATALOG.md`.

**3. Product rules to preserve throughout implementation**

- Imports update source facts; they do not overwrite explicit user decisions, manufacture completion dates, or award activity XP.
- A played flag or nonzero platform playtime does not establish current playing status, completion, or progress percentage.
- Keep paused and retired states. Retirement removes an active commitment but never counts as finishing.
- Keep main-game completion, optional mastery, and personal objectives distinct. Support games with no conventional ending.
- Make all progress features optional. Use flexible weekly goals and evergreen challenges; no mandatory daily streaks or missed-goal penalties.
- Reward playing, reflection, and considered decisions. Purchases, imports, and repeated status toggles earn no XP.
- Preserve browser-local operation and account-free use for the first two releases. Manual entry must remain viable when external metadata is missing.
- Sample and personal edits remain separate, including after backup import. Public builds must continue to contain authored samples only.

**4. Shared data model and persistence**

Define the following logical records before choosing their final module boundaries. These are domain concepts, not a requirement for a database table per row.

| Record | Minimum content and semantics |
| --- | --- |
| Tracking target | Stable local ID; display metadata; verified source references; edition/release scope. Do not use a mutable title slug as the sole durable identity. |
| Source reference | Provider and external ID, e.g. catalog release ID, Playnite copy ID, Steam app ID; match method, confidence, and any user-confirmed link. |
| Ownership/copy | Target reference, platform/store, imported or manual evidence, accessibility/availability when known, optional acquisition date, and preferred copy. |
| Wishlist decision | Interested/want-soon/wait-for-price/maybe/archived/acquired; interest priority; reason; optional target amount and currency; next review date; decision timestamps. |
| Backlog entry | Target, selected copy/platform where applicable, priority, queued date, optional personal objective, and explicit inclusion in Up Next or a plan. |
| Playthrough | Stable ID; target/copy; not-started/playing/paused/finished/retired status; objective type; optional dates; progress notes; rating/reflection; completion and mastery milestones. |
| Session | Optional playthrough link, occurrence date, manually recorded duration or session note, and provenance. Aggregate platform counters remain separate to prevent double-counting. |
| Plan | Named selection, stable membership IDs, optional period, target, and membership-change history. Supports an ongoing queue and later seasonal plans. |
| Activity event | Stable ID, event type, target/playthrough, occurrence time where known, recording time, source, and correction/supersession reference. |
| Challenge/reward | Definition and rule version; accepted challenge instance; frozen eligible membership where needed; progress; unique earned reward keys and adjustments. |
| Settings | Profile namespace, timezone/week-start preference, gamification visibility, queue preferences, and backup/migration versions. |

Recommended persistence: introduce a small IndexedDB adapter for shared state and atomic updates involving progress and history. Keep lightweight display preferences in their current storage initially. Domain operations, matching, reward evaluation, and validation should be pure JavaScript functions that can be tested with `node --test`.

Use state records plus an activity history; a full event-sourced architecture is unnecessary. A status change and its event must commit together. Cross-tab changes should trigger a refresh, with revisions preventing a stale tab from silently replacing newer decisions. If persistent storage fails, report the failure and retain an exportable session copy instead of claiming success.

All dates are optional when unknown. Separate acquisition, first observed in an import, backlog entry, playthrough start, and finish dates. Store instants consistently and apply the user's timezone when calculating weekly periods. Changing timezone must not create duplicate weekly rewards.

**5. Release 1 — shared tracking and useful decisions**

Deliver in three independently reviewable increments. Complete each increment's acceptance criteria before building its dependents.

**R1-A: Identity, shared state, migration, and backup. Size: large. Dependencies: none.**

Create shared domain, persistence, and source-adapter modules; suggested location: `tracking/`. Add durable identity links without replacing the existing catalog or imported snapshots. Preserve Playnite copy IDs through the generated data and prefer verified provider IDs over title matching. Title-based matches can suggest links; ambiguity and edition differences require review before shared progress is applied.

Migrate recommendation collection v1, library overrides, wishlist notes, and local removals. Map legacy backlog to an explicit backlog entry; playing/completed/dropped to the corresponding playthrough state; untracked to no commitment. Preserve manual ownership as an assertion separate from imported ownership. Map legacy wishlist flags to interested and removals to archived. Preserve completed status with unknown finish date and a historical-import marker; do not fabricate recent activity or XP.

Where source records cannot be safely linked, retain separate targets and offer a later link-review action. If two platform releases have different statuses or notes, preserve both scoped histories; never flatten them into one arbitrary value. A source disappearing during refresh must not erase its personal history. Title corrections should retain explicit aliases or an ID migration record.

Legacy Completed remains a generic recorded finish until the user supplies its meaning; migration must not reinterpret it as 100% completion or mastery.

Keep legacy stores intact until migration has committed and a new backup can be exported. Record migration IDs so reloads and retries do not repeat it. If a backup contains unresolved references, preserve them with a recoverable label and report them in the import preview. Backups need bounded validation, schema versions, conflict previews, and deterministic merge behavior. Reimporting the same backup must not duplicate events or rewards.

Acceptance criteria:

- Existing edits survive migration, reload, and export/import into a clean browser profile.
- A safely linked game shows consistent progress across Recommendations, Owned Games, and the new Play Plan.
- Different editions and ambiguous titles stay separate; different copies retain their platform/store details.
- Mismatched or conflicting legacy entries remain recoverable with no silent data loss.
- Interrupted migrations and quota/write failures leave prior data intact and do not report a successful save.
- Sample/personal namespaces and sample-only builds pass the existing isolation checks.

**R1-B: Play Plan, Up Next, and basic recommendations. Size: medium. Depends on R1-A.**

Add a Play Plan page, preferably `library/backlog.html`, with Up Next, Playing, Paused, and Finished/Retired views. Add actions to the existing game detail panels. Keep Saved Picks as a compatible view or entry point until its favorites and bookmarks have a clear replacement.

Default Up Next to a suggested capacity of five, and suggest two active games. Both are soft limits that the user can change. Provide keyboard-accessible move-up/move-down controls alongside any drag interaction. Allow priorities, choosing the copy to play, personal objectives, pause/resume, finish, retirement, and undo/correction.

Ship basic “What should I play?” suggestions using available facts: continue a user-marked active game, choose a high-priority queued game, or rediscover an owned curated recommendation. Rank candidates by explicit intent and selected filters, then the selected reception/ranking mode within its supported scope. Until sourced rankings are available, retain labeled editorial rank within the selected system. Show reasons. Do not equate ranking position across unrelated lists or invent duration information. Apply the source-separation and VGC attribution rules from the ranking plan.

Include filtered roulette restricted to eligible candidates, with optional exclusion of recently offered games and a reroll action. Favorites, hidden games, archived targets, and unavailable copies must have explicit eligibility rules. Manual pins always take precedence over recommendation scoring.

Acceptance criteria:

- Importing an owned library leaves the backlog unchanged until games are selected.
- Starting, pausing, finishing, and retiring a game updates all relevant views and survives reload.
- A completed historical playthrough remains available when the user starts a replay.
- Games without an ending can use a personal objective without being labeled fully completed.
- Suggestions respect ownership/copy filters, explain their selection, and work with missing metadata.
- Bookmarkable URLs, existing Saved Picks links, mobile layout, and keyboard navigation remain usable.

**R1-C: Structured wishlist decisions and acquisition handoff. Size: medium. Depends on R1-A; handoff uses R1-B.**

Add decision state, interest priority, target price/currency, reason, and review/snooze date. Retain current price/review filtering, genre ranking, removal exports, and restore operations. Separate acquired entries from intentional rejection in both display and exports. Local decisions continue to leave the Steam account unchanged.

Add a ten-game review session with Keep, Want Soon, Wait for Price, Snooze, Archive, and Undo. Session progress counts distinct entries reviewed, including keeps; it must not encourage deletion. Allow resuming an interrupted session. Offer an optional pairwise comparison within a shortlist with A, B, Both, Neither, and Skip decisions.

Show owned alternatives using existing genre/platform data, favorites, and curated matches, with an explanation. Acquisition can be recorded manually or suggested by a reliable new import match. Preserve wishlist history; offer Add to Up Next, Add to Backlog, or Keep in Library. Never assume another-platform ownership satisfies the desired purchase.

Target-price filtering evaluates the last imported price in the same currency, displaying its snapshot date. No background notifications are promised in this release.

Acceptance criteria:

- Legacy wishlist removals remain reversible and exportable.
- Review sessions retain decisions after reload; undo restores the previous decision and count.
- Buying/recording ownership preserves notes and dates and does not automatically create a backlog entry.
- Platform/edition mismatches are visible and do not automatically archive a wanted copy.
- Unknown/stale prices and currency mismatches cannot falsely satisfy a target price.

**6. Release 2 — history, progression, and retro challenges**

**R2-A: Completion cards, play history, and honest statistics. Size: medium. Depends on R1-A/B.**

Create a finish flow with objective achieved, optional time, rating, and reflection. Keep it quick and allow skipping optional fields. Generate a completion card from existing cover art plus those personal details. Group cards into yearly albums and platform collections; support filtering and viewing past playthroughs. A year-in-review view should summarize recorded facts and distinguish unknown dates.

Offer lightweight session notes and manual milestones for longer games. Keep platform lifetime playtime separate from per-playthrough time; never add both as if they were independent sessions. Optional image/PDF exports of cards can follow the initial in-app album after artwork/export behavior is reviewed.

Show completed, retired, added, and remaining plan items separately. Define plan completion as finished eligible plan items divided by the explicitly selected plan membership. Retirement remains in the denominator and is shown separately; removing an item changes membership and is recorded. Show net backlog change independently. New library imports do not affect these metrics unless explicitly added to the plan.

Acceptance criteria:

- A six-game plan with three finishes and one retirement shows three finished, one retired, and two remaining; completion is 3/6.
- Replays create distinct records and cards; imported historical completions have no invented dates.
- Correcting a completion updates its card and statistics without leaving duplicate history.
- Missing covers, time, or rating have useful fallbacks.
- An additional library import does not change plan completion or erase personal progress.

**R2-B: XP, levels, milestones, and weekly goals. Size: medium. Depends on R2-A and R1-C.**

Implement versioned reward rules with a deduplicated reward ledger. Provisional values:

| Action | Starting reward | Limit |
| --- | --- | --- |
| First recorded finish of a game or declared personal objective | 100 XP | Once per verified tracking target for the core finish reward. |
| Additional mastery objective | 50 XP | Once per target/objective tier; explicitly defined and separate from main-game completion. |
| Reflection after a finished playthrough | 10 XP | Once per playthrough; editing the text earns nothing further. |
| Ten distinct wishlist decisions | 20 XP | One set per week; keeps count equally with archives. |
| Accepted themed challenge completed | Definition-specific bonus and badge | Once per challenge instance. |

Replays remain visible in history; repeat finish XP is disabled by default. Imported achievements/completions may populate history but do not create newly earned local activity rewards. No rewards for purchases, imports, login, repeated toggles, opening cards, or raw hours played.

Use a simple configurable level curve; settle its thresholds during a synthetic progression walkthrough. Do not hide core functions behind levels. Unlock cosmetic card frames or profile titles only. Allow the entire XP/badge presentation to be hidden while keeping tracking usable.

Offer up to three optional weekly goals: continue a selected game, record a declared milestone, or review wishlist entries. Keep goals adjustable and allow skipping or replacing them. A broken streak causes no loss. Corrections reverse invalid rewards through traceable adjustments; that is distinct from a missed-goal penalty. Define one stable weekly period key so time changes cannot grant repeat rewards.

Acceptance criteria:

- Toggling finished → playing → finished cannot farm XP.
- Duplicate imports, backup merges, and concurrent tabs cannot award the same reward twice.
- Undoing an erroneous completion updates XP, cards, challenge progress, and stats consistently.
- Linking duplicate identities consolidates duplicate reward eligibility through a reviewable adjustment.
- Users can hide gamification and continue all ordinary library/wishlist operations.

**R2-C: Retro challenge templates and seasonal plans. Size: medium. Depends on R2-A/B.**

Start with data-driven templates: console passport, decade tour, three owned games from one system's top ten, genre bingo, rediscovery, and a six-game personal season. Generate candidates from owned, accessible, eligible games using the current metadata. Exclude already-finished games unless the template explicitly includes replays.

Provide a preview showing matching games before acceptance, substitutions, and progress explanations. Freeze challenge rules, ranking mode/method version/snapshot, and relevant candidate/membership metadata at acceptance so ranking edits do not silently change the objective. Allow explicit regeneration with a preview. Evergreen challenges are the default; dated seasons are optional.

Define whether one game can satisfy multiple cells. Recommended default: one game per bingo cell within a board; a completion may count toward different accepted challenge types. Avoid impossible boards by reducing their size or offering a different template when metadata or eligible games are insufficient.

Acceptance criteria:

- Challenges remain achievable with small libraries and do not require purchases.
- Genre overlaps and multiple copies cannot accidentally fill several cells with one completion.
- Substitutions and rule changes are visible; existing earned badges remain traceable.
- Catalog refreshes do not unexpectedly reset accepted challenges.
- A long game can produce visible progress through declared milestones before its final completion.

**7. Release 3 — optional external data and automation**

Each item is independent unless its dependencies say otherwise. Revalidate provider capabilities and terms when implementation begins; the research is not an integration contract.

| Workstream | Proposed scope | Dependency and delivery boundary |
| --- | --- | --- |
| Duration-aware planning | Main-game/mastery estimates, manual overrides, source and confidence, short-game filters, remaining-time suggestions. | R1-B and R2-A. Manual estimates can ship locally first. Select a permitted provider or import path before promising automated enrichment. |
| “Quick Win” and “Homestretch” | Recommend short eligible games and active games the user reports close to finishing. | Duration data or explicit progress. Platform lifetime hours divided by an estimate is never authoritative completion percentage. |
| Improved import refresh | Preview new/changed/disappeared copies, reliable acquisition suggestions, optional progress evidence. | R1-A. Extend Playnite exports only for fields actually available; user progress remains authoritative. |
| Achievement integration | Optional RetroAchievements/Steam or other provider links, milestone evidence, and separate platform achievement displays. | Provider identity mapping, supported authentication, and source-specific semantics. External badges remain distinct from local XP. |
| Price alerts | Target price, preferred stores/currency, freshness, deduplication, and optional alert retirement after acquisition. | R1-C plus a separately designed background service or local scheduler. A closed static page cannot deliver unattended checks. |
| Release calendar | Upcoming wishlisted releases filtered by platform; uncertain dates displayed as uncertain. | Reliable release metadata and refresh timestamps. |
| Sharing/game clubs | Exportable personal retrospectives first; optional shared challenges/bounties later. | A separate product decision on accounts, hosting, sharing, and moderation. Not required for personal progression. |

API credentials must remain outside static assets and backups. Prefer an import/enrichment command or an appropriately scoped local/server component where a secret is necessary. Live syncing, cloud accounts, push notifications, public feeds, and global competitive leaderboards are outside the first two releases.

**8. Validation and delivery checklist**

Use the repository's existing Node test runner for domain logic and synthetic fixtures. Add tests where loss of user history, incorrect ownership, duplicate rewards, or misleading statistics is possible. Validate browser persistence with a real browser; pure-function tests alone do not prove IndexedDB transactions or cross-tab behavior.

| Area | Required scenarios |
| --- | --- |
| Identity and migration | Same game on two platforms; remaster versus original; ambiguous names; renamed title; conflicting legacy statuses; unresolved backup references; interrupted migration. |
| Persistence | Reload, clean-profile restore, repeated import, unavailable storage, stale tabs, corrupt input, and sample/personal namespace isolation. |
| Progression | Replay, retirement, personal objective, unknown historical dates, duplicate events, timezone boundary, correction, and duplicate-identity merge. |
| Wishlist | Distinct review counts, undo, snooze, target currency, stale prices, acquisition on another platform, and unchanged removal exports. |
| Challenges/stats | Small library, overlapping genres, same game in multiple copies, catalog refresh, membership edits, and newly imported ownership. |
| UI | Narrow/mobile layout, keyboard operation, visible focus, dialog behavior, reduced motion, long titles, missing art, and empty states. |
| Build/privacy | Sample build with synthetic private markers present; explicit inclusion of new modules/pages; subpath links; no personal records/assets in public output. |

For each implementation release run `npm test`, `npm run check:share`, `npm run build`, and `git diff --check`, then smoke-test the resulting sample build and a private local configuration using synthetic data. Follow `CONTRIBUTING.md` for commit/release checks. Run `npm run library:verify` only when validating an actual configured import; it is not a prerequisite for a fresh clone.

Use representative synthetic datasets around the existing catalog/library scale. Measure filtering, migration, and backup restore responsiveness before adding optimization. Release notes should explain any migration and backup changes in plain language.

The first complete demonstration should be: migrate existing edits → shortlist a wishlist game → record acquisition → select a copy and add it to Up Next → play/pause/resume → finish a declared objective → view its card → receive one reward → export and restore without changing any result. Include a separate retired game to demonstrate accurate statistics.

**9. Open decisions for the next investigation**

| Decision | Proposed default | When it matters |
| --- | --- | --- |
| Final navigation/name | Add Play Plan; preserve Saved Picks during transition. | Before R1-B UI work. |
| Completion vocabulary | Finished main game, optional mastery, personal objective achieved, and retired. | Before R1-A schema is finalized. |
| Cross-platform replay/reward policy | Implemented: preserve scoped playthroughs; confirmed reward links consolidate first-finish/mastery eligibility. Distinct editions remain separate unless reviewed. | R2-B complete; full history merging deferred. |
| Persistence implementation | Native IndexedDB adapter, with pure domain functions and retained legacy stores during migration. | R1-A technical spike. |
| XP curve and challenge bonuses | Implemented: 100 XP/level by default, configurable 50–1,000; cosmetic unlocks only. Challenge bonuses scale at 15/20/25 XP per accepted cell, once per instance. No purchase/login XP. | R2-B/C defaults implemented; tune with user feedback. |
| Duration provider | Manual estimates initially; evaluate provider/import options separately. | Before automated duration features. |
| Background services | None for releases 1–2. | Before unattended alerts or sync. |
| Social scope | Personal albums and challenges first. | Before any accounts or shared game clubs. |

The next investigation may change priorities or add requirements. Update this document before implementation; keep completed increments and migration guarantees intact. Continue from the implementation checkpoint above after a fresh repository inspection; preserve the completed migration guarantees before adding the XP interface.

**10. Research references**

These are inspiration and feature references, not evidence that a particular mechanic improves completion rates. The preceding conversation reviewed public pages and release notes, plus Backloggery's public demo; authenticated flows were not tested.

- [FinalSave](https://finalsave.app/): backlog selection, weekly quests, levels, and completion cards. [Release notes](https://finalsave.app/updates): recommendations, imports, filters, and status changes.
- [Backloggery demo](https://backloggery.com/demo): backlog breakdowns, priorities, roulette, and endless-game handling.
- [Infinite Backlog](https://infinitebacklog.net/): cross-platform collection and achievement tracking. [Progression redesign](https://medium.com/@infinitebacklog/release-1-11-1-image-uploads-playtime-contributions-revamped-levelling-system-0aa33181d3d7): rewarding finishes more heavily than ownership.
- [Backloggd](https://backloggd.com/): journals, reviews, and progress-tracking lists.
- [Completionator](https://completionator.com/): challenges and optional community bounties.
- [BacklogForge](https://github.com/ajwadtahmid/BacklogForge): weighted selection, duration filters, and Homestretch suggestions.
- [IsThereAnyDeal](https://isthereanydeal.com/) and [GG.deals alert updates](https://forum.gg.deals/d/1951-changelog-oct-23-2025-alert-customization-improvements): purchase-intent and ownership-aware wishlist workflows.
- [RetroAchievements events](https://docs.retroachievements.org/general/events.html) and [progression guidelines](https://docs.retroachievements.org/guidelines/content/progression-and-win-condition-guidelines.html): themed challenges and distinguishing beating a game from additional objectives.
- HowLongToBeat remains a duration-planning research candidate; direct inspection was unavailable in the research session. No API access or integration availability is assumed.
