# Home Screen Widget

Cross-client contract for the Review widget on the iOS/iPadOS and Android Home Screens. The web client has no widget.

## Product decisions

- One widget per platform in three sizes, free for everyone, guests included. No Premium gating, no configuration, and no buttons inside the widget.
- The due count is the Review tab badge count, and the next card is the card Review shows next, both under the saved Review filter of the workspace selected in the app.
- The widget shows the next card's question as plain text and never its answer.

| Size | Cards due | No cards due |
| --- | --- | --- |
| Small | Due count and streak | "All done", the next due time when known, and the streak |
| Medium | Due count and the next card's question | "All done" and the next due time when known |
| Large | Due count, the next card's question, and the streak | "All done", the next due time when known, and the streak |

Before the app has provided any data, for example on a fresh install, every size invites the user to open the app. The streak is hidden until progress has loaded and may stay stale until the app runs again; the widget never computes it.

## Data freshness

- iOS: the extension cannot read the app database, so the app writes a snapshot ([`WidgetShared/`](../apps/ios/Flashcards/WidgetShared/)) into the App Group `group.<bundle id>` and reloads the widget timeline ([`FlashcardsStore+WidgetSnapshot.swift`](../apps/ios/Flashcards/Flashcards/Store/FlashcardsStore+WidgetSnapshot.swift)). It writes a few seconds after the last relevant change while the app is active and at once when the app leaves the foreground ([`RootTabView.swift`](../apps/ios/Flashcards/Flashcards/App/Navigation/RootTabView.swift)), and deletes the snapshot on every cloud-identity reset. The snapshot carries later due times, so the timeline ([`ReviewWidgetTimeline.swift`](../apps/ios/Flashcards/FlashcardsWidget/ReviewWidgetTimeline.swift)) raises the count as cards fall due while the app is closed.
- Android: the widget runs in the app process and reads the same local data as Review ([`ReviewWidgetContent.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetContent.kt)). The app re-renders placed widgets when that data changes ([`ReviewWidgetUpdates.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetUpdates.kt)), and the 30-minute system update period ([`review_widget_info.xml`](../apps/android/app/src/main/res/xml/review_widget_info.xml)) refreshes it while the app is closed.

## Tap

A tap opens Review. A Medium or Large widget that shows a card passes that card: if it is still in review (due or new, in the filter, not deleted, not awaiting its rating) in the same workspace and is not already on screen, Review starts a new session showing it first, the widget exception in [non-blocking review](fsrs-scheduling-logic.md#non-blocking-review). Otherwise, and always for Small, Review opens as it is.

- iOS: the widget opens a `nibomo-widget://` URL ([`WidgetDeepLink.swift`](../apps/ios/Flashcards/WidgetShared/WidgetDeepLink.swift)) that the app routes in `openReviewFromWidget` ([`FlashcardsStore+Review.swift`](../apps/ios/Flashcards/Flashcards/Review/Queue/StoreBridge/FlashcardsStore+Review.swift)). The scheme is deliberately absent from `CFBundleURLTypes`: widget taps reach the app without it, and other apps cannot fake a tap.
- Android: the widget starts an explicit intent with its own action ([`ReviewWidgetTapContract.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/ReviewWidgetTapContract.kt)), and Review shows the card through `startSessionOnCardForHandoff` ([`ReviewViewModel.kt`](../apps/android/feature/review/src/main/java/com/flashcardsopensourceapp/feature/review/ReviewViewModel.kt)).

Each tap records one `widget_opened` with `widget_size` where the app consumes it, as its own event rather than an `app_opened` property, and which widgets are placed is reported as `widget_placement_changed` on a foreground when it changes ([`catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)).

## Platform scope

- iOS: Home Screen Small, Medium, and Large only, which includes StandBy; no Lock Screen, Extra Large, Control Center, or Watch widget. The extension is embedded only in the iOS/iPadOS build, not in Mac Catalyst; Mac users get the iPhone widget through Continuity. Widget strings live in [`Widget.xcstrings`](../apps/ios/Flashcards/FlashcardsWidget/Widget.xcstrings) and cover every app locale.
- Android: Glance, in [`app/widget/`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/widget/). Widget strings are English in `values/strings.xml` and translated [Play-first](../apps/android/README.md#localization-rule).

## Before the first iOS release with the widget

Signing needs two Apple Developer registrations for each app bundle ID (`com.flashcards-open-source-app.app` for Release, `com.flashcards-open-source-app.app.development` for Debug):

1. The App Group `group.<bundle id>`, enabled on the `<bundle id>` App ID.
2. The App ID `<bundle id>.widgets`, with the same App Group enabled.

Automatic signing creates both when it may update provisioning: `-allowProvisioningUpdates` with a team locally ([local App Store archive](ios-local-setup.md#local-app-store-archive)), managed signing in Xcode Cloud. Then confirm the signed Release archive carries the group on both bundles: `codesign -d --entitlements - <archive>/Products/Applications/<app>.app` and the same for `<app>.app/PlugIns/Flashcards Widget.appex` must list `group.com.flashcards-open-source-app.app`.
