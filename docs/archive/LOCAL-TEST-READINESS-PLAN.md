# Local test readiness and scope review

**Current sequence:** follow [the next-stage checklist](NEXT-STAGES-CHECKLIST.md).
The user made populated Steam/VGC/retro scores a core MVP requirement. This earlier
review remains technical background for matching, coverage and copy selection;
its three-increment sequence is superseded. The September 25 scope freeze also
supersedes optional feature proposals below:
preferred-copy pinning, automatic best-version scoring and custom consensus are
deferred. Keep the existing explicit copy chooser for the trial.

Prepared 2026-09-16 after inspecting the implementation and provider documentation.
This is a proposed sequencing/product revision for the local app, not an assertion
that matching, version selection or coverage expansion has been implemented.
Public release and community work remain deferred.

## Assessment

Backlog R1/R2 functionality is implemented. K0/K1 evidence corrections, K2 source
adapters/cache and K4 source-specific views are implemented and tested. However,
K2 does not yet include a general provider discovery/matching workflow or broad
data population. Adapter readiness and collection coverage must be tracked
separately. Calling K2 complete without that distinction overstated local readiness.

The checked-in real seed covers one VGC game and one Steam product; IGDB has no
real seed. That was also the local coverage at the September 16 review. Current
delivery evidence is recorded in the next-stage checklist. Private collection
counts and membership are intentionally omitted from this document.
The public catalog has 4,551 records, so the seed cannot validate general ranking
usefulness. Existing passing tests primarily establish correctness under authored
fixtures, not matching accuracy across a real collection.

**Next work: close the K2 matching/coverage gap and finish the necessary K4
presentation, before K5 personalization.** K3 is independent-source retro consensus,
not the phase that matches the library to VGC/IGDB/Steam.

## Matching and version selection are separate operations

First establish identity and score scope. Multiple search candidates can be a
sequel, DLC, bundle, remake, port, original release or spelling variant. A high
score never resolves this ambiguity. Only after identity is established may
multiple verified releases compete to represent one grouped game card.

Keep lightweight, explicit relationships between the underlying game, distinct
edition, platform release/store product and owned copy. Reuse existing stable
references and reviewed links. Do not rename tracking IDs, merge histories or
join progress records just because provider metadata links two records.
Remakes/remasters remain distinct editions with optional related-edition links;
do not silently replace an original with a later edition.

### Proposed matching workflow

1. Inventory owned copies, wishlist products and catalog entries. Reuse confirmed
   identities and deduplicate provider requests across those views.
2. Prefer trusted external IDs and explicit provider/store links. Wishlist Steam
   app IDs are usable directly. Current imported owned `steamAppId` may originate
   from a name lookup and is not automatically a verified store identity.
3. Discover VGC candidates through supported lookup/search/bulk endpoints, and
   IGDB candidates through external IDs, names and edition relationships. Compare
   title/aliases, edition, product type, developer and release/platform metadata;
   store the reasons and limitations. Title similarity only proposes a match.
4. Auto-accept only deterministic, corroborated identity matches under tested
   rules. Record rule/version/evidence; do not turn metadata agreement into proof
   that an aggregate score belongs to an individual platform.
5. Put ambiguous/conflicting cases in one small review queue. Allow accept,
   reject and leave unresolved. Retain rejected candidates and manual overrides
   across imports and refreshes; unrelated data changes must not reset decisions.
6. Fetch accepted records through existing adapters and cache. Add a resumable
   job/cursor that completes initial coverage before refreshing already-covered
   records repeatedly. Show progress, pending work and provider-specific retry
   dates. No full scan on every page load.
7. Report per-provider states: matched/rated, matched/no score, needs review,
   searched/no match, not applicable, credentials required, failed/retry pending,
   not processed. A completed pass accounts for all requested records; it does
   not promise every provider has every game.

Prioritize the current wishlist and owned library, then the catalog. All records
should eventually be assessed, but a hand-reviewed slice spanning platforms,
editions and ambiguous titles should validate the rules before a large run.
Back up reviewed private mappings independently of Git and preserve them through
refresh/import cycles. Provider keys remain outside snapshots and backups.

## One card and a preferred version

Proposed default: one card per verified game/edition group with a clearly labeled
representative version. All verified alternatives are visible in details.
Use “highest rated among comparable versions” only when evidence establishes it;
otherwise say “preferred version” or “version comparison unavailable.”

| Context | Eligible versions and behavior |
| --- | --- |
| Owned Games / Play Plan | Owned, accessible copies satisfying selected platform/store filters. Honor a user's pinned copy; otherwise choose the highest-rated eligible comparable copy. Never make an unowned PC copy the implicit play action. |
| General discovery | Versions on the user's selected/available platforms; permit broader discovery only explicitly. Label the selected platform and edition. |
| Steam wishlist | Preserve the actual wishlisted Steam product. Show related console versions in details without silently changing the purchase target. |
| Platform-specific list | Use that platform release. A better-rated port cannot replace it. |
| Work-level provider data only | Display VGC/IGDB context for the game, without inventing a platform winner. Choose a display copy by explicit preference/availability, not a fictional platform rating. |

