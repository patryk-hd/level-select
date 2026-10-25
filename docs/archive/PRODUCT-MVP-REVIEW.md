# Product direction and local MVP review

Reviewed 2026-09-16. This is an assessment and proposed reprioritization, not an
approved replacement roadmap or a claim that the recommendations below are
implemented. No application behavior, imported data, or existing plans changed.

**Follow-up:** the user confirmed that correct Steam, VideoGamesCritic and retro
scores are essential to the MVP. The [next-stage checklist](NEXT-STAGES-CHECKLIST.md)
is now the delivery sequence; it replaces the lighter ratings scope proposed in
this review. The findings below remain the assessment baseline.

## Verdict

The project is aligned in purpose and has substantial working foundations. Its
feature inventory already exceeds what is needed for a first personal trial.
The remaining risk is that feature breadth, ratings infrastructure, and detailed
tracking controls obscure the simple outcome: choose games, enjoy playing them,
make considered wishlist decisions, and remember the experience.

The product promise should be: **Enjoy more of the games you already have, discover
classics worth your time, and keep a wishlist you actually mean.** Successful use
can end with the user leaving the app to play. More browsing time and more games
marked complete are insufficient measures of success by themselves.

## Evidence and current implementation

Reviewed the root, library, tracking and ranking READMEs; backlog, ranking,
publishing and local-readiness plans; catalog/artwork notes; and implementation
paths for imports, connections, tracking, suggestions, wishlist decisions,
ranking snapshots and page presentation. Inspected the current Recommendations,
Owned Games, Steam Wishlist and Play Plan screens on a separate localhost port.
External review covered public product pages, not authenticated competitor apps.

| User objective | Implemented evidence | Assessment / remaining gap |
| --- | --- | --- |
| Manage a library across platforms | Playnite CSV builder, grouped titles and underlying copies, search, platform/store filters, notes, favorites, hidden entries and import validation. | Useful local foundation. Import/update is command based. Direct connectors and browser file intake are future work. Name-based grouping is not verified edition identity. |
| Manage and reduce a Steam wishlist | Decisions, priorities, target prices, snooze/review dates, resumable ten-game reviews, pair comparison, owned alternatives, acquisition handoff, reversible removal and exports. | Most necessary decision mechanics exist. Changes are local; the user must act on Steam separately. An actionable checklist would be easier than a JSON removal export. |
| Explore retro recommendations connected to ownership | 4,551 catalog records across 50 systems/collections, artwork, platform filters, saved flags, ownership links and shared tracking after confirmation. | Strong differentiator, but inherited numerical ranks lack item-level evidence. Same-name ownership links can overstate identity. Modern platforms are also present; retro focus needs deliberate presentation. |
| Choose and play backlog games | Ordered Up Next, Playing/Paused/Backlog/Finished/Retired, suggested queue sizes, priorities, copy selection, three explained suggestions, roulette and manual entries. | Core capability exists. Suggestions are buried in the page and largely reflect queue/priority/favorites; remaining all-system ties use title order. No duration-aware or learned taste model exists. |
| Make progress enjoyable | Completion albums, reflections, session notes, milestones, optional XP/levels/goals and six challenge/season templates. | More than enough for the first trial. Test whether one visible challenge and lightweight celebration help; stop expanding the reward system. |
| Modern, enjoyable design | Consistent dark/gold shell, covers, grid/list layouts, responsive navigation, focus styles and reduced-motion rules. | Credible visual foundation. Main workflows remain control/text heavy; Play Plan and suggestion cards particularly need stronger visual hierarchy and artwork. |
| Reliable local use and later distribution | Shared IndexedDB, revision checks, migration previews, undo/corrections, tracking backups, sample/private build separation, local server and Mac launcher. | Good engineering investment. Tracking backup is not a full library/artwork backup. Public browser imports, accounts and cross-device sync are not implemented. |

Implementation anchors: [library import](../../library/tools/build_site.py),
[connections](../../library/core.js), [shared client](../../tracking/client.js),
[suggestion rules](../../tracking/suggestions.js),
[wishlist rules](../../tracking/wishlist.js), [Play Plan page](../../library/backlog.html),
[suggestion cards](../../library/suggestions.js), and [ranking contract](../../ranking/README.md).

Useful capabilities absent from the user's initial list include replay history,
retirement, personal objectives for games without endings, import/backup recovery,
price freshness, manual entries, pinned systems, cross-tab updates and explicit
edition confirmation. Preserve these foundations while simplifying their UI.

## Findings that should change the next increment

**1. The central action is too far down the page.** `library/backlog.html` puts
statistics and rewards before the queue, then history and challenges before
“What should I play?”. The observed desktop first screen was dominated by
tracking/summary content. Move continue/choose-next actions to the top; move
history, statistics and challenge administration into secondary tabs or collapsed
sections. Reuse Play Plan as the returning-user home instead of adding a separate
dashboard subsystem.

