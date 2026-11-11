# Home Screen Widgets

Cross-client contract for the widget set on the iOS/iPadOS and Android Home Screens and the iOS Lock Screen. See [platform scope](#platform-scope) for Mac. The web client has no widgets.

## Product decisions

- Both platforms offer the same Home Screen widgets, and iOS adds a Lock Screen widget. All are free for everyone, guests included. No Premium gating, no configuration, and no buttons inside a widget.
- Due counts, the next due time, and the Coming up forecast cover the whole workspace selected in the app. Due counts use the same [card eligibility as Review](fsrs-scheduling-logic.md#review-counts).
- Card previews show the next question from the workspace's saved Review filter as plain text. There can be cards due in the workspace even when the saved filter has no card to preview. A widget never shows the answer.
- Progress facts (reviews per day, streaks, the review schedule) are the ones the Progress tab shows; widgets never compute them.

| Widget | Shows | Sizes | Tap opens |
| --- | --- | --- | --- |
| Review | Cards due, the next question, the streak | Small, Medium, Large | Review, with the shown card on Medium and Large |
| Today | Today's reviews, cards left, the streak | Small, Medium | Review |
| Cards due (iOS only) | Cards due, today's progress, the next question | Lock Screen circular, rectangular, inline | Review, with the shown card on rectangular |
| Activity | Daily reviews as a heatmap, the streak | Small, Medium, Large | Progress |
| Year | A year of daily reviews, one row per month | Large | Progress |
| Streaks | Current, best, and recent streaks | Small, Medium | Progress |
| Calendar | This month's streak days | Small, Large | Progress |
| Reviews | Daily reviews compared with the period before | Medium, Large | Progress |
| Coming up | Cards due today and over the next days | Medium, Large | Progress |
| Dashboard | Today's progress, cards due, the streak, the next question, recent activity | Large | Review, with the shown card |

The Review widget's sizes by workspace count:

| Size | Cards due | No cards due |
| --- | --- | --- |
| Small | Due count and streak | "All done", the next due time when known, and the streak |
| Medium | Due count and the next card's question | "All done" and the next due time when known |
| Large | Due count, the next card's question, and the streak | "All done", the next due time when known, and the streak |

Before the app has provided any data, for example on a fresh install, every widget invites the user to open the app, and a widget built on progress does so until progress has loaded. Progress can lag the latest review until the app reloads it. On iOS, once the snapshot is from an earlier day, a widget never shows that day's numbers as today's: it shows today as not yet reviewed or invites the user to open the app.

## Data freshness

- iOS: the extension cannot read the app database, so the app writes a snapshot ([`WidgetShared/`](../apps/ios/Flashcards/WidgetShared/)) with the queue, progress history, forecast, and review schedule into the App Group `group.<bundle id>` and reloads every widget timeline ([`FlashcardsStore+WidgetSnapshot.swift`](../apps/ios/Flashcards/Flashcards/Store/FlashcardsStore+WidgetSnapshot.swift)). It writes a few seconds after the last relevant change while the app is active and at once when the app leaves the foreground ([`RootTabView.swift`](../apps/ios/Flashcards/Flashcards/App/Navigation/RootTabView.swift)), and deletes the snapshot on every cloud-identity reset. The timeline ([`ReviewWidgetTimeline.swift`](../apps/ios/Flashcards/FlashcardsWidget/ReviewWidgetTimeline.swift)) raises the count as cards fall due and rolls the day over at local midnight while the app is closed.
- Android: the widgets run in the app process and read the same local data as Review ([`ReviewWidgetContent.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetContent.kt)) and Progress ([`WidgetProgressContent.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/WidgetProgressContent.kt)). The app re-renders every placed widget when that data changes ([`ReviewWidgetUpdates.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetUpdates.kt)), and the 30-minute system update period in each widget's provider XML (for example [`review_widget_info.xml`](../apps/android/app/src/main/res/xml/review_widget_info.xml)) refreshes them while the app is closed.

## Tap

A tap opens Review or Progress, as the table says. A widget that shows a card passes that card: if the card is still in the selected workspace, eligible under its saved Review filter, and neither on screen nor awaiting its rating, Review starts a new session showing it first, the widget exception in [non-blocking review](fsrs-scheduling-logic.md#non-blocking-review). Otherwise Review opens as it is.

- iOS: the widget opens a `nibomo-widget://` URL ([`WidgetDeepLink.swift`](../apps/ios/Flashcards/WidgetShared/WidgetDeepLink.swift)) that the app routes in `openReviewFromWidget` ([`FlashcardsStore+Review.swift`](../apps/ios/Flashcards/Flashcards/Review/Queue/StoreBridge/FlashcardsStore+Review.swift)) or to the Progress tab. The scheme is deliberately absent from `CFBundleURLTypes`: widget taps reach the app without it, and other apps cannot fake a tap.
- Android: the widget starts an explicit intent with its own action ([`ReviewWidgetTapContract.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetTapContract.kt)), and Review shows the card through `startSessionOnCardForHandoff` ([`ReviewViewModel.kt`](../apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewViewModel.kt)).

Each tap records one `widget_opened` with `widget_size` and `widget_kind` where the app consumes it, as its own event rather than an `app_opened` property. Which widgets are placed is reported as `widget_placement_changed` on a foreground when it changes, one event per widget kind; one without `widget_kind` comes from an older client and counts Review widgets ([`catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)).

## Platform scope

- iOS: Home Screen Small, Medium, and Large, which includes StandBy, and the Lock Screen accessory families; no Extra Large, Control Center, or Watch widget. The extension is embedded only in the iOS/iPadOS build, not in Mac Catalyst; Mac users get the iPhone widgets through Continuity. Widget strings live in [`Widget.xcstrings`](../apps/ios/Flashcards/FlashcardsWidget/Widget.xcstrings) and cover every app locale.
- Android: Glance, in [`app/widget/`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/). Widget strings are English in `values/strings.xml` and translated [Play-first](../apps/android/README.md#localization-rule).

## Before the first iOS release with the widget

Signing needs two Apple Developer registrations for each app bundle ID (`com.flashcards-open-source-app.app` for Release, `com.flashcards-open-source-app.app.development` for Debug):

1. The App Group `group.<bundle id>`, enabled on the `<bundle id>` App ID.
2. The App ID `<bundle id>.widgets`, with the same App Group enabled.

Automatic signing creates both when it may update provisioning: `-allowProvisioningUpdates` with a team locally ([local App Store archive](ios-local-setup.md#local-app-store-archive)), managed signing in Xcode Cloud. Then confirm the signed Release archive carries the group on both bundles: `codesign -d --entitlements - <archive>/Products/Applications/<app>.app` and the same for `<app>.app/PlugIns/Flashcards Widget.appex` must list `group.com.flashcards-open-source-app.app`.
