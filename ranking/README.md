# Ranking evidence foundation

K0/K1 foundations, K2 provider adapters/cache and K4 source views are implemented
as of 2026-09-16. General discovery/matching and broad real-data population are
not complete. Superseded by [docs/STATUS.md](../docs/STATUS.md) (2026-09-28); the IGDB pass now supplies
retro and library scores. The original plan read:
verified identities and useful Steam/VGC/retro coverage precede score-aware
suggestions and local MVP acceptance. K3 custom consensus and advanced K5
personalization remain deferred.

## Runtime contract

`evidence.js` is a pure browser/Node module. `ui.js` renders escaped explanations.
`fixtures/contracts.json` is synthetic. Node and Python use the same numeric
expectations, calculated independently with 50-digit decimal arithmetic.

Normalized observations use schema version 1:

| Field | Meaning |
| --- | --- |
| `id`, `schemaVersion` | Source observation identity and contract version. |
| `source` | Provider, independent family when established, upstream ID/URL, label and lineage. Unknown family is null. |
| `type`, `lane` | Personal rating, imported aggregate or unspecified legacy value. Reserved types cover future direct reviews, approval, lists and external composites. |
| `scope` | Existing tracking provider/ID reference, platforms, work/edition/region/build and mapping status. Copy association is not verified release matching. |
| `original` | Value, raw imported value, original scale and count/approval fields. Missing is null; zero is a value. |
| `dates` | Publication, observation, source update and window dates; unknowns stay null. Rebuilding is not a new source observation. |
| `provenance` | Adapter version, checksum or fixture, extraction field, attribution/access, review status and supersession reference. |

The Playnite builder retains critic/community/personal fields per copy with a
checksum covering copy ID, platforms and original CSV score cells. Runtime
observations derive from these fields without changing tracking IDs. `bestScore`
remains for compatibility only. Old snapshots lacking components use an explicit
legacy lane; reimport the original CSV to recover those components. The CSV does
not identify upstream rating providers/counts/dates, so these observations cannot
enter independent-source consensus.

A title group has no scalar rating unless platform/store filters identify one
copy. Details allow inspecting a specific copy; its headline and evidence change
together. Personal Playnite ratings stay separate from 0–5 playthrough ratings.
Default library order is title, without an artwork preference.

Wishlist `reviewEvidence` preserves percentage, counts, observation time, query
scope, raw imported review fields and adapter version. Counts are exact only
when positive and negative counts are supplied and sum to the total. Otherwise
Wilson is explicitly approximate. Query scope and dates remain unknown unless
supplied. Old zero percentages without evidence are ambiguous because the old
builder coerced missing data to zero; fresh exports can confirm genuine zeros.

Conservative approval uses the Wilson lower bound with z=1.96 and no popularity
bonus. Raw approval and volume have separate sorts. Exact/approximate method IDs
differ. Sorts retain full precision; missing evidence is unranked. Unreleased
entries stay outside top-by-genre and its removal cutoff. Legacy heuristic values
are labeled reference data only.

Future generated ranking records will contain target/scope, mode/method version,
snapshot and candidate-set IDs, evidence IDs, rank, independent family count,
coverage/freshness and exclusion reasons. Stability bands require actual source
resampling. K4 source records include mode/method, target/scope, snapshot and evidence IDs,
candidate-set ID, cohort, rank and freshness. No independence counts or stability
bands are inferred from aggregates. K2 supplies reviewed provider references. The following
manifest is research evidence, not a mapping approved for use in rankings.

## K0 bounded coverage audit

`pilot-manifest.json` records 50 reviewed VGC queries: eight current editorial
entries each for NES, SNES, Mega Drive, PS1 and classic PC, plus ten modern PC
titles. This purposive stress sample is not a representative coverage estimate.
Each query requested at most five candidates. Truncation is recorded; no result
does not prove absence from the provider.

| Outcome | Targets |
| --- | ---: |
| Work candidate with unresolved release/score scope | 22 |
| Related later edition, adaptation or port only | 18 |
| No returned results | 5 |
| Unrelated title or sequel results | 4 |
| Ambiguous catalog target | 1 |

All candidate lists were reviewed. **No exact-release score was accepted.** This
is an acceptance result, not a claim of zero provider coverage. Chrono Trigger
returned a 2018 record; several old console titles carried Switch or broad
PlayStation labels. Modern PC matches did not establish the platform/build
population behind their composite scores. The manifest keeps candidate IDs,
metadata, timestamps, response hashes and reasons, but no numeric ratings or
personal membership.

There are zero accepted independent families and comparison edges. VGC and its
underlying sources cannot be counted as independent votes. K3 cannot proceed
from these searches alone. The proposed model remains per-system ordinal
comparisons with equal independent family budgets, co-listed pairs only,
explicit ties and separate disconnected components. The initial consensus gate
remains three independent families overall and two per ranked release, to be
evaluated against later source coverage.

