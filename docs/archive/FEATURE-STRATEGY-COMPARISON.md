# Choosing what to play: platform comparison and recommended scope

Reviewed 2026-09-19 against the current checkout and the user's Grok summary.
The user approved proceeding with these recommendations on 2026-09-19. Their
delivery tasks are now recorded in the checklist; this comparison itself does not
claim implementation.
The [next-stage checklist](NEXT-STAGES-CHECKLIST.md) remains the delivery authority,
including its required Steam, VideoGamesCritic and retro coverage gates.

## Recommendation

Build the best place to answer **“What would I enjoy playing now, from my library
or the retro systems I care about?”** Make three things excellent: choosing a
playable game, discovering worthwhile classics, and making considered wishlist
decisions. Imports, ratings and tracking should support those outcomes.

The current plan already contains most proposed features. Its largest gaps are
coherent views, populated trustworthy evidence and a prominent decision flow.
The strongest new addition is a small context-aware chooser. A universal weighted
quality score, collector valuation and many store connectors would consume effort
without resolving those gaps.

## Comparison with our implementation

“Implemented” means present in code/documented delivery logs, not newly tested
in this review or validated through the planned personal trial.

| Grok suggestion | Current state | Recommended decision |
| --- | --- | --- |
| Unified modern/retro library | Playnite import, per-copy records, Game Atlas, shared tracking, manual entries and reviewed matches exist. Local acquisitions and catalog wishes still need coherent Library/Wishlist views. Edition regrouping and preferred-copy selection remain open. | **MVP essential.** Finish stages 1 and 6 before adding connectors. Preserve distinct editions and play histories beneath the unified view. |
| Smart wishlist | Priorities, reasons, targets, snooze/review dates, ten-game review sessions, comparisons, owned alternatives, undo and acquisition handoff exist. | **MVP essential.** Simplify existing tools. Add trustworthy aging, unreviewed status and a readable Steam removal handoff. |
| Mood + time + platform chooser | Explained suggestions, platform/store/genre/intent filters, priorities and roulette exist. No mood/session-duration model exists; source-based suggestion preference is planned. | **Highest-value proposed addition.** Extend the existing chooser with optional context and a small set of local tags. |
| Living weighted scores | Source modes, Steam conservative approval and cached Steam/VGC/IGDB adapters exist. Useful collection-wide data and retro acceptance remain unfinished. | **Keep required source coverage.** Separate reception, personal preference and session fit. Defer a custom public composite. |
| Completion + weekly planning | Playthroughs, pause/retire/replay, journals, milestones, history, optional weekly goals and challenges exist. | **Keep; simplify presentation.** An optional small weekly selection can follow, without deadlines or another reward system. |
| First-class retro | System/family browsing, favorites, per-copy matching and discovery exist. Original-release evidence is incomplete. | **MVP essential for discovery and identity.** Add access/setup notes; achievements later. Physical condition, valuation and ROM management are separate scope. |
| Reviews + notes | Notes, personal ratings, reflections and session journals exist. | **Sufficient for MVP.** Make “where I left off” visible. Defer social/public reviews. |
| CSV/JSON portability | Versioned tracking JSON with merge/restore exists; library CSV intake and wishlist exports exist. Neither a full workspace backup nor a general CSV export is implemented. | **Local recovery is mandatory.** Full backup and browser intake lead the external pilot; readable CSV complements lossless JSON. |

Evidence: [current checklist](NEXT-STAGES-CHECKLIST.md),
[suggestion implementation](../../tracking/suggestions.js),
[wishlist rules](../../tracking/wishlist.js), [library guide](../../library/README.md),
[tracking/backup contract](../../tracking/README.md), and
[ranking behavior](CURRENT-RANKING.md). Recent identity/search deliveries supersede
older gaps in the September 16 product review. This review did not inspect private
browser records or measure fresh live coverage.

## Which products to learn from

These are public-page observations, not authenticated workflow tests or proof
that any product is objectively “best.” Adaptations are our product judgment.

