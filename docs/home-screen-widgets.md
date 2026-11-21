# Home Screen Widgets

Cross-client contract for the widget set on the iOS/iPadOS and Android Home Screens and the iOS Lock Screen. See [platform scope](#platform-scope) for Mac. The web client has no widgets.

## Product decisions

- Both platforms offer the same Home Screen widgets, and iOS adds a Lock Screen widget. All are free for everyone, guests included. No Premium gating and no configuration.
- Widgets are read-only.
- Due counts, the next due time, and the Coming up forecast cover the whole workspace selected in the app. Due counts use the same [card eligibility as Review](fsrs-scheduling-logic.md#review-counts).
- Card previews show the next question from the workspace's saved Review filter as plain text; the Question widget rotates through the first 6 cards of that queue at 06:00, 12:00, 16:00, and 20:00 local time. There can be cards due in the workspace even when the saved filter has no card to preview. A widget never shows the answer.
- Progress facts (reviews per day, streaks, the review schedule, records, timing) are the ones the Progress tab shows. Widgets compute only two things from them: the pace against the user's usual, with the same function as Progress ([`reviewPace.ts`](../apps/web/src/progress/reviewPace.ts) and its iOS and Android ports), and cards due × seconds per due card.
- Pace compares the last 7 local days with your own daily average over the preceding 28 days. The preceding window starts on its first day with reviews. The comparison requires at least 14 days of history in the combined window and 14 reviews in the baseline. One lap of the ring matches that average, and the ring shows up to two laps.
- Progress counts a card as relearned if you rated it Hard, Good, or Easy in the last 7 local days and rated it Again on the previous day you reviewed that card. Each card counts once.
- Minutes measure effort, never a grade: they come from the gaps between ratings on each device ([`insights.ts`](../apps/backend/src/progress/reports/loaders/insights.ts)) and stay hidden at 0 or without enough timed reviews.

| Widget | Shows | Sizes | Body tap opens |
| --- | --- | --- | --- |
| Review | Cards to review and due, the next question, minutes to clear, the streak | Small, Medium, Large | Review, with the shown card on Medium and Large |
| Question | A question from the next few cards; cards due on larger sizes | Small, Medium (Android also Large) | Review, with the shown card |
| Today | The last 7 days against your usual, today's reviews, cards due, the streak; Medium adds minutes or the best day | Small, Medium | Review |
| Cards due (iOS only) | The last 7 days, cards to review and due, the next question | Lock Screen circular, rectangular, inline | Review, with the shown card on rectangular |
| Activity | Daily reviews as a heatmap, the streak | Small, Medium, Large | Progress |
| Year | A year of daily reviews, one row per month | Large | Progress |
| Streaks | Current and best streak, freezes, the last 7 days | Small, Medium | Progress |
| Calendar | This month's streak days | Small, Large | Progress |
| Reviews | Daily reviews of the last 7 days against your usual | Medium, Large | Progress |
| Coming up | Cards due today and over the next days | Medium, Large | Progress |
| Dashboard | The last 7 days against your usual, cards to review and due, the streak, the next question, 30-day reviews and active days | Large | Review, with the shown card |

The Review widget's sizes by workspace count:

| Size | Cards to review | Nothing to review |
| --- | --- | --- |
| Small | To-review and due counts, the streak | "All done", the next due time when known, and the streak |
| Medium | To-review count, the next card's question, due count, minutes | "All done" and the next due time when known |
| Large | Medium plus the new count and the streak | "All done", the next due time when known, and the streak |

To review counts due and new cards. With new cards left and none due, the layout stays and shows 0 due.

Before the app has provided any data, for example on a fresh install, every widget invites the user to open the app, and a widget built on progress does so until progress has loaded. Progress can lag the latest review until the app reloads it. On iOS, once the snapshot is from an earlier day, a widget never shows that day's numbers as today's: it shows today as not yet reviewed or invites the user to open the app.

## Data freshness

- iOS: the extension cannot read the app database, so the app writes a snapshot ([`WidgetShared/`](../apps/ios/Flashcards/WidgetShared/)) with the queue, progress history, forecast, and review schedule into the App Group `group.<bundle id>` and reloads every widget timeline ([`FlashcardsStore+WidgetSnapshot.swift`](../apps/ios/Flashcards/Flashcards/Store/FlashcardsStore+WidgetSnapshot.swift)). It writes a few seconds after the last relevant change while the app is active and at once when the app leaves the foreground ([`RootTabView.swift`](../apps/ios/Flashcards/Flashcards/App/Navigation/RootTabView.swift)), and deletes the snapshot on every cloud-identity reset. The timeline ([`ReviewWidgetTimeline.swift`](../apps/ios/Flashcards/FlashcardsWidget/ReviewWidgetTimeline.swift)) raises the count as cards fall due and rolls the day over at local midnight while the app is closed.
- Android: the widgets run in the app process and read the same local data as Review ([`ReviewWidgetContent.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetContent.kt)) and Progress ([`WidgetProgressContent.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/WidgetProgressContent.kt)). The app re-renders every placed widget when that data changes ([`ReviewWidgetUpdates.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetUpdates.kt)), and the 30-minute system update period in each widget's provider XML (for example [`review_widget_info.xml`](../apps/android/app/src/main/res/xml/review_widget_info.xml)) refreshes them while the app is closed.

## Tap

The widget body opens the destination in the table. An eligible card that differs from the one already shown starts a new Review session on its question. A body tap for the card already shown keeps the current session and side.

Review (Medium and Large), Question, and Dashboard offer **Reveal answer** when they show a question. On Android, Small Question uses an eye button with the localized label for accessibility. The button opens Review with the shown card's answer positioned for reading.

For either tap, a card target must be in the selected workspace, match its saved Review filter, be new or due, and have no pending rating. A stale or unavailable target opens ordinary Review.

- iOS: widget taps use private [`nibomo-widget://` URLs](../apps/ios/Flashcards/WidgetShared/WidgetDeepLink.swift). The button is a SwiftUI `Link` to `nibomo-widget://review-answer`. The scheme stays unregistered in `CFBundleURLTypes`.
- Android: widget taps launch the app with an [explicit intent](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetTapContract.kt). The button uses a distinct intent action.

Each tap records one `widget_opened` with `widget_size` and `widget_kind` where the app consumes it. Which widgets are placed is reported as `widget_placement_changed` on a foreground when it changes, one event per widget kind; one without `widget_kind` comes from an older client and counts Review widgets ([`catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)).

## Platform scope

- iOS: Home Screen Small, Medium, and Large, which includes StandBy, and the Lock Screen accessory families; no Extra Large, Control Center, or Watch widget. The extension is embedded only in the iOS/iPadOS build, not in Mac Catalyst; Mac users get the iPhone widgets through Continuity. Widget strings live in [`Widget.xcstrings`](../apps/ios/Flashcards/FlashcardsWidget/Widget.xcstrings) and cover every app locale.
- Android: Glance, in [`app/widget/`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/). Widget strings are English in `values/strings.xml` and translated [Play-first](../apps/android/README.md#localization-rule).

## Before the first iOS release with the widget

Signing needs two Apple Developer registrations for each app bundle ID (`com.flashcards-open-source-app.app` for Release, `com.flashcards-open-source-app.app.development` for Debug):

1. The App Group `group.<bundle id>`, enabled on the `<bundle id>` App ID.
2. The App ID `<bundle id>.widgets`, with the same App Group enabled.

Automatic signing creates both when it may update provisioning: `-allowProvisioningUpdates` with a team locally ([local App Store archive](ios-local-setup.md#local-app-store-archive)), managed signing in Xcode Cloud. Then confirm the signed Release archive carries the group on both bundles: `codesign -d --entitlements - <archive>/Products/Applications/<app>.app` and the same for `<app>.app/PlugIns/Flashcards Widget.appex` must list `group.com.flashcards-open-source-app.app`.