Provider documentation was refreshed:

- [VGC API](https://videogamescritic.com/developers): anonymous access, 60 calls/hour,
  caching and attribution. The [citation policy](https://videogamescritic.com/cite)
  excludes averaging the branded score into another rating. This audit used 50
  calls plus one probe, without a key/account. VGC remains a separate mode.
- [Steam reviews](https://partner.steamgames.com/doc/store/getreviews): returned
  review count differs from query-population totals. K2 collects exact counts for explicit Steam product IDs; matching numeric
  VGC IDs alone are not accepted as Steam mappings.
- [IGDB](https://api-docs.igdb.com/): authenticated access was not exercised;
  live coverage remains unknown. Its optional K2 adapter is tested with fictional
  responses; no credentials or account are required for the other sources.

Repeat the optional read-only audit with a new ignored cache directory:

```sh
node scripts/audit-ranking-coverage.mjs --fetch .runtime/ranking-pilot-YYYY-MM-DD
```

It makes at most 50 requests, reuses cached files, and stops on quota limits or
failures without automatic retries. It never updates the reviewed manifest.
New candidates require review before any classification or mapping is accepted.
Do not run this network audit in CI.

## Validation and next work

```sh
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npm run build
node scripts/check-ranking-browser.mjs --playwright /path/to/playwright/index.mjs --browser /path/to/chromium
npm run check:share
```

Browser checks use fictional fixtures and a new profile with requests intercepted.
Build/server allowlists expose only browser evidence/rendering modules, styles and
the selected normalized snapshot. Research manifests, crosswalks, provider code,
credentials and transport caches are not runtime assets. Product review adds tracking schema 7; reward rules do not change.

## K2 provider snapshots

```sh
npm run ratings:refresh -- --plan                 # inspect selection; no network or writes
npm run ratings:refresh                          # refresh reviewed seed/saved mappings
npm run ratings:refresh -- --steam 1245620         # add an explicit Steam product
npm run ratings:refresh -- --wishlist --provider steam --max-requests 50 --drain
npm run ratings:refresh -- --status               # saved progress; no network
npm run ratings:refresh -- --owned --tracking /path/to/tracking-backup.json --provider steam --plan
npm run ratings:refresh -- --provider steam --max-requests 10
```

Pages read saved data only; refreshing is an explicit local command. Reload the
page after refreshing. The first seed contains Steam Elden Ring approval and
VGC work context for its Steam product and existing PS5 catalog entry. It does
not populate the whole library or establish PS5-specific VGC reception.
The VGC detail response explicitly links the Steam product; no numeric-ID or
fuzzy-title inference is used. Owned Steam copies need confirmed product decisions exported from the review UI;
use `--owned --tracking <backup>` to select their verified app IDs. The CLI checks
the decisions against the current import. Unresolved/changed/rejected copies are
reported and excluded from new selection. Existing saved products are retained,
but only current valid decisions can associate their Steam scores with a copy.
VGC/IGDB owned-copy mappings remain independent.

The adapter set is VGC detail, Steam review query totals and optional IGDB
community/critic aggregates. VGC's score and components remain unchanged,
attributed and separate from our own scores. IGDB/VGC broad platform metadata is
work context only, excluded from system rankings. Steam approval is confined to
its exact product reference. K4 now adds explicit source modes. Wishlist defaults to the saved Steam source;
imported evidence is a separate choice. Owned and catalog source modes use their
reviewed mappings and retain work-level scope labels.

VGC works anonymously. Optional `VGC_API_KEY`, `IGDB_CLIENT_ID` and
`IGDB_ACCESS_TOKEN` are read from the process environment. There is no automatic
`.env` loader or OAuth token acquisition. Never put credentials in a crosswalk.
IGDB requires a reviewed mapping as well as credentials; there is no IGDB seed.
No accounts were created and no live IGDB request has been validated.

The public `ranking/crosswalk.json` is schema version 1 with a revision, unique
mapping IDs, provider/provider ID, target `{provider,id}`, scope, expected
identity, and review status/date/reason. For private additions, copy that shape
to `.runtime/ratings/crosswalk.json` (or use `--crosswalk <file>`). Custom mappings
override the same target/provider pair. VGC/IGDB require reviewed expected names;
VGC Steam targets also require the explicit linked Steam ID. Steam mappings must
use the identical Steam product ID. Search results are candidates, not approvals.
A changed identity expectation invalidates cache reuse; changed response identity
retains the previous accepted observation and records a failed refresh.

Refresh behavior:

- TTLs: VGC 6 hours, Steam 24 hours, IGDB 7 days. `--force` bypasses freshness only.
- Default budget: 20 network calls per batch, configurable from 1 to 50. Without
  `--drain`, the command stops after one batch. `--drain` continues the finite
  saved/requested selection, prioritizing uncached products and publishing each
  batch. Identical source/expected-identity requests share one cache entry.
- `--status` reports the last saved job offline: rated, no reviews, unavailable,
  retry pending and not processed. Complete means the requested products have
  terminal outcomes and the page snapshot was saved; it does not mean every
  product has a rating. A failed snapshot save remains publication-pending.
- Repeat the same command to resume. Fresh successful products are skipped;
  pending products are retried only after their saved retry time. Drain attempts
  each product at most once per invocation and never waits for a quota reset.
  Three consecutive transport failures pause that provider for backoff.
- Ctrl+C saves partial work and releases the lock. An abrupt process kill or
  power loss retains responses already checkpointed, but can leave a stale lock.
  `--force` is for bounded revalidation; it cannot be combined with `--drain`.
- Requests are spaced; anonymous VGC is conservatively capped at 50/hour across
  runs. ETags/304 responses revalidate without inventing a new observation date.
- Throttling honors bounded Retry-After, persists provider-wide backoff, and
  cannot be bypassed by `--force`. Missing records have a 24-hour negative cache.
- Timeout, invalid JSON, excessive response size, changed identity and provider
  failures preserve accepted values. Panels distinguish stale/failed data and
  expose observation, check, source-update and retry dates.
- Pending work (including an exhausted one-batch budget) is reported and
  the CLI exits 2. A process/storage failure exits 1. There are no automatic retry loops.

Private storage is under ignored `.runtime/ratings/`: normalized transport cache,
saved explicit Steam selections, job progress, evidence snapshots and the refresh
lock. Latest normalized output is `library/data/ratings.json`, also ignored. Writes use atomic
replacement. The selection is saved before network work, quota before each
request, and each normalized response before continuing. Cache state is persisted
first to preserve quota/backoff and avoid refetching on later publication failure.
A stale lock is not automatically removed: first establish that
no refresh is running, then remove `.runtime/ratings/refresh.lock` and retry.
Raw review text, reviewer identities, auth headers and provider error bodies are
not stored. Queries send product IDs, not local notes or account identifiers.

The sample snapshot `library/sample/ratings.json` is entirely authored from
fictional test responses. Public builds include it even when personal ratings
exist; `build:local` includes the personal snapshot. Runtime namespace checks
prevent sample/personal substitution. Live adapter smoke tests used the public
seed in a temporary directory, without reading or rebuilding personal imports.

Run the isolated provider browser checks after `npm run build`:

```sh
node scripts/check-provider-browser.mjs --playwright /path/to/playwright/index.mjs --browser /path/to/chromium
```

Validation: 142 Node tests, 9 Python tests and 49 isolated browser checks pass.
Live VGC/Steam refresh and cache reuse were checked with the public seed; IGDB
is fixture-tested only. Public build, sharing and whitespace checks pass.

Next: finish the real Steam/VGC/retro coverage and recovery gates in the
[next-stage checklist](../docs/STATUS.md). New personalization,
pinned lists and K3 consensus remain deferred until after the personal trial.
Preserve accepted challenge snapshots while retiring legacy ranks from active
quality ordering once replacement modes are ready.


## K4 source ordering

`modes.js` is the shared pure engine; `mode-ui.js` renders escaped explanations.
`panels.js` loads one validated, namespace-checked local snapshot per page. A
failed load produces unrated source views; imports remain explicitly selectable.

Steam conservative approval uses exact counts and full-precision Wilson ordering.
Raw percentage and popularity are separate modes. VGC/IGDB values are not blended.
VGC/IGDB catalog ordering is work context only, never a platform-release rank.
Owned `steamAppId` fields currently come from name metadata lookup, so K4 does
not treat them as verified Steam identity or automatically transfer ratings.

Wishlist and owned-library positions use their full imported cohorts. Game Atlas
positions use the filtered selection, so family/source lists start at 1 and stay
in score order across consoles. Missing values remain unranked. Catalog title/date
lists show list positions, not combined legacy ranks. Candidate
IDs use a versioned, deterministic 64-bit non-cryptographic fingerprint of cohort
name and sorted target references. Equal values share a competition position;
code-point title and stable-ID order make display ties deterministic. Different
cohorts can legitimately give a target different positions; the source value,
method and snapshot stay consistent. URL modes use the latest saved evidence,
not a pinned historical snapshot. K5 owns pinned lists and suggestion integration.

The original editorial view remains labeled; source modes never read those
positions as tie-breakers. Legacy owned maximum sorting is no longer selectable.
Accepted challenges and Play Plan rules remain unchanged in this increment.

```sh
node scripts/check-source-modes-browser.mjs --playwright /path/to/playwright/index.mjs --browser /path/to/chromium
```
