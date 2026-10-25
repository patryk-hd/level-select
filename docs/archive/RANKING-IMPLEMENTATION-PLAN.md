# Ranking foundations and implementation plan

**Current delivery sequence:** [Next-stage checklist](NEXT-STAGES-CHECKLIST.md).
It requires verified identities and populated Steam, VGC and retro reception
before local MVP acceptance, then integrates those scores into decisions. The
K-stage contracts below remain supporting detail; custom consensus, advanced
personalization and temporal analysis are deferred. Later historical “next”
statements do not override the checklist.

Prepared 2026-09-11, Pacific/Tahiti. Research includes anonymous API checks on 2026-09-12 UTC. Status as of 2026-09-16: K0 bounded VGC coverage pilot/model contract, K1 local score preservation/labeling and K2 provider adapters/caching are implemented. K4 source-specific views are now implemented. K3 consensus and its eventual K4 integration, K5 personalization and optional K6 remain. This plan complements `BACKLOG-IMPLEMENTATION-PLAN.md` and supplies the ranking foundation for its recommendations and retro challenges.

See the [current ranking audit](CURRENT-RANKING.md) for exact existing formulas and ordering behavior, and the [publishing plan](PUBLISHING-IMPLEMENTATION-PLAN.md) for shared data, provider credentials, and community rollout.

**Local-readiness priority revision — 2026-09-16:** Provider adapters and source
views are implemented, but general discovery/matching and broad coverage are not.
Close this K2 coverage gap before K5. The proposed next sequence is coverage and
match review, grouped/preferred-version presentation, then minimal suggestion
integration and local acceptance testing. See the [local test readiness review](LOCAL-TEST-READINESS-PLAN.md)
for version-selection constraints, acceptance gates and deferred scope. This
revision supersedes the earlier “K5 next” checkpoint; it does not claim that
best-version selection or collection-wide provider matching already exists.

**Implementation checkpoint — K4 source modes, 2026-09-16**

K4 follows K2 now; K3 remains gated on verified independent retro evidence.
Implemented a shared source-mode engine, deterministic cohort positions, evidence
and method identifiers, coverage/freshness notices, source attribution and a
standalone [methodology page](../../ranking/methodology.html).

- Wishlist defaults to saved exact Steam conservative approval; raw percentage
  and volume remain separate. Imported Steam ratings are an explicit alternative.
  VGC and optional IGDB modes keep their values separate and unchanged. Cards,
  details, thresholds and genre cutoffs use the selected source; missing evidence
  does not fall back to imports. Genre cutoffs preserve unranked/unreleased games.
- Owned Games adds VGC/IGDB context modes beside separate imported/personal fields.
  Score sorting still requires one matching copy. Legacy maximum-score sorting
  is removed from the normal selector. Imported `steamAppId` can come from a
  name lookup and is deliberately not accepted as a verified copy mapping.
- Catalog and Saved Picks add VGC/IGDB work-context ordering. Source positions
  come from the full catalog record cohort and remain stable under filtering.
  Top 10/30 per-system cutoffs are disabled for work-context modes. The original
  editorial view remains explicitly labeled until a usable system replacement
  exists; its positions never break ties or fill gaps in provider modes.
- Equal values share a position, with deterministic title/ID display order.
  Details expose the named cohort, method, snapshot, evidence IDs and candidate
  set. Cohort IDs are deterministic non-cryptographic fingerprints, not signatures.
  Bookmarks preserve the selected mode but read the latest saved snapshot.

Validated: 142 Node tests, 9 Python tests, 49 isolated Chromium checks (6 new
source-mode checks plus 43 regressions), public build, share and whitespace checks.
Mobile explanations were visually inspected. No provider data was fetched or
personal import rebuilt in this phase. Existing tracking/history and accepted
challenge snapshots remain unchanged.

Next: K5 backlog personalization and pinned source-based lists. K3 and consensus
views still require additional reviewed evidence; no composite or unsupported
platform rankings have been introduced. Complete legacy retirement remains tied
to replacing active recommendation inputs and supplying honest unrated states.

**Earlier checkpoint — K2, 2026-09-16**