**2. Identity correctness matters before ratings breadth.** `connectLibrary()`
accepts one normalized-title candidate and uses platform agreement to classify it;
it does not compare release year, edition or product type. A synthetic 1991 NES
original and unrelated 2020 PC same-name title produced an other-platform link.
`app.js` renders that as ownership on another platform. Explicit progress linking
is more conservative, but that does not make the browsing ownership assertion
reliable. Label uncertain links as possible matches and provide confirmation or
rejection. Preserve those decisions across refresh. Do not merge histories to
solve display grouping. The import builder also groups by normalized name;
same-name reboots and distinct editions need explicit handling.

**3. The default rating experience has insufficient populated data.** The running
personal wishlist showed only one entry rated in Saved Steam ratings. The checked-in
crosswalk similarly represents one real game, Elden Ring; authored samples must
not be confused with real coverage. The K0 pilot accepted no exact-release scores
from its 50 queries; that is a pilot acceptance result, not proof that a provider
has no retro coverage. Implemented adapters and useful collection coverage are
different milestones.

Use honest interest/review/title ordering when a source is sparse. Offer explicitly
labeled imported ratings where available, without silently filling one source's
missing scores from another. Populate verified exact Steam IDs using the existing
bounded refresh path, then a reviewed VGC slice relevant to actual decisions.
Broader catalog discovery and IGDB coverage can follow observed need. Keep
platform-specific scores distinct from work-level context.

**4. Shared storage has not yet produced one clear collection experience.**
Recommendations has a Wishlist flag in Saved Picks, while Steam Wishlist displays
the imported Steam snapshot. Manual acquisitions are reflected in tracking and
suggestions but only enter the imported Owned Games list after reimport. Those
boundaries are documented but surprising in normal use. Make locally recorded
ownership visible in Library and provide a coherent wishlist view with source
labels and filters. Keep edition references separate underneath. This can be a
shared view over existing records; it does not require store synchronization or
a database rewrite.

**5. Wishlist reduction needs a complete handoff.** Keep resumable reviews,
undo and owned alternatives. Present Keep, Later and Archive as easy decisions,
with price targets and dates available on expansion. Unreviewed imported entries
currently display the default Keep label; distinguish “not reviewed” from a
deliberate keep. Promote the removal list into a readable checklist with Steam
links and clear pending/confirmed status. A later import can reconcile absence,
provided incomplete snapshots are not treated as proof of removal. Do not claim
that local archive has already removed an item from Steam.

Move “Remove the other N” out of the primary flow: quality cutoffs alone do not
establish personal interest. Retain a previewed, reversible advanced operation
if useful. Keep purchases neutral and count thoughtful keeps as review progress.

## Lessons from reference products

