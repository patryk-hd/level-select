# How rankings work today

Updated 2026-09-16 after K0–K2 and K4 source modes. The original audit is retained below as historical
context; the following behavior supersedes its old score calculations.

**Current behavior**

- The explicitly labeled legacy catalog view keeps original editorial positions.
  VGC and IGDB sorts instead order verified mapped records by that source, with
  work-context labels and no editorial fallback. Their full-catalog positions
  survive search/ownership/system filters. System top-N filters are disabled for
  work-level scores. No global consensus or verified system reception is claimed.
- New Playnite imports retain critic, community and personal fields separately
  per copy. **Rating field** controls the minimum threshold and **Selected
  rating: highest first** sort. Platform/store filters must identify one copy;
  multi-copy groups stay unranked until narrowed. VGC/IGDB source modes use reviewed
  copy mappings only. Details show the selected copy, source, scope and position.
- The imported fields have unknown upstream rating provider, count and date.
  Personal Playnite ratings are distinct from 0–5 playthrough ratings. Old
  maximum-only values are labeled **Legacy score**; reimport the original CSV
  to recover the separate components. `bestScore` remains compatibility data;
  legacy maximum sorting is no longer offered in the normal selector.
- Owned Games defaults to title order. Artwork never affects a reception sort.
- Wishlist defaults to **Saved Steam ratings**, using exact-count Wilson approval
  with z=1.96 and no popularity bonus. Raw percentage and review volume have separate sorts;
  full-precision ties use title. Price, artwork and personal interests do not
  affect reception. **Imported Steam ratings** is an explicit alternative, with
  approximate calculation when exact counts are missing. VGC and IGDB are separate
  modes; no source substitutes for a missing selected-source rating.
- Exact positive/negative counts, query settings and observation dates are
  retained when supplied. Missing evidence remains unranked and missing dates
  stay unknown. Old zero percentages are ambiguous because the prior importer
  coerced unknowns to zero; new explicit zeros remain valid. The mean statistic
  excludes unknown percentages and is not a pooled review sample.
- **Top by genre** ranks released entries using the selected rating source
  (conservative approval when Steam is selected). Unreleased/unranked entries remain available in
  grid/list and are preserved by its optional removal cutoff. Imported
  Metacritic values are context with unverified scope, not ranking inputs.
- Play Plan suggestions still honor eligibility, manual queue order, intent,
  priority/favorites and editorial rank within one selected system. Accepted
  challenges keep their frozen membership and ranks. Learned recommendations,
  source-based Play Plan integration and retro consensus remain future work.
- K2 adds attributed provider detail panels for reviewed references: exact Steam
  approval counts, VGC score/components and optional IGDB aggregates. These read
  local snapshots refreshed explicitly with `npm run ratings:refresh`. Cache
  age, failed refreshes, dates and scope are visible. VGC/IGDB work context does
  not establish a platform-specific ranking. The initial real mapping coverage
  is the Elden Ring seed; owned copies require reviewed additions.
- Source-mode card values, ordering, thresholds and explanations share the same
  evidence snapshot. Positions use the complete named cohort, equal values share
  a position, and title/stable ID order ties. Missing coverage remains visible;
  stale/failed refreshes retain the last accepted evidence with labels. Details
  expose the method, source link, scope, counts, snapshot and candidate-set IDs.
  These browser views do not change frozen challenge membership or Play Plan rules.

See the [evidence contract and coverage audit](../../ranking/README.md) and
[implementation checkpoint](RANKING-IMPLEMENTATION-PLAN.md). Existing personal
snapshots are not rebuilt automatically. Tracking IDs and history are unchanged.

**Historical audit — behavior before K1 (2026-09-11)**

**1. Recommendations, system lists, and Saved Picks**

The original eight HTML pages contained 4,737 entries across 50 system/category lists. Migration retained 4,551 active entries and preserved 186 omitted records in the review queue. Duplicate/alias cleanup and exclusions preserve the remaining relative order. See [catalog migration notes](CATALOG.md).

In [`scripts/build-catalog.mjs`](../../scripts/build-catalog.mjs), each retained entry receives `rank: ++system.count`; `sourceRank: i + 1` records its original position. Therefore, removing an earlier duplicate changes a game's displayed rank without changing the editorial ordering.