Implemented VGC and Steam adapters, optional IGDB adapter, reviewed versioned
crosswalks, deduplicated caches, atomic snapshots, ETag revalidation, persistent
quotas/backoff and last-good fallback. An explicit CLI refresh writes private
local snapshots; pages never contact providers directly. Normalized data omits
reviewer identities, review text and credentials. Public builds contain authored
fictional samples only. Detail panels expose attribution, score scope, dates,
staleness and failures in catalog, owned-copy and wishlist views.

The initial reviewed real seed is Elden Ring: Steam product approval plus VGC
work context for that Steam product and its existing PS5 catalog reference.
VGC's explicit Steam link validates identity, not platform-specific score scope.
There is no automatic propagation to other editions or owned copies. VGC and
IGDB aggregates stay separate work context and cannot enter system rankings.
Live VGC/Steam responses were checked; IGDB uses fictional fixture tests and
requires optional local credentials and reviewed mappings before live use.

K4 source modes/order integration is next. Current K1 sorts remain unchanged;
new provider values are inspectable context until that integration. K3's
independent-evidence/connectivity gates remain unmet. User preference to retire
legacy quality ordering is unchanged, with accepted challenges/history frozen.
See [provider operation and storage](../../ranking/README.md#k2-provider-snapshots).

Validation: 132 Node tests, 9 Python tests and 43 isolated browser checks pass
(7 provider, 7 ranking, 8 wishlist, 13 backlog, 8 challenges). The anonymous live
seed refresh produced three records from two requests, then zero requests on a
cached rerun. Public/private build separation, sharing and whitespace checks
pass. IGDB live validation remains optional and unperformed. Personal imports
were not rebuilt. No commit, push or deployment was made.

**Earlier checkpoint — K0/K1, 2026-09-16**

The [ranking module](../../ranking/README.md) contains the evidence contract, shared
synthetic fixture and reviewed [50-target manifest](../../ranking/pilot-manifest.json).
Fifty anonymous VGC searches plus one preliminary probe were made. Candidate
reviews found 22 unresolved release/score scopes, 18 related other editions/ports,
five empty queries, four unrelated/sequel result sets and one ambiguous catalog
target. No exact-release score was accepted; this is not an exhaustive absence
claim. Direct Steam and IGDB coverage remain K2 work. Independent-family and
comparison-connectivity gates for consensus are not yet met. No numeric provider
scores or approved mappings were published from this audit.

K1 preserves critic/community/personal fields and a checksum per imported copy;
uses the existing provider/ID reference contract; labels old maxima as unspecified
legacy values; and removes artwork from default ordering. Owned score sorts and
filters require one matching copy. Wishlist conservative approval uses Wilson
alone, preserves supplied counts/dates/scope, labels rounded inputs approximate,
and keeps missing values unranked. Genre cutoffs preserve unranked/unreleased
games. Original catalog ranks have explicit legacy aliases; accepted challenges
and tracking IDs stay stable. Personal snapshots are not rebuilt automatically;
reimport the original Playnite CSV to recover dropped score components.

Provider fetching, caches, crosswalks, consensus and learned recommendations are
future work. This includes only the UI needed to explain corrected local fields,
not the full K4 feature set. Next: K2 verified mappings and cached observations,
then K4 source-specific modes. Preserve sample/private isolation and frozen history.

Validation: 117 Node tests and 9 Python tests pass. Thirty-six isolated Chromium
checks pass (7 ranking, 8 wishlist, 13 backlog and 8 challenges), including
desktop/mobile evidence views, URL restoration, copy scoping and preservation
of unranked wishlist entries. Sample build, sharing and whitespace checks pass.
No personal import was rebuilt, and no account, commit, push or deployment was made.

**1. Recommended direction**

Build three clearly labeled views of a game:

| View | Question answered | Intended use |
| --- | --- | --- |
| System consensus | Which releases have the strongest documented reception on this system? | Retro top lists and system exploration. |
| Current reception | What do sources say about this particular version today? | Owned games, PC ports, and purchase research. |
| Play priority | Which eligible game best fits my interests and plans now? | Backlog recommendations and wishlist shortlists. |

Offer VideoGamesCritic (VGC) as an attributed external rating and sort mode. Develop our own ranking from separately sourced evidence. Do not turn the VGC number into a component of our own score or combine its components with their underlying sources.

Preserve the current curated order as a labeled legacy mode. Replace defaults system by system only when the new coverage and evaluation gates pass. A ranking within our current catalog is not a ranking of every game ever released on that system; candidate coverage must be stated and expanded deliberately.

**User preference recorded 2026-09-16 — retirement of legacy rankings.**
Legacy modes are migration aids, not a permanent product destination. Once the
replacement views are ready, remove legacy maximum-score sorting and the old
wishlist heuristic from normal UI, and retire original editorial ranks from
active quality lists/recommendation tie-breaks. Retain original data only for
backward-compatible imports, provenance and already accepted challenge history.
Prefer an attributed VGC current-reception mode where the game/edition and score
scope are verified. Other source-specific modes and independently supported retro
consensus can cover different needs; do not interleave unlike scores into a
single unlabeled ranking. Missing replacement evidence means unranked, with the
game still browsable and playable, rather than a silent fallback to legacy.
Incomplete provider coverage need not keep legacy scoring permanently visible.
VGC is a preferred source, not a guarantee of objective accuracy or exact-platform
coverage. Personal ratings and play priority remain separate from reception.

**2. What to learn from VGC**

VGC describes a player-led Bayesian blend, review-level weighting, source calibration, patch-based windows, confidence indicators, and platform-specific treatment. Its player evidence constrains the critic contribution; its prior is 72 with 50 pseudo-reviews. It downweights short-playtime and certain acquisition categories, limits elite scores by audience size, and grades reviewers against player agreement. [Published methodology](https://videogamescritic.com/methodology)

Our assessment:

- Publish evidence, scope, timestamps, and calculation versions. A user should be able to explain why one game ranks above another.
- Statistical shrinkage is useful for noisy small samples. It does not remove selection bias or make a chosen weighting objective.
- A fixed playtime threshold can disadvantage short games and legitimate reports of immediate technical failure. Acquisition route does not establish whether a review is accurate.
- Audience-size ceilings disadvantage niche and older releases. Use volume to describe uncertainty, not as a popularity reward or an artistic ceiling.
- Historical reception and current technical condition answer different questions. An old review of an unchanged release should not become irrelevant simply with age.
- Disagreement is informative. Retain conflicting sources visibly rather than declaring criticism invalid because another audience disagrees.
- Agreement with a population measures agreement, not a reviewer's honesty. Any future reviewer feature should be named accordingly.

An exact independent clone is not the recommended path. The page describes policies but does not supply a complete executable specification and all calibration parameters. Reproduction would also need equivalent upstream data, deduplication, and time windows. Implement an explicitly documented method of our own where needed; use their API when displaying their result.

**3. VGC API: documented access and verified behavior**

The official API documents anonymous access at 60 requests/hour/address, a free key at 5,000/day, ETags, conditional requests, and open CORS. Public endpoints include:

```text
GET /api/v1/game/{id}
GET /api/v1/game/{id}/history?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/games?sort=score&limit=100&offset=0
GET /api/v1/search?q=...&limit=25
```

Bulk discovery covers scored, notable games; it is not a complete release catalog. The published routes do not document a platform-score selector. [API documentation](https://videogamescritic.com/developers)

Display the supplied attribution with a game-page link, keep the VGC name, cache responses, and do not resell the data. The citation page additionally says not to average its score into another rating. We will keep VGC outside our own aggregation and seek clarification before any different use. [API terms](https://videogamescritic.com/developers#terms), [citation terms](https://videogamescritic.com/cite)

Three anonymous GETs returned HTTP 200 during this investigation. No account/key was created. These were spot checks, not a coverage audit:

| Request | Observation | Implementation consequence |
| --- | --- | --- |
| `/api/v1/game/elden-ring` | Returned scores, source timestamp, history-related fields, links, ETag, caching headers, and remaining quota. `platforms` used broad family labels. | Integration is technically viable. A platform list does not establish the scope of the score. |
| `/api/v1/search?q=Chrono%20Trigger&limit=3` | Returned a 2018 Steam/PC record, ID `613830`, rather than a separately identified original SNES release. | Do not apply the PC result to the SNES top list. This does not prove no other record exists. |
| `/api/v1/search?q=Super%20Mario%20World&limit=3` | Reported five matches but returned three; results included the GBA adaptation and two same-name Yoshi's Island records with null scores. | Search results need edition validation; limited search is not exhaustive; duplicates and missing ratings are normal cases. |

The two search responses used a numeric/null `scores.gap`; the detail response used an object. One search result had `trend: unknown`; others were null. Some artwork URLs were relative. VGC IDs are provider IDs: do not assume every numeric ID is a Steam app ID. Preserve a verified Steam link separately.

The detail payload's launch field was a player score, and its patch field represented player reception. Do not label either as historical headline VGC without the appropriate field. Treat response types separately, tolerate new fields, and validate optional fields. API/provider confidence remains provider-defined; it is not a confidence interval computed by our app.

**4. Original audit findings (K1 corrections described above)**

| Finding in our code | Why it matters | Planned change |
| --- | --- | --- |
| `scripts/build-catalog.mjs` preserves the original editorial order after cleanup. | The lists have no item-level provenance or reproducible consensus. | Retain `legacyRank`; attach evidence and compute separate, versioned rankings. |
| `library/tools/build_site.py` takes the maximum of personal, critic, and community scores, then the maximum across copies. | A personal 100 can overshadow a critic 70; another port's better rating can be applied to the selected copy. | Preserve separate observations and score scope; remove maximum-based quality sorting. |
| The generated per-copy projection retains `bestScore` but drops the individual score fields. | Existing built snapshots cannot recover the source components. | Rebuild from an available original export; otherwise label the old value as an unspecified legacy score. Never invent its source. |
| `library/tools/steam_meta.py` computes `0.7 * WilsonLowerBound + 0.3 * popularity`. | Confidence adjustment and popularity both influence ordering. | Make approval/confidence ranking and popularity separate modes. |
| `library/app.js` default ordering prioritizes cover presence before score. | Artwork availability can masquerade as game merit. | Keep artwork out of every ranking calculation. |
| Different views have independent ranking logic and labels. | The same game appears to have incompatible meanings of “score.” | Use a shared ranking contract, with named modes and explicit evidence scope. |

A direct calculation with the current helper illustrates the popularity effect: 95% positive from 1,000 reviews produces a Wilson bound of 0.9347 and current pick score of 0.8045; 90% from 100,000 produces a lower Wilson bound of 0.8981 but a higher pick score of 0.8787. This is a deliberate popularity preference in the existing formula, not a confidence correction alone. These are synthetic inputs, not ratings of real games.

**5. Source strategy**

| Source | Proposed role | Access/limitations established in research |
| --- | --- | --- |
| VGC | Optional branded current-reception view, gap, trend, history. | Documented API and successful anonymous checks; keep outside our own blend. Retro and exact-platform coverage need an audit. |
| Steam | Direct player approval and, later, time-window evidence for the mapped PC product. | Official review endpoint provides positive/negative totals, review IDs, timestamps, acquisition flags, and playtime. [Steamworks](https://partner.steamgames.com/doc/store/getreviews) |
| IGDB | Persistent identity, platforms/releases, edition relationships, and separately labeled user/critic ratings. | API exposes `rating`/`rating_count` and `aggregated_rating`/`aggregated_rating_count`, plus release/port relationships; authentication and rate limits apply. [IGDB documentation](https://api-docs.igdb.com/) |
| MobyGames | Candidate for historical releases, original-platform metadata, and reception evidence. | Official documentation describes subscribed API access; exact usable rating fields and permitted redistribution need verification before selection. [API documentation](https://www.mobygames.com/info/api/) |
| OpenCritic | Candidate for directly licensed critic evidence, especially newer releases. | A provider-branded RapidAPI listing exists; quotas, field/platform scope, and reuse permissions remain to be verified. No authenticated call was made. [API listing](https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api/details) |
| Platform-specific community lists | Additional evidence for retro lists and candidate discovery. | Nintendo Life's system rankings are dynamic community rankings, not independent editorial votes. Record dates and rating thresholds. [System-list hub](https://www.nintendolife.com/guides/the-top-50-games-on-every-nintendo-system) |
| Contemporary and retrospective reviews/lists | Historical critic evidence and contextual recommendations. | Add citations and verified release scope. Record whether an item is a review, ranked list, or unranked selection. Do not assume bulk ingestion rights from public availability. |
| Existing Playnite fields | User's personal rating and imported source observations. | Preserve as labeled imports; missing origin/count/version prevents treating an aggregate as a fresh independent review pool. |

Metacritic, Backloggd, and console-store ratings can be useful displayed references, but this investigation did not verify direct licensed API access for our use. Do not base the first release on unofficial wrappers or scraping them.

Register source lineage: an aggregator and the reviews it summarizes are overlapping evidence. A site's top list and the same site's community ratings are one audience, not two votes. Publisher siblings, syndicated reviews, and updated copies of a list must be grouped or excluded from duplicate counting. VGC-derived component scores remain VGC data, not a shortcut to independent Steam/OpenCritic inputs.

A practical warning: Time Extension explicitly describes its Genesis RPG selection as unordered. Extracting display order as rank would invent evidence. Store it as an endorsement only. [Example source](https://www.timeextension.com/guides/best-genesis-mega-drive-rpgs-and-action-adventures-of-all-time)

**6. Evidence and identity contract**

Share durable identities with backlog plan R1-A. This work does not require playthroughs or XP to be built first. Add provider mappings as a shared module rather than building a second competing identity system.

Every evidence observation needs:

- Stable observation ID, provider/source-family ID, upstream ID or URL, and type: numeric review, binary approval, aggregate, ranked list, unranked endorsement, personal rating, or external composite.
- Target work, edition, platform release, region, and build/time window where known; explicit unknowns and a reviewed mapping confidence.
- Original value/scale, numerator and denominator where available, counts with their meaning, and any source-supplied exclusion or eligibility policy.
- Published time, observed time, source update time, and window boundaries. An original release date differs from a later port/store date.
- Attribution, access/reuse policy, source-lineage dependencies, extraction method, and review status.
- Raw-response checksum or fixture reference, adapter version, and corrections/superseded-observation links.

Generated ranking records should contain `targetId`, `scope`, `mode`, `methodVersion`, `snapshotId`, `candidateSetId`, rank, rank-stability band when supportable, evidence IDs, source-family count, coverage status, freshness, and exclusion reasons. Source ratings retain their original labels and units. Missing is null, never zero.

A title group is a browsing convenience. When a platform or owned copy is selected, choose only evidence for that release. Work-wide evidence may be shown as contextual information but cannot silently qualify a release for a platform-specific rank. For mixed-copy groups, show platform-specific values or ask the user to select the intended copy; do not choose the largest one.

Provider snapshots and ranking outputs should be reproducible without storing personal collection membership. Personal preferences and library crosswalk overrides stay in local ignored data and the personal backup. Shared public crosswalks contain only verified public catalog facts.

**7. Ranking method to implement**

Start with transparent source-specific rankings, then introduce a validated consensus mode. Different input scales must not be averaged merely because they can all be printed between 0 and 100.

**7a. Player approval baseline**

For Steam data, retain exact positive count `k`, negative count, total `n`, and query scope. Display `k/n` as approval and use the existing Wilson lower-bound formula for an explicitly named conservative approval sort. Remove the independent popularity bonus from this mode. Unknown data stays unranked.

Fetch consistent language/purchase/off-topic settings. A review query's totals describe its population, not necessarily all Steam reviewers. A paginated response count is not the lifetime sample size. Deduplicate by review ID if ingesting individual records. Steam's helpfulness filter and `day_range` must not be mistaken for a complete date-restricted review sample; use timestamp filtering over an appropriately paginated dataset for future trend calculations. [Endpoint semantics](https://partner.steamgames.com/doc/store/getreviews)

Wilson addresses binomial sampling uncertainty under assumptions; it does not certify representative players or unbiased reviews. Keep raw approval, counts, and exclusions visible. Do not call the result a critic-quality score.

For numerical user ratings, do not reinterpret the mean as a count of approvals. An optional source-specific shrinkage model is `adjusted = (n * mean + m * sourcePrior) / (n + m)`, with prior and strength fixed from a documented reference cohort, not the current filtered list. If variance/underlying ratings are unavailable, display a coverage label rather than an invented 95% interval. Hyperparameters remain provisional until the pilot.

**7b. Critic reception baseline**

Prefer directly scoped, identified review observations. Preserve the printed score and scale; a five-star rating can be rescaled for display, but that alone does not prove equivalence to another outlet's scale. Binary recommendations remain binary. Unscored reviews remain linked evidence and are never assigned an inferred numeric score.

Where only an aggregate is available, use one aggregate per overlapping critic population. Display provider, count, platform, and period. Do not average several aggregators that cover the same outlets. Personal ratings and legacy values without provenance cannot enter this lane.

**7c. System consensus pilot**

Recommended candidate: aggregate ordinal comparisons within a verified platform-release cohort. This avoids claiming that Steam approval, a magazine's stars, and a retrospective rank are measurements on one cardinal scale.

Prototype a regularized pairwise logistic ranking. Each usable source contributes comparisons only between games it actually evaluates: for games i and j, model the probability of i ranking ahead as `sigmoid(theta_i - theta_j)`. Fit the latent values against the observed ordering with a fixed quadratic regularizer. This is a proposed ranking model, not a clone of VGC.

For each independent source family f, normalize its total comparison weight to its assigned weight `a_f`: each of its P usable pairs has weight `a_f / P`. Use a half-win for an explicit tie. This bounds the influence of long lists and prevents one provider's number of entries from becoming its voting power. A newer edition of the same list replaces its active predecessor; old editions remain archived history.

Begin with equal weight per independent source family; do not weight sources by agreement with the ranking being produced. Keep source-type filters visible, and compare critic-only, community-only, and mixed runs. The chosen weights are product policy, not measured universal truth.

Important input rules:

- A truncated top-10 list does not establish that every unlisted game is worse. Use co-listed order only unless the source explicitly defines and evaluates the full comparison universe.
- Unranked selections contribute endorsement/coverage information, not fabricated pairwise order.
- A community list and its underlying rating table cannot both supply pairs.
- Frozen sample-size treatment occurs before deriving a source's comparisons; tiny numerical polls remain provisional.
- Disconnected comparison groups cannot support one precise global ranking. Regularization must not hide this; retain separate provisional groups or source-specific ordering.
- With one independent source, show that source's order. Provisional starting eligibility for consensus is three usable independent families, with direct evidence from at least two for a listed game; validate feasibility during the pilot.
- Display rank and evidence breadth, not a fabricated 0–100 quality score. Nearby ranks should show approximate groups if source resampling is unstable.

Compare this candidate with legacy ordering and a simple source-rank baseline on the same cohort. Use leave-one-source-family-out evaluation, weight perturbations, and source-family resampling. These test consistency and robustness, not objective quality. A resampling range is ranking stability, not a confidence interval over all possible players. Promote the method only if results can be explained without special-case bonuses for familiar favorites.

If available sources are too sparse, the deliverable is a better-cited curated list with coverage labels. Do not fill gaps with PC-port ratings to force a consensus number.

**7d. Current reception and VGC view**

Add an optional “VGC Score” sort/filter over compatible mapped records, displaying the score unchanged and attributed. User filters can narrow candidates; avoid combining that numeric score into a weighted personal score. If evidence applies to another version, label it contextually and exclude it from the selected system's consensus calculation.

Maintain current-version and historical-reception views independently. Later trend work should compare disjoint, sufficiently populated time windows and annotate verified changes. Never count recent reviews once as current evidence and again as independent lifetime evidence without accounting for overlap. A patched game's current reception can change while an archived historical list remains fixed.

Early Access and unreleased products should not silently compete in a final-release historical list. Show available provisional signals separately; retain earlier observations when 1.0 arrives, with their period labels.

**8. Recommendations, wishlist, and UI behavior**

Use the same named ranking modes on Recommendations, Owned Games, and Wishlist. Game details should show “Why this rank?” with source links, version/platform scope, counts, snapshot date, and calculation version. Show critic/player disagreement rather than collapsing it into a mysterious average.

For owned-game recommendations, apply eligibility first: accessible copy, selected platform, play status, hidden/retired preferences, and time constraints when known. Then honor manual Up Next order and priority. Automatic suggestions can use independently sourced reception, user taste, and variety. Explain the resulting choice; cold-start users get explicit interests and curated suggestions until personal history is sufficient.

Personalization is a separate, local ordering. A personal rating can influence future suggestions but never changes public reception or system consensus. Price, discount, ownership, backlog age, and cover presence do not alter a quality ranking. Offer price-aware wishlist sorting independently.

Within a system, preserve the full-cohort rank when the user filters to owned games: “#8 on SNES, 3rd among your matching games” describes two different positions. Never silently reassign global system rank after a search or ownership filter. A cross-system comparison is unsupported by independently fitted system rank numbers; offer grouped system results or a genuinely shared source-specific comparison instead.

Add bookmarkable parameters such as `ranking=system-consensus-v1` and optional `snapshot=...`. Legacy URLs keep their current interpretation. Top-10/top-30 filters apply to the chosen ranking mode and verified system cohort. Accepted backlog challenges pin their ranking snapshot and membership so refreshes do not change an active objective.

**9. Technical delivery plan**

| Increment | Deliverable and likely files | Dependencies | Acceptance gate |
| --- | --- | --- | --- |
| K0: coverage and model specification | A synthetic contract fixture plus a reviewed pilot manifest spanning roughly 50 releases across NES/SNES, Mega Drive, PS1, classic PC, and modern PC. Record source scope, mapping errors, coverage, access terms, and comparison connectivity. | None; extend the three completed API spot checks. | Exact-release coverage is measured separately from work/title coverage. Wrong or uncertain matches are rejected. Limits and missing sources are documented. |
| K1: preserve and label evidence | Extend `library/tools/build_site.py`; update `library/app.js`, `library/wishlist.js`, and `library/tools/steam_meta.py`; add shared evidence/ranking types and tests. Preserve legacy catalog rank and imported score fields. | K0 schema agreement; coordinate identity contracts with backlog R1-A. | Personal rating 100 cannot overwrite critic 70; a better port's value cannot become the selected copy's score; no artwork/popularity bonus in quality modes. |
| K2: source adapters and caching | New `scripts/enrich-ratings.mjs` and provider adapters under a suggested `ranking/providers/`; versioned catalog crosswalk; VGC, Steam, and IGDB first. | K1. | Scoped mapping, schema validation, attribution, ETag, quota backoff, cache fallback, and source freshness work. A source failure preserves the last good snapshot. |
| K3: retro evidence and consensus pilot | Source registry, reviewed observations, candidate expansion, and `scripts/build-rankings.mjs`; pure model code under `ranking/`. | K0–K2; legally usable independent retro evidence. | Deterministic rankings reproduce from frozen observations; no duplicate families, invented ranks, disconnected global order, or transferred port scores. Coverage gates pass per system. |
| K4: integrate views and explanations | `app.js`, `lib.js`, library views, shared detail components, URL state, navigation/build manifests, sample data, and a methodology page. | K1/K2 for source modes; K3 for consensus. | Same target/mode/snapshot gives the same rank everywhere; filters preserve system rank; missing data and stale sources remain clear. |
| K5: backlog personalization and pinned lists | Connect to backlog R1-B/R2-C; preserve personal priorities and freeze challenge snapshots. | K4 plus the relevant backlog features. | Preferences affect suggestions only; active challenges remain stable; updates do not erase play history. |
| K6: optional temporal analysis | Historical score snapshots, meaningful movement annotations, original-versus-port comparisons, and a measured calibration experiment if a future cardinal score is wanted. | Stable source history and sufficient data. | No invented pre-tracking history, overlapping-sample inflation, unverified patch resets, or causal claims from coincident changes. |

K1 and source-specific K2/K4 can deliver useful improvements before retro consensus is ready. K3's work is substantially data curation and evaluation, not just formula implementation. Do not make a full-framework rewrite, new accounts, or a hosted backend a prerequisite.

**10. Caching, operation, and public builds**

Fetch during an explicit enrichment command and serve normalized snapshots locally. Avoid making every browser page view query every provider. Persist validators and provider-specific freshness; apply conditional requests and backoff on throttling. Keep each provider optional, so a missing key or service outage does not prevent browsing.

Bulk responses are useful for discovery, but a filtered “notable” feed cannot measure catalog completeness or replace verified lookup. Prefer stable mapped IDs, cache searches, and review ambiguous search candidates. Preserve a bounded negative-result cache with retry dates.

Start with on-demand enrichment of selected games. Expand to daily refreshes for active, current titles and less frequent checks for stable historical evidence after observing quotas and source behavior. Refresh schedules are proposals, not guarantees of provider update frequency. Keep secret keys outside served files, repository data, logs, and backups; support anonymous VGC evaluation without exposing a shared key in client JavaScript.

Persist method version, source observation IDs, input hashes, cohort version, and build time together. A rebuild without changed inputs must not change ranks. Distinguish a new source observation from a scoring-method update; a method change is not evidence that a game improved.

Only public, redistributable evidence may enter a public artifact. Personal ratings, membership, notes, provider credentials, and personal snapshots remain private. Initial shareable demos use authored synthetic fixtures. Real public-data exports need their attribution and provider policy attached. Update the explicit file allowlists in `scripts/build.mjs` and `scripts/serve.mjs`; preserve all existing sample/private isolation tests.

**11. Validation and release gates**

- Identity fixtures: original and remaster, late PC port, two console generations, regional versions, anthology versus contained game, DLC, same-name unrelated games, missing platforms, duplicate provider records, and broad platform-family labels.
- Score fixtures: zero versus missing, personal/critic/community separation, unknown legacy provenance, null confidence, unknown trend, differing search/detail schemas, and source timestamps.
- Statistical fixtures: tiny perfect sample, large imperfect sample, overlapping aggregates, correlated source families, changed list depth, tied scores, unranked selections, disconnected comparisons, and unchanged inputs.
- Behavior fixtures: selecting an owned copy changes evidence scope; filters do not change system rank; price/cover changes do not change merit order; new imports do not affect global ranks; a new scoring version does not reset a pinned challenge.
- Failure fixtures: 429/5xx/timeouts, missing keys, malformed JSON, 304 reuse, stale cache, partial enrichment failure, and provider disappearance. Prefer atomic snapshot replacement.
- Browser checks: readable provenance on mobile, keyboard-accessible sorting and detail panels, stable bookmarked URLs, missing-data states, and clear source-mode labels.
- Data checks: review all crosswalks used in pilot top results; record candidate coverage and source diversity. Broader rollout requires no known unresolved identity error in ranked entries and explicit treatment of unrated releases.

Use existing `node --test` for pure logic and synthetic adapters. Run `npm test`, `npm run check:share`, `npm run build`, and `git diff --check` for implementation increments, then smoke-test the generated sample build. External provider calls should be an opt-in integration check with a small quota budget, never a mandatory live dependency of CI.

Evaluate changes against multiple source families held out in turn and against explicit user preference feedback where relevant. Do not judge correctness by whether a few favorite classics rise to the top. Inspect failures by platform, era, genre, audience size, and availability of reviews. Show rank stability rather than false precision.

**12. Decisions recorded for later work**

| Topic | Recommended default |
| --- | --- |
| Reuse VGC? | Yes, as a labeled external score through its documented API. |
| Clone VGC exactly? | No; use its transparency as inspiration and design/test a separate model appropriate to our data. |
| Average VGC into our own score? | No; its published citation terms expressly prohibit this. |
| First practical improvement | Eliminate maximum-based scoring and separate personal, critic, community, and popularity signals. |
| Retro default | Preserve legacy mode while building cited, platform-scoped consensus with explicit coverage. |
| Universal 0–100 score | Defer. Start with named source ratings and system-relative ranks. |
| Source weighting | Equal independent source-family weights for the consensus pilot; publish and sensitivity-test the choice. |
| Missing platform evidence | Unranked/provisional for that release; show other-version evidence only as labeled context. |
| Reviewer trust, transcript scoring, studio/revenue rankings | Outside this plan's initial scope; not needed to improve game lists. |
| Dependencies on backlog work | Shared identity first; personalized ordering and pinned challenges integrate afterward. Source-backed ranking can ship independently. |

Before implementation, refresh provider documentation and inspect current project state. Start with K0 and K1. Open a separate access decision only if a required provider needs an account/subscription or permissions not already available; the initial local corrections and anonymous VGC pilot do not depend on that decision.