| Reference | Observed strength | Apply here |
| --- | --- | --- |
| [FinalSave](https://finalsave.app/) | Explicit collection → choice → progress → memories promise; cover-led presentation and short editorial selections. | Lead with the player's next action and visible games. Preserve completion memories. Its public page is evidence of positioning, not verification of every signed-in workflow. |
| [VideoGamesCritic](https://videogamescritic.com/) | Visible source/component labels, confidence and links to how a score was computed. | Use attributed reception as decision context. Avoid turning our MVP into a critic aggregation, patch analytics or reviewer-ranking service. Its broad platform labels do not by themselves establish a best port. |
| [Playnite](https://www.playnite.link/) | Consolidates games from multiple stores, supports emulation and customization. | Keep Playnite as an import partner. Our differentiator is choosing and remembering what to play, with retro discovery, rather than rebuilding store aggregation and launching. |
| [Backloggd](https://backloggd.com/about/) | Cross-platform collection, journals, playthroughs and lists. | Make recording optional and rewarding, with quick status actions. Social feeds and public reviews are unnecessary for a personal MVP. |
| [Dustpile](https://dustpile.dumbbellgames.com/press) | One-game-at-a-time backlog/wishlist cards, keyboard/touch decisions and undo. | Improve the existing review session with a focused card, easy decisions and a finite stopping point. Do not copy its entire discovery/social feature set. |
| [IsThereAnyDeal](https://isthereanydeal.com/welcome/) | Waitlist notification rules and price research. | Price is a constraint on an already-wanted purchase. Link to specialist research where helpful; defer building another deal/alert service. |

Community feedback supports investigating these patterns, but is anecdotal rather
than a representative satisfaction survey. Examples include
[enthusiasm for Playnite's collection/history experience](https://www.reddit.com/r/playnite/comments/1vf9ggn/im_officially_in_love_with_playnite_this_thing_is/),
[Backloggd users describing motivation](https://www.reddit.com/r/backloggd/comments/1qv67yq/backloggd_is_an_incredibly_good_site_for_video/),
and [concern about effort spent maintaining optional tracking fields](https://www.reddit.com/r/backloggd/comments/1w97z1s/how_many_features_do_you_use/).
There is no basis here to claim every named product is universally praised.

## Scope and presentation decisions

**Keep and emphasize:** library intake/search, understandable ownership, a small
play queue, continue/choose actions, retro discovery, short wishlist reviews,
finish/retire, undo and dependable recovery. Keep optional completion cards and
one easily understood challenge visible when enabled.

**Simplify or demote:** top-level Saved Picks and Systems navigation, reward
configuration, six simultaneous challenge entry points, extensive score
provenance on everyday screens, large statistics blocks and bulk rating-based
wishlist trimming. Preserve data and advanced capabilities rather than deleting
records during simplification.

**Retire from normal quality ordering:** unsupported legacy numerical ranks and
their suggestion tie-breaks, following the preference already recorded in the
ranking plan. Retain the catalog as browsable discovery content and preserve
historical challenge snapshots. Unrated games remain discoverable; removing old
ranks must not remove retro browsing or substitute a PC-port score for a console
release. A few deliberately reviewed retro selections are sufficient for a trial.

**Defer:** accounts, cloud sync, community feeds, public ratings, leaderboards,
new direct store integrations, automated Steam writes, background price alerts,
learned recommendations, custom retro consensus, best-version scoring, temporal
analytics, new reward types and cross-platform desktop packaging. A manually
preferred owned copy is sufficient before comparable platform evidence exists.

Proposed navigation: **Play / Library / Discover / Wishlist**, with History and
Challenges inside Play, and systems/favorites as contextual views. This is a
proposal for testing, not a reason to rewrite the app framework.

For visual polish, retain the existing dark/gold identity, give the play queue and
suggestions cover art, use compact platform badges and one clear primary action,
and reserve subtle pixel/CRT motifs for accents. Add short queue transitions,
review-card movement and completion/badge reveals with reduced-motion support.
Avoid effects that delay actions. Keyboard interaction, responsive layout and
readable text are part of this work. Fun should reward meaningful decisions and
play; it should not create pressure to buy or finish unwanted games.

## Proposed bounded delivery and acceptance

The [local-readiness plan](LOCAL-TEST-READINESS-PLAN.md) correctly identifies
coverage, matching and UX gaps. I recommend changing its sequence: a general
multi-provider discovery pipeline and full requested-pass accounting should not
block the first personal play/review trial. Narrow identity fixes and sufficient
evidence for the selected trial games should.

1. **Make existing workflows trustworthy.** Fix uncertain ownership claims;
   preserve reviewed identity decisions; make acquisition and wishlist source
   boundaries understandable; correct sparse-source defaults. Verify imports,
   refreshes and restoration with representative real-data cases.
2. **Make choosing pleasant.** Put continue/next suggestions first, show covers,
   reduce visible controls, simplify the existing review session and expose its
   manual Steam handoff. Use current intent/platform/genre filters before adding
   new mood or duration metadata. Add a simple manual duration preference only
   if the trial shows it would change choices; do not assume an external duration API.
3. **Run a two-week personal trial.** Keep development to observed blockers.
   Log time to choose, occasions a suggestion led to actual play, review effort,
   real wishlist removals separately from local archives, misleading matches,
   and whether tracking felt enjoyable. Do not require finishing a long game
   within the trial or penalize retirement.

Proposed acceptance checks (targets, not current measured results):

- Import/update the intended Playnite CSV and documented wishlist JSON format;
  errors leave existing data usable, and reimport preserves notes, queue and history.
- Find an owned game and its correct copy without a misleading edition claim.
- Reach continue/choose-next immediately and select an eligible game in roughly
  one minute in repeated trials; mark it playing with a small number of actions.
- Review ten wishlist items in roughly five minutes, pause/resume/undo, and use
  the Steam checklist without confusing local decisions with store changes.
- Discover an owned retro candidate from a selected system and add the correct
  copy to the plan. Missing ratings never prevent browsing or play tracking.
- Finish or retire, optionally reflect, and see a consistent history card;
  corrections do not duplicate rewards.
- Restart and recover a workspace using a tracking backup plus separately saved
  source files. Full dataset backup remains a distinct later deliverable; its
  absence must be clearly explained during the local trial.
- Check these flows at desktop and mobile widths with keyboard operation and
  reduced motion; no horizontal overflow or hidden primary action.

Promote browser file intake and portable full-dataset backup ahead of accounts
when moving beyond the personal pilot. Keep a single web implementation; decide
on a PWA/desktop wrapper only when distribution needs are known.

Documentation should have one current status matrix with three separate states:
implemented, populated with useful real data, and validated in personal use.
`ranking/README.md` still says K5 personalization is next, while the newer
readiness plan says to close K2 first. Historical checkpoints and baseline tables
should be clearly subordinate to the current decision. This review proposes the
product sequencing; it does not silently resolve those roadmap choices.

## Validation performed and limits

- Node suite: 140 of 142 passed in the sandbox. The two launcher tests could not
  bind localhost; both passed when rerun with localhost permission. No functional
  test failure remained in these runs.
- Python suite: all nine tests passed.
- Read-only desktop UI inspection covered the current checkout. Existing browser
  automation scripts were reviewed but not rerun; no full mobile/accessibility
  certification or real-user behavioral validation is claimed.
- The service already occupying port 8765 displayed the older Top Retro Games
  Lists landing page. Inspection used the current checkout on port 18765 instead;
  the pre-existing service was not stopped. Confirm the served version/origin
  before a personal trial, because tracking storage is origin specific.
- The review did not accept a tracking migration, edit personal records, refresh
  providers, create accounts, deploy, commit or push. Private collection totals
  and membership are omitted from this repository document.
