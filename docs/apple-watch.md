# Apple Watch App

The watchOS 26+ companion app embedded in the iOS app: Review on the wrist for a signed-in iPhone account. It is not embedded in Mac Catalyst.

## Product decisions

- Review only: the due count, the next card's question, Show answer, and the four ratings. No card editing, Progress, AI, or settings.
- Signed in only. The watch never signs in on its own and has no guest mode: it takes the account the iPhone app is signed in to. An iPhone app that is signed out, a guest, or on a custom server leaves the watch asking the user to open Nibomo on iPhone.
- The workspace and the saved Review filter are the iPhone's; the watch has no switcher.
- Cards are plain text. An image or formula is left out with an "Open on iPhone" note under that card side ([`WatchReviewCardText.swift`](../apps/ios/Flashcards/FlashcardsWatch/Review/WatchReviewCardText.swift)).
- No complications, watch notifications, or Sign in with Apple in this version. iPhone review reminders reach the watch through the system's notification forwarding.

## How the parts combine

- The watch is its own installation with its own local database and workspace replica ([sync identity model](sync-identity-model.md)), and it syncs directly with the API through the shared sync engine. It reports platform `ios` with `os_name` `watchos` and `device_type` `watch` ([`0238`](../db/migrations/0238_watchos_os_name_watch_device_type.sql)).
- WatchConnectivity carries only the sign-in handoff: the watch asks, and the iPhone answers with its tokens, user, workspace, and Review filter. The contract is [`WatchHandoffMessage.swift`](../apps/ios/Flashcards/WatchShared/WatchHandoffMessage.swift), the iPhone side [`WatchHandoff/`](../apps/ios/Flashcards/Flashcards/WatchHandoff/), and the watch side [`WatchConnectivityClient.swift`](../apps/ios/Flashcards/FlashcardsWatch/Session/WatchConnectivityClient.swift).
- [`WatchSessionModel.swift`](../apps/ios/Flashcards/FlashcardsWatch/Session/WatchSessionModel.swift) asks on launch and on every foreground, waiting up to 20 s for the reply, and applies it: an unreachable iPhone keeps the stored session, so review continues offline; a switch of account or workspace waits while pending ratings can still sync after a retryable failure; a workspace switch by the same user keeps the installation; an iPhone sign-out wipes the watch.
- [`WatchReviewModel.swift`](../apps/ios/Flashcards/FlashcardsWatch/Review/WatchReviewModel.swift) runs Review on the shared queue runtime, scheduler, and submission path, under [non-blocking review](fsrs-scheduling-logic.md#non-blocking-review).
- The watch target compiles shared iOS sources through target membership, not a package: the list is the `Exceptions for "Flashcards" folder in "Flashcards Watch" target` set in [`project.pbxproj`](../apps/ios/Flashcards/Flashcards%20Open%20Source%20App.xcodeproj/project.pbxproj). A new file the watch needs from `Flashcards/` must be added there.
- The watch refreshes its ID token with the iPhone's refresh token; see the rotation comment in [`auth.ts`](../infra/aws/lib/auth.ts) before enabling refresh-token rotation.
- Watch-only strings live in [`Watch.xcstrings`](../apps/ios/Flashcards/FlashcardsWatch/Watch.xcstrings).

Known limits: indented code blocks and fences nested in lists or blockquotes may lose their verbatim text on the watch, and failure screens built from a database, configuration, or sync error show its English text.

## Try it in the simulator

The build needs `Config/Local.xcconfig` ([after cloning](ios-local-setup.md#after-cloning)); `DEVELOPMENT_TEAM` only for a physical watch. Simulator runs are marked as automation ([automation marker](ios-ci-cd.md#automation-marker)). From the repository root, with runtime IDs and device type names from `xcrun simctl list runtimes` and `xcrun simctl list devicetypes`:

```bash
export PHONE=$(xcrun simctl create "Nibomo iPhone" "iPhone 18 Pro" <ios-runtime-id>)
export WATCH=$(xcrun simctl create "Nibomo Watch" "Apple Watch Series 12 (46mm)" <watchos-26-or-later-runtime-id>)
xcrun simctl pair "$WATCH" "$PHONE"
xcrun simctl boot "$PHONE" && xcrun simctl boot "$WATCH" && open -a Simulator

xcodebuild \
  -project "apps/ios/Flashcards/Flashcards Open Source App.xcodeproj" \
  -scheme "Flashcards Open Source App" -configuration Debug \
  -destination "platform=iOS Simulator,id=$PHONE" \
  -derivedDataPath tmp/ios-derived-data \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
APP="tmp/ios-derived-data/Build/Products/Debug-iphonesimulator/Flashcards Open Source App.app"
xcrun simctl install "$PHONE" "$APP"
xcrun simctl install "$WATCH" "$APP/Watch/Flashcards Watch.app"
xcrun simctl launch "$PHONE" com.flashcards-open-source-app.app.development
xcrun simctl launch "$WATCH" com.flashcards-open-source-app.app.development.watchkitapp
xcrun simctl spawn "$PHONE" log show --last 5m --predicate 'category == "automation_run"'
xcrun simctl spawn "$WATCH" log show --last 5m --predicate 'category == "automation_run"'
```

Before interacting, each of the two `log show` commands must print an `event=automation_run_decided isAutomation=true` line; without it, the run is not test evidence.

In Xcode instead: run the "Flashcards Open Source App" scheme on the paired iPhone, then the "Flashcards Watch" scheme on "<watch> via <iPhone>".

Manual test:

1. With the iPhone app signed out, open the watch app: it shows "Open Nibomo on iPhone".
2. Sign in on the iPhone and keep its app open, then tap Retry on the watch: "Connecting to iPhone…", "Syncing cards…", then the due count and a card.
3. Show the answer and rate a few cards; rate one Again and see it return when due.
4. A card with an image or formula shows the "Open on iPhone" note.
5. On the iPhone, the rated cards leave the due count after its next sync.
6. Change the Review filter or workspace on the iPhone, then bring the watch app back to the foreground: it follows.
7. Sign out on the iPhone and bring the watch app back to the foreground: it shows "Open Nibomo on iPhone" again.

Delete the pair afterwards with `xcrun simctl shutdown "$WATCH"; xcrun simctl shutdown "$PHONE"; xcrun simctl delete "$WATCH" "$PHONE"` and remove `tmp/ios-derived-data`.

## Before the first iOS release with the watch app

1. Signing needs the App ID `<bundle id>.watchkitapp` for each app bundle ID (`com.flashcards-open-source-app.app` for Release, `com.flashcards-open-source-app.app.development` for Debug). Automatic signing creates it as it does the [widget App IDs](home-screen-widgets.md#before-the-first-ios-release-with-the-widget).
2. Add Apple Watch screenshots to the listing in App Store Connect.
3. Confirm the signed archive carries the watch app and its privacy manifest: `<archive>/Products/Applications/Flashcards Open Source App.app/Watch/Flashcards Watch.app/PrivacyInfo.xcprivacy` must exist.
4. On the first TestFlight upload, watch for an ITMS-91053 "Missing API declaration" email about the watch bundle. The shared [`PrivacyInfo.xcprivacy`](../apps/ios/Flashcards/Flashcards/PrivacyInfo.xcprivacy) declares UserDefaults and FileTimestamp only, while the watch compiles [`MemoryDiagnostics.swift`](../apps/ios/Flashcards/Flashcards/Observability/MemoryDiagnostics.swift), which reads `ProcessInfo.systemUptime`; if flagged, add `NSPrivacyAccessedAPICategorySystemBootTime` with reason `35F9.1`.