These ranks are inherited editorial positions. The project does not currently calculate them from review averages, community voting, VGC, or a reproducible combination of external lists. The original broad source references do not provide item-level evidence for the ordering.

[`lib.js`](../../lib.js) defaults to system order in the catalog, then rank within that system. A combined view is not a global ranking of all games. The rank filter selects existing top-N entries within each system; filtering to a genre does not recompute the system rank. Saved Picks uses the same filtering/ordering machinery. Personal tracking and imported ownership affect eligibility and labels, but do not train a recommendation model or alter the curated rank.

**2. Owned-game scores**

[`library/tools/build_site.py`](../../library/tools/build_site.py) reads numeric `CommunityScore`, `CriticScore`, and `UserScore` from each Playnite CSV row and computes:

```text
copy.bestScore = maximum(nonmissing community, critic, personal scores)
game.bestScore = maximum(nonmissing bestScore across grouped copies)
```

If all inputs are missing, the value is null. There is no weighted average, review-count adjustment, or distinction in the final displayed number between personal and external opinion. For example, a personal 100 and critic 70 produce 100. A higher score on another grouped platform copy can also become the group's score, even when the user filters to one platform.

[`library/app.js`](../../library/app.js) displays this group value. The Score sort orders it descending, with missing values last and alphabetical ties. The default featured order first prefers games with cover artwork, then uses that score order. Artwork consequently affects the default order, although it is unrelated to reception.

The generated per-copy output retains `bestScore` but drops the three individual input scores. Recovering those components requires the original CSV or a new export. An old snapshot alone cannot establish which source supplied the number. Browser favorites and notes do not change it.

**3. Steam wishlist ranking**

[`library/tools/build_wishlist.py`](../../library/tools/build_wishlist.py) reads `reviews.percPositive` and `reviews.count` from the imported wishlist JSON. These are snapshot values, not automatically refreshed live reviews. The percentage is converted to an integer; missing fields currently become zero.

[`library/tools/steam_meta.py`](../../library/tools/steam_meta.py) calculates:

```text
p = positive percentage / 100, clamped to [0, 1]
n = review count
z = 1.96

L = (p + z²/(2n) - z × sqrt((p(1-p) + z²/(4n))/n)) / (1 + z²/n)
P = min(1, log10(n + 10) / 6)
pickScore = round(0.70 × L + 0.30 × P, 4)
```

For zero reviews, both `L` and `P` return zero. `L` is the lower endpoint of the conventional 95% Wilson interval for approval; it is conservative for small samples. `P` separately favors review volume and reaches its cap near one million reviews. The formula is a ranking heuristic: Steam reviewers are not a random sample of everyone who could play a game, and rounded percentages further limit statistical interpretation.

Synthetic examples calculated using the existing helper:

| Imported approval | Reviews | Wilson lower bound | Current pickScore |
| --- | ---: | ---: | ---: |
| 95% | 1,000 | 0.9347 | 0.8045 |
| 90% | 100,000 | 0.8981 | 0.8787 |

The second game ranks higher despite its lower approval and lower Wilson bound, because the extra popularity component outweighs them. This is more than a small-sample correction.

[`library/wishlist.js`](../../library/wishlist.js) uses descending `pickScore` by default, with alphabetical ties. Top by genre filters the wishlist first, groups the surviving games by main genre, and chooses the top picks by that same score within each group. Its top-N scope differs from the system lists' original-rank filter. Choosing the separate Review score sort uses raw approval percentage, then review count, then title. Review count has its own sort too.

Prices, discounts, Metacritic metadata, personal favorites, backlog status, and completion time are not terms in `pickScore`. The displayed positive percentage is an input; it is not the blended pick score. The wishlist's average-review statistic is an unweighted average of entry percentages, including zeros assigned to missing data; it is not the pooled approval of all reviews.

**4. Practical meaning**

Today, “rank,” owned “score,” and wishlist “top pick” mean three different things. None is a shared personalized recommendation score. The [ranking implementation plan](RANKING-IMPLEMENTATION-PLAN.md) replaces these ambiguities with named modes, preserved source evidence, appropriate platform scope, explicit missing data, and explanations. The [publishing plan](PUBLISHING-IMPLEMENTATION-PLAN.md) carries those distinctions into public onboarding and shared lists.
