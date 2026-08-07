# iOS Memory Diagnostics

How to decide what killed the app the next time a `WatchdogTermination` event
arrives from the iOS client. Read the event once, follow the decision tree, and
end on an action.

## Why these events have no stack trace

The OS kills the process, and the Sentry Cocoa SDK synthesises the event on the
next launch. There is no crashing frame, and there never will be one. An event
with no stack is the expected shape here, not a broken upload.

The SDK also omits the contexts that change frequently — free memory, storage,
orientation, battery — from watchdog events, to minimise the disk I/O it would
otherwise do on every state change. That is why `contexts.device.free_memory`
and `contexts.app.app_memory` are absent while the static
`contexts.device.memory_size` and `contexts.device.usable_memory` are present.
See
[Sentry watchdog terminations](https://docs.sentry.io/platforms/apple/guides/ios/configuration/watchdog-terminations/).

The SDK does persist and replay the breadcrumb ring buffer onto these events.
So the only memory data that ever reaches a watchdog event is the data we put
into our own breadcrumbs.

## What the app records

`apps/ios/Flashcards/Flashcards/Observability/MemoryDiagnostics.swift` samples
these four fields, and they are attached to every breadcrumb the app itself
emits, not to a dedicated memory breadcrumb.

| Field | Meaning |
| --- | --- |
| `app_memory_footprint_bytes` | Bytes this process currently occupies; the number the OS kills against |
| `app_memory_available_bytes` | Bytes the OS still offers this process before it starts killing |
| `thermal_state` | Device thermal pressure at the moment of the breadcrumb |
| `app_uptime_seconds` | Seconds since process start; the scale for reading the other three |

There is also a `memory_warning_received` breadcrumb, emitted when the OS sends
a low-memory warning. Its presence is a strong signal on its own; see below.

App-emitted breadcrumbs are the ones whose category starts with `ios.` —
`ios.app_startup`, `ios.cloud`, `ios.foreground_operation`, `ios.ai_chat`,
`ios.ai_live`, `ios.notifications`. Sentry's own network breadcrumbs use the
`http` category, are built inside the SDK
(`options.enableNetworkBreadcrumbs = true`), and never pass through the app's
breadcrumb funnel, so they carry none of these keys. An `http` breadcrumb
without them is expected, and the newest entries in the ring buffer are often
exactly that.

On an app-emitted breadcrumb, `app_memory_available_bytes` and `thermal_state`
are always present and non-empty. Only `app_memory_footprint_bytes` and
`app_uptime_seconds` can be empty, and an empty value there means the sample was
unavailable; the keys stay present so the breadcrumb shape is stable. An
`app_memory_available_bytes` of `0` is a real reading — the process is already
over its memory limit — and never a missing sample.

## The decision tree

Read the last app-emitted breadcrumbs first, then walk down. Every branch ends
in an action.

1. **`app_memory_available_bytes` at or near zero on the last breadcrumbs, or
   `app_memory_footprint_bytes` climbing across the window** → an out-of-memory
   kill. Fix it. A literal `0` is the strongest evidence such an event can
   carry — the process was already over its memory limit — and settles the
   question on its own; no climbing trend is required alongside it. A climbing
   `app_memory_footprint_bytes` corroborates it, and the breadcrumb where the
   curve turns names the operation that started the growth; a flat footprint
   only means the growth predates the ring buffer or arrived in one allocation. Do not weigh the footprint against
   `contexts.device.usable_memory` — that is device-wide physical memory, while
   iOS kills a process at its own per-process limit, well below it (roughly half
   of physical memory for a foreground app, and lower under pressure).
   `usable_memory` is a device fact, not a kill threshold; the headroom question
   is answered directly by `app_memory_available_bytes`. Read all of it together
   with `app_uptime_seconds`: a large footprint after four hours is a slow leak,
   the same footprint after twelve seconds is a startup allocation, and they are
   different bugs.

2. **A `memory_warning_received` breadcrumb present** → the OS warned before it
   killed. Same conclusion as branch 1, and that breadcrumb is the starting
   line for the investigation.

3. **Memory flat and modest, no warning** → not an out-of-memory kill. Continue
   to branch 4.

4. **A `Fatal App Hang Fully Blocked` issue for the same user, release, and
   minute** → that issue carries the stack; work from it and ignore the
   watchdog event. App-hang tracking is on with a three-second threshold in
   `apps/ios/Flashcards/Flashcards/Observability/Sentry/SentryConfiguration.swift`,
   and the project has produced such events before, so the absence of a hang
   event is evidence rather than a gap. Known limit: only fully-blocking hangs
   are reported (`enableReportNonFullyBlockingAppHangs = false`), so a partial
   stall during a scene transition would not appear as its own issue. Check the
   timestamps of consecutive `scene_phase_changed` breadcrumbs for that case —
   a slow transition shows up as a gap between them, with no extra field
   needed.

5. **Flat memory, no warning, no hang** → record the event as OS-side or
   environmental. Do not open engineering work on a single user without a new
   signal.

## What the 2026-08-06 event settled, and when to reopen

These facts about Sentry issue `FLASHCARDS-IOS-3Q` are settled; do not
re-derive them.

The event came from an iPad Pro 13-inch (M4) on iOS 26.6, release 1.18.0 build
550, guest workspace, 13 cards, one affected user, `in_foreground: true`,
7.2 GiB usable memory, low power mode off. Its 100 breadcrumbs span 30.3
seconds and contain three ordinary sync cycles, all HTTP 200, every operation
finishing in 3-70 ms.

All sixteen `notification_reconciliation` breadcrumbs end in
`*_skipped_permission`, so that path was a no-op and cannot be the cause. The
earlier "concurrent notification reconciliation fan-out" hypothesis is dead:
the adjacent breadcrumbs are four sequential stages of one reconcile pass, and
the code is already serialised by a generation counter in
`apps/ios/Flashcards/Flashcards/Review/Notifications/FlashcardsStore+ReviewNotifications.swift`.

The final sequence: the user was on the Settings tab, changed a preference via
`PATCH /v1/me/preferences`, the scene went `inactive` then `active` within 0.58
seconds, a foreground sync completed successfully, and the process died at that
instant. No app-hang event accompanied it. The 2026-06-17 event body is past
Sentry's retention window and cannot be compared.

Reopen `FLASHCARDS-IOS-3Q` when any of these appears:

- an event arrives carrying the memory fields above
- the affected user count rises above one
- a `Fatal App Hang Fully Blocked` issue appears for the same release and user

An event on which no app-emitted breadcrumb even *has* the `app_memory_*` keys
came from a build older than the instrumentation and answers nothing. Do not
spend time on it. A current build whose sampling failed is a different signal —
`app_memory_footprint_bytes` and `app_uptime_seconds` empty on every app-emitted
breadcrumb — and is worth a look; `app_memory_available_bytes` and
`thermal_state` are never empty there, so they cannot report a failed sample.
Scan the whole ring buffer before concluding either: SDK network breadcrumbs
never carry the fields, so the last few entries alone do not settle it.
