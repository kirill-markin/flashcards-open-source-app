# iOS Memory Diagnostics

How to decide what killed the app the next time a `WatchdogTermination` event
arrives from the iOS client. Read the event once, follow the decision tree, and
end on an action.

## Why these events have no stack trace

The OS kills the process, and the Sentry Cocoa SDK synthesises the event on the
next launch from the previous session's persisted state. There is no crashing
frame, and there never will be one; an event with no stack is the expected shape,
not a broken upload. See
[Sentry watchdog terminations](https://docs.sentry.io/platforms/apple/guides/ios/configuration/watchdog-terminations/).

The SDK omits frequently changing context such as free memory from these events,
so the only memory data they can carry is the process diagnostics that
[`SentryCaptureMapping.swift`](../apps/ios/Flashcards/Flashcards/Observability/Sentry/SentryCaptureMapping.swift)
adds to every breadcrumb the app emits; the fields are defined in
[`MemoryDiagnostics.swift`](../apps/ios/Flashcards/Flashcards/Observability/MemoryDiagnostics.swift).
`contexts.app.in_foreground` is set to `true` unconditionally by the SDK on these
events, so it is not evidence that the user was in the app.

The SDK persists breadcrumbs for these events on a background utility queue, so
a kill under memory pressure can lose the newest breadcrumbs or all of them. An
event with no breadcrumbs is SDK persistence loss, not broken instrumentation;
it answers nothing about memory.

## Reading the breadcrumbs

App-emitted breadcrumbs are the ones whose category starts with `ios.`. Sentry's
own network breadcrumbs use the `http` category and never carry the memory
fields, and the newest entries in the ring buffer are often exactly those, so
scan the whole buffer before concluding anything.

On an app-emitted breadcrumb, an empty `app_memory_footprint_bytes`,
`app_memory_available_bytes` or `app_uptime_seconds` means that sample was
unavailable. Available memory is always unknown on Mac Catalyst: macOS can
return zero when no process memory limit is configured. Historical Catalyst
events can contain a literal `0` for this reason; do not interpret it as zero
headroom or evidence of an out-of-memory kill. Empty footprint or uptime values
on every app-emitted breadcrumb of a current build mean sampling failed, which
is worth a look. App-emitted breadcrumbs without the `app_memory_*` keys at all
came from a build older than the instrumentation and answer nothing.

## The decision tree

Read the last app-emitted breadcrumbs first, then walk down. Every branch ends
in an action.

1. **`app_memory_available_bytes` at or near zero on the last iOS/iPadOS
   breadcrumbs, or `app_memory_footprint_bytes` climbing across the window** →
   investigate memory pressure. A literal `0` on iOS/iPadOS means the process has
   reached its memory limit; no climbing trend is required alongside it. Catalyst's unknown
   headroom cannot support this conclusion. A climbing footprint corroborates
   memory pressure, and the breadcrumb where the curve turns names the operation
   that started the growth; a flat footprint only means the growth predates the
   ring buffer or arrived in one allocation. Do not weigh the footprint against
   `contexts.device.usable_memory`: that is device-wide physical memory, while
   iOS kills a process at its own per-process limit, well below it. On iOS/iPadOS,
   the headroom question is answered directly by `app_memory_available_bytes`.
   Read all of it together with `app_uptime_seconds`: a large footprint after
   four hours is a slow leak, the same footprint after twelve seconds is a
   startup allocation, and they are different bugs.

2. **A `memory_warning_received` breadcrumb present** → the OS warned before it
   killed. Same conclusion as branch 1, and that breadcrumb is the starting
   line for the investigation.

3. **Memory flat and modest, no warning** → no captured memory-pressure signal;
   unknown headroom does not rule out an out-of-memory kill. Continue to branch 4.

4. **A `Fatal App Hang Fully Blocked` issue for the same user, release, and
   minute** → that issue carries the stack; work from it and ignore the
   watchdog event. App-hang tracking is configured in
   [`SentryConfiguration.swift`](../apps/ios/Flashcards/Flashcards/Observability/Sentry/SentryConfiguration.swift),
   and the project has produced such events before, so the absence of a hang
   event is evidence rather than a gap. Only fully-blocking hangs are reported,
   so a partial stall during a scene transition would not appear as its own
   issue: check the timestamps of consecutive `scene_phase_changed` breadcrumbs
   for that case, where a slow transition shows up as a gap between them.

5. **Flat memory, no warning, no hang** → leave the cause unproved. Do not open
   engineering work on a single user without a new signal.

## `FLASHCARDS-IOS-3Q`: settled, and when to reopen

The 2026-08-06 event of Sentry issue `FLASHCARDS-IOS-3Q` predates the memory
instrumentation (#1269, 2026-08-07), so the memory branches could not be
evaluated; only notification reconciliation and an app hang are ruled out. It had
one affected user, three ordinary successful sync cycles and no app-hang event,
and the process died right after a preference change, a quick `inactive`/`active`
scene transition and a successful foreground sync. Every
`notification_reconciliation` breadcrumb ended in
`*_skipped_permission`, and the reconcile pass is serialised by a generation
counter in
[`FlashcardsStore+ReviewNotifications.swift`](../apps/ios/Flashcards/Flashcards/Review/Notifications/FlashcardsStore+ReviewNotifications.swift).
Do not re-derive these facts.

Reopen `FLASHCARDS-IOS-3Q` when any of these appears:

- an event adds evidence of memory pressure; the presence of memory keys,
  historical Catalyst zeros or missing samples alone is not a reason to reopen
- the affected user count rises above one
- a `Fatal App Hang Fully Blocked` issue appears for the same release and user
