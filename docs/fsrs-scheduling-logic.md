# FSRS Scheduling Logic

## Scope

This document describes the current FSRS-based review logic only.
It intentionally excludes older scheduling systems.

## Core idea

FSRS is a memory model that predicts how likely a learner is to recall a card at a given time.
Each review updates the card's memory state, and the next due date is chosen to match a target recall probability.

The practical result is:

- `Again` means the card was not recalled.
- `Hard` means the card was recalled, but with difficulty.
- `Good` means the card was recalled normally.
- `Easy` means the card was recalled with very little effort.

The same four ratings are used throughout the system, but their exact timing effect depends on the card state and the learner's historical review data.

## Rating codes

If a review log stores rating values as `0..4`, the common mapping is:

- `0`: non-rating event such as manual rescheduling
- `1`: `Again`
- `2`: `Hard`
- `3`: `Good`
- `4`: `Easy`

For actual user reviews, the meaningful ratings are `1..4`.
Value `0` is not a learner answer.
It exists to record schedule changes that should appear in history, but should not be interpreted as memory feedback.

Typical examples of `0` events:

- a due date is changed manually
- a card is moved to a different interval manually
- a card is reset back to a new state
- cards are rescheduled by a maintenance tool or migration

This distinction matters because the system must not treat manual schedule changes as evidence that the learner failed or recalled the card successfully.

## Card states

Cards usually move through three states:

- `Learning`: a new or recently failed card is still in short-term training steps.
- `Review`: the card has graduated to long-term scheduling.
- `Relearning`: a previously graduated card failed and is temporarily back in short-term training.

## Learning and relearning

Short-term steps should stay under one day.
Typical configurations use short delays such as `10m` or `30m`, or leave the step list empty and allow FSRS to control short-term scheduling directly.

During learning or relearning:

- `Again` resets progress and sends the card to the first short step, or to a very short model-chosen delay if steps are empty.
- `Hard` keeps the card in a short interval and does not advance it aggressively.
- `Good` advances the card through the remaining short steps and eventually graduates it to long-term review.
- `Easy` graduates the card faster than `Good` and gives it a longer first long-term interval.

## Long-term review

Once a card is in `Review`, FSRS schedules the next interval from the card's current memory state and the target retention setting.

The meaning of the buttons is:

- `Again`: the card failed; interval growth is interrupted, the card may enter relearning, and the next review becomes much sooner.
- `Hard`: the card passed, but weakly; the next interval grows less than with `Good`.
- `Good`: the baseline successful recall; this is the normal rating for most reviews.
- `Easy`: a stronger successful recall; the next interval grows more than with `Good`.

Unlike fixed-multiplier schedulers, FSRS does not rely on one static ease value to determine every future interval.
Intervals are produced by the model from review history, memory state, and desired retention.

## How cards reappear

### Worst-case path

If the learner repeatedly presses `Again`:

- the card stays in learning or relearning
- the next appearance stays very soon
- long-term interval growth does not happen
- the same card can consume a large amount of short-term workload

In practice, the card may keep cycling through very short delays until it is finally recalled successfully.

### Best-case path

If the learner consistently recalls the card well and mostly uses `Good` or `Easy`:

- the card quickly leaves short-term learning
- stability increases after each successful review
- the next due dates spread out rapidly
- workload per card drops over time

`Easy` expands intervals more aggressively than `Good`, so cards marked `Easy` can disappear for much longer periods earlier.

### Typical middle path

In a realistic flow, most answers are `Good`, some are `Hard`, and a smaller number are `Again`.

That usually produces:

- steady interval growth for familiar cards
- slower growth for borderline cards
- occasional short-term resets for forgotten cards
- a review load that remains concentrated around genuinely difficult material

## Product interpretation

For product design, the most important behavioral rules are:

- `Again` must represent a true failure to recall.
- `Hard` must still count as a successful recall.
- `Good` should be treated as the default successful answer.
- `Easy` should be reserved for cards that were clearly easier than normal.

If users press `Hard` when they actually failed, the model will overestimate memory strength and schedule intervals that are too long.
That makes answer semantics more important than any single numeric setting.

## Summary

FSRS is a model-driven scheduler:

- repeated failures keep cards near the learner
- repeated successful recalls push cards farther away
- `Hard`, `Good`, and `Easy` are different strengths of success
- the exact next interval is personalized, not fixed

## Product simplification

In this product, we simplify the domain model and do not store a persistent `learned` or `unlearned` card state.

Instead, the system relies on:

- the card itself
- append-only review events
- the current computed scheduling fields such as `next_due_at`
- memory model fields required by FSRS

This means a card is not treated as permanently learned.
It is simply a card with a current review history and a current next due date.

In practice:

- if a card has no review events, it is `new`
- if `next_due_at <= now`, it is `due`
- if `next_due_at > now`, it is `scheduled`
- if the interval or stability is above a product-defined threshold, it may be labeled `learned` or `mature` in the UI

In this model, labels such as `new`, `due`, `scheduled`, `learned`, or `mature` are derived views, not core stored states.

This keeps the data model smaller and easier to reason about:

- fewer persistent state transitions
- less risk of state drifting away from review history
- simpler offline sync
- cleaner product semantics

The scheduler still uses review history and memory data to compute the next due date.
Only the product model is simplified.