| Reference | Verified evidence / limitation | Useful adaptation |
| --- | --- | --- |
| [SavePoint by Two Average Gamers](https://savepoint.twoaveragegamers.com/) | Describes three picks using mood, time and platform. Several unrelated products use this name. Its [pricing page](https://savepoint.twoaveragegamers.com/pricing) and promotional pages differ on free access. | Study finite choice and clear reasons. Avoid monetary backlog guilt. Advertised integrations do not establish APIs available to us. |
| [FinalSave](https://finalsave.app/) | Connects collection, choice, progress and reviews; describes planning around weekly hours and saved Play Plans. | Put covers, Continue and a few choices first. Keep completion memories and permission to stop a game. |
| [Backloggd](https://backloggd.com/about/) | Documents game status, logs, journals and tags. | Preserve optional reflection and lightweight playthrough history. Social/community features are a later choice. |
| [Playnite](https://playnite.link/) | Documents multiple store libraries, emulator support, local data, extensions and controller fullscreen mode. | Continue using it as an aggregation partner. Preserve identity/copy details; avoid rebuilding its launcher/plugin system. |
| [GameTrack](https://gametrack.app/faq) | Documents Apple-device apps, account imports, RetroAchievements, barcode intake and completion states. | Study quick mobile actions and import/account status. Competitor integrations do not establish our access to equivalent APIs. |
| [GG](https://ggapp.io/) / [Infinite Backlog](https://infinitebacklog.net/) | GG confirms collection/discovery/social positioning. Infinite Backlog returned a JavaScript shell. Import quality was not established here. | Retain for later hands-on comparison; do not rank import reliability from this summary. |
| [Hoard Haven](https://hoardhaven.com/) | Describes collection tracking, valuation, marketplace and a filtered randomizer. | Borrow collection filters. Existing roulette already supplies the basic random-choice pattern. |
| [Retro Vault Elite](https://www.retrovaultelite.com/retro-game-collection-tracker.html) | Focuses on retro collecting. “Retro Vault” is ambiguous: [RetroVault.pro](https://retrovault.pro/en/) is another product. | Keep region/copy distinctions that affect play. Defer detailed physical collecting workflows. |
| [GameSave](https://gamesave.app/?lang=en-GB) | Promotes PC/retro unification alongside XP, currencies and leaderboards. | Study presenting modern and retro games together. Existing optional rewards are sufficient. |

Prioritize SavePoint for choice, FinalSave for presentation, Playnite for intake,
and Backloggd for memories. GameTrack is the strongest verified mobile reference
in this review. Collector products inform metadata without determining the main flow.

## The experience to build

**Play** should open with Continue and the last session note, then up to three
explained choices. Library, Game Atlas and Wishlist remain supporting destinations;
the existing Game Atlas name already communicates discovery and need not change.

Offer optional inputs: time available tonight, desired experience (relaxed, story,
challenge, exploration), and the device/system available. Remember defaults locally,
permit skipping every question, and keep manual Up Next order authoritative.
Genre can help discovery but must not be presented as verified mood evidence.

Check selected-copy access first, then respect intent and priority. Use explicit
tags/context for automatic suggestions, and the chosen reception source as an
explainable tie-break where applicable. Avoid duplicate editions in the shortlist.
Dismissal for tonight should neither archive a game nor permanently change taste.

Modern and retro games can appear in the same eligible shortlist. Retro discovery
may also include unowned catalog games, clearly labeled with **Save to wishlist**
or **Record access**. Catalog membership or achievement history does not establish
ownership or current playability. Do not force a retro slot when nothing fits.

Separate two time questions:

- **Session fit:** Can I make satisfying progress in 30 minutes? Begin with optional
  user/curator tags for short sessions and easy stopping, with provenance and unknown
  states. Device suspend or emulator save states can change this by copy.
- **Total commitment:** Approximately how long is the story or full completion?
  Show source, category and sample count when available. A long RPG may suit short
  sessions. Do not calculate remaining story time by subtracting imported lifetime
  playtime from an average completion estimate.

Missing mood/time data must not silently exclude most of the library. Label unknowns,
allow explicitly strict filters, and explain when no verified fit exists. Tag the
active queue and a bounded modern/retro test set first; do not require enriching
the whole collection before trying the interaction.

Retro discovery should explain why a game matters, which release the evidence
covers and which copy the player can use. Add preferred copy and a simple
ready/setup-needed/unknown note. Region/language differences matter when they affect
play. Automatic “best version” verdicts need comparative evidence and remain deferred.

Wishlist review should clarify whether interest remains, whether an owned game
already satisfies it, and whether there is time to play. Keep Keep/Later/Archive,
reasons, undo and optional targets. Distinguish source added date, first seen locally
and last reviewed; unknown age stays unknown. Age or a low score can prompt review,
never automatic removal. Local archive and actual Steam removal remain separate.

## Data-source decisions

| Need | Recommendation | Evidence and boundary |
| --- | --- | --- |
| Metadata/identity | **IGDB first**, with stable local IDs and reviewed mappings. MobyGames remains the existing bounded retro fallback. | [IGDB docs](https://api-docs.igdb.com/) expose release/edition relationships and separate ratings/counts. They describe commercial partnerships; evaluate these before monetized distribution. A provider game ID is not an owned-copy ID. |
| Player reception | **Steam review summaries now**, preserving counts, filters and observation dates. | The [review endpoint](https://partner.steamgames.com/doc/store/getreviews) distinguishes page size from query totals. It is separate from library import. Individual reviewer trust scoring is unnecessary for MVP. |
| Additional reception | **VGC unchanged and attributed**, as already required. | Its [citation policy](https://videogamescritic.com/cite) prohibits presenting its score as our own or averaging it into one. Refresh and label scope; broad platform coverage does not prove exact-release reception. |
| Direct press aggregates | **Defer additional OpenCritic/Metacritic integration** unless the retro pilot identifies a concrete unmet need. | No suitable current read-data contract was verified here. The official [OpenCritic publisher plugin](https://portal.opencritic.com/wordpress-plugin) submits metadata; it does not establish a consumer aggregation API. Wrappers do not establish provider permission. |
| Total time to beat | **Evaluate IGDB first**, plus manual estimates/source links. | [Game Time To Beat](https://api-docs.igdb.com/#game-time-to-beat) documents duration categories and submission counts. This is not HLTB data; measure actual coverage. |
| HowLongToBeat | **Useful reference/link; optional future integration.** | Retrieval of [HLTB](https://howlongtobeat.com/) was blocked. This review did not verify an official supported public API. Access remains unresolved, rather than a promised dependency or proof that no partnership exists. |
| Retro progress | **RetroAchievements after MVP**, read-only and optional. | The [API](https://api-docs.retroachievements.org/) documents game/system data and user progress, with account keys and rate limits. Preserve achievement mode/set identity; mastery and personal story completion are distinct. |
| Retro lists/reviews | **Reviewed, attributed release-specific evidence.** | Evaluate individual Nintendo Life, IGN and GameSpot lists under stage 4; record publisher, date, method, scope and actual positions. Those lists were not audited here. [RetroGames.cz](https://www.retrogames.cz/) is a browsing/play catalog candidate, not established independent ranking evidence in this review. |
| Physical pricing | **Defer PriceCharting.** | Its [API docs](https://www.pricecharting.com/api-documentation) require paid access and expose condition-specific current prices; API/CSV history is unsupported. Price does not establish rarity or enjoyment. |
| Library intake | **Playnite CSV + current wishlist format + manual entries now.** Browser intake/full backup next; direct Steam later. | Steam's [GetOwnedGames](https://partner.steamgames.com/doc/webapi/IPlayerService#GetOwnedGames) requires a key and visible game details. It is not a wishlist-write API. PSN/Xbox need independent access evaluation. |

Retain last good data, source/date/scope and manual corrections. Provider failure
must not block play. Measure metadata, exact-release ratings and session-context
coverage separately. A documented endpoint is not a populated integration.

## What “our own score” should mean

Keep three independent concepts:

1. **Reception:** unchanged source values, Steam approval/counts and explicitly
   labeled conservative approval. Missing is not zero. A PC port's reception
   cannot stand in for an original console release.
2. **Personal opinion:** the user's rating/reflection for a playthrough.
3. **Play-next preference:** an explainable ordering for today's circumstances.
   “In your queue; ready on your handheld; tagged for short sessions” helps more
   than an unexplained 87/100 likelihood of enjoyment.

Start preferences with transparent rules, not arbitrary percentage weights.
If feedback later justifies adjustable weights or learned taste, validate improved
choices and preserve manual intent. Refreshed source data does not establish
historical trends or patch-aware analysis that we have not implemented. A custom
multi-source retro consensus remains deferred under the existing roadmap.

## Proposed roadmap changes

These approved deltas are incorporated into the authoritative checklist. Its
delivery logs identify completed increments; the table below records intended scope.

| Existing stage | Recommended adjustment | Completion evidence |
| --- | --- | --- |
| 1: identity | Finish edition regrouping/migration, correction queue and preferred copy. Add lightweight readiness when implementing copy selection. | Wrong editions remain unresolved; preference changes preserve history. |
| 2–4: providers | Preserve required Steam/VGC/retro gates. Evaluate duration fields during the bounded IGDB pilot as optional enrichment. | Separate coverage reports; duration does not block established ratings milestones. |
| 5 + 7: choosing/presentation | Prioritize Play home, Continue and three choices. Add bounded mood/session tags and context filtering to the existing engine. | Modern/retro examples show honest reasons and correct copies; unknown data remains usable. |
| 6: connected workflows | Complete local acquisition visibility and unified wishes. Include aging provenance and clear removal handoff. | Wishlist → acquisition → Library → Play works immediately; reimport preserves decisions. |
| 8: personal trial | Keep two weeks; measure choice time, actual play after suggestions, dismissals, wishlist effort and enjoyment. | Target a choice in about one minute and ten reviews in about five; compare existing flows, not just test results. |
| External pilot | Browser intake, lossless full backup, readable CSV and responsive operation first. | Fresh-workspace restoration preserves copy decisions, queue, notes/history and metadata; artwork exclusions are explicit. |
| After demonstrated need | Optional weekly hours/one main game plus a side game; RetroAchievements; direct Steam import; later sync. | Each addition resolves observed friction. Mobile layout alone does not provide cross-device synchronization. |

Keep collector valuation, ROM scanning/hosting/emulation, public feeds, reviewer
trust algorithms, automated wishlist deletion, a plugin marketplace, calendar
scheduling and more gamification outside the local MVP.

## Review limits

This review inspected plans/relevant implementation and public product/provider
pages. It did not sign into competitors, benchmark imports, fetch collection ratings,
certify provider permissions or run new application tests. Only documentation
changed. Measured coverage and personal-trial gates remain required for MVP completion.