Selection must compare the same source/method and compatible score scope, using
available evidence breadth and freshness. Steam's existing conservative approval
is appropriate for comparing approval populations; raw tiny-sample percentages
should not automatically win. Numerical critic means are not approval counts.
Do not take the maximum of VGC, Steam, IGDB critics, IGDB users and personal scores.
When sources disagree, show the disagreement rather than manufacture a universal
best-version score. Rating leadership is not proof of better performance or fewer
bugs. No performance benchmark subsystem is required for the local milestone.

The existing implementation intentionally leaves ambiguous multi-copy groups
unranked. Preferred-version grouping is a product change from that behavior,
while preserving the underlying copy-specific evidence and progress.

## Shared scores across views

Wishlist, Owned Games and Recommendations should consume the same verified
evidence for the same identity. On a card, show a compact primary score with its
source plus available secondary source badges, and a selected-version badge.
One ordering control selects which source determines reception order; do not
introduce blended scores or a separate weighting panel. Additional counts,
dates, matching provenance and technical details belong in the detail view.

Current Wishlist already supports saved Steam, VGC, IGDB and explicit imported
ratings. Catalog and Owned Games have VGC/IGDB context modes. Steam transfer into
those views needs verified product relationships; the current crosswalk/runtime
deliberately restrict Steam approval to exact Steam targets. Extend that identity
resolution without copying a PC product's score onto a console release.

Recommendations has two meanings: catalog reception ordering already has source
modes; personal Play Plan suggestions do not yet use provider evidence. Add a
small, explainable reception tie-break after eligibility, manual Up Next order,
priority and chosen copy. Do not start learned taste modeling for this milestone.
Retire editorial rank tie-breaks when this path has a neutral unrated fallback.
Accepted challenges retain their frozen membership and historical ranks.

## Bounded path to local acceptance

| Increment | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1. Coverage pipeline (largest remaining step) | Provider discovery, reviewed links, IGDB live setup/validation, bounded resumable refresh and a simple matching queue/report. | Every record in the requested pass has an explicit state; trusted matches are sampled for errors; ambiguous editions stay unresolved; retries resume without destroying decisions or data. |
| 2. Grouped score presentation | One game/edition card, labeled preferred version, comparable-version selection where supported, shared source badges and verified Steam links across views. | Same product shows the same source value everywhere; selected platform/owned-copy rules hold; wishlist actions preserve their product; no unsupported platform winner; alternatives are in details. |
| 3. Local acceptance and simplification | Minimal provider-aware Play Plan ordering, import/refresh/mapping preservation checks, backup/restore rehearsal, UX reduction and fixes. | Browse, compare, wishlist, acquire, queue, play, finish, refresh, restart and restore with real data; no lost notes/history; explain results without consulting methodology for routine use. |

This is several substantive increments plus test/fix cycles, not one cosmetic
pass. Avoid a numeric completion percentage until matching quality and actual
provider coverage are measured. Provider waits and user review may dominate
elapsed time. IGDB live coverage remains unknown until configured and exercised.

Local completion does not require 100% provider ratings. It requires complete
accounting, useful observed coverage for the user's actual tasks, understandable
exceptions and reliable end-to-end workflows. Decide whether platform-comparison
coverage is sufficient before promising a best-version feature; if it is not,
ship preferred-version selection with honest unavailable comparisons.

## Scope control and user testing

Freeze the local milestone to the three increments above. Defer accounts,
hosting, community, cloud sync, background price alerts, additional gamification,
learned recommendations, elaborate pinned lists, temporal analytics and custom
retro consensus. K3 may be valuable later but is not necessary to test the app.

Core visible flows: browse library, inspect reception/versions, decide what to
buy or keep, choose what to play, record progress, update data and recover backups.
Keep XP, challenges, seasons, roulette and comparison/review tools optional or
secondary. Avoid showing every provider mode and every advanced filter at once.
Keep source labels visible even when technical provenance is collapsed.

During testing, log task completion and concrete friction: inability to find the
right copy, unclear score, excessive steps, distracting controls, wrong matches
and surprising recommendations. First simplify labels/defaults or hide optional
controls; remove low-value features after repeated evidence. Feature removal
must retain/export existing history and include migration handling, not delete
user data. Do not remove backup, undo, match correction or source clarity merely
to reduce the visible control count.

## Provider evidence checked

- [VGC API](https://videogamescritic.com/developers): lookup/search/bulk endpoints,
  attribution and quotas. Its documented example has one score object with broad
  platform labels, not PC/PS5/Switch score rows. Current adapters cannot derive
  a platform winner from that response. Anonymous access is 60 calls/hour;
  batch/resume and request reuse are necessary at collection scale.
- [IGDB API](https://api-docs.igdb.com/): external service IDs, separate user/critic
  aggregates, and edition relationships support identity discovery. Those game
  fields alone do not establish platform-specific rating populations. The local
  adapter currently performs lookup by an already reviewed ID; discovery and
  live credential validation remain to implement.
- [Steam reviews](https://partner.steamgames.com/doc/store/getreviews): query
  summary approval counts belong to a Steam app product and its query settings;
  they are not console-release ratings.

No new accounts, provider scans, application behavior changes, commits or pushes
were performed for this analysis.
