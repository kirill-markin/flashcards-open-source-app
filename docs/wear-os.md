# Wear OS App

The Wear OS 5+ companion of the Android app: Review on the wrist for a signed-in phone account. It ships under the phone's Play listing as its own watch bundle.

## Product decisions

The product decisions match the [Apple Watch app](apple-watch.md#product-decisions), with "phone" in place of "iPhone". The Wear-only differences:

- The watch asks the user to "Open Nibomo on your phone".
- Wear OS 5+ (`minSdk = 34` in [`wear/build.gradle.kts`](../apps/android/wear/build.gradle.kts)).
- Not standalone (`com.google.android.wearable.standalone` is `false` in the [manifest](../apps/android/wear/src/main/AndroidManifest.xml)): the watch app needs the phone app.
- No Sentry and no product analytics on the watch; observations go to logcat only ([`WearAppGraph.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/WearAppGraph.kt)).

## How the parts combine

- The watch is its own installation with its own local database and workspace replica ([sync identity model](sync-identity-model.md)), and it syncs directly with the official API through the shared `:data:local` sync engine, reporting `device_type` `watch`.
- The Wearable Data Layer carries only the sign-in handoff, and it connects only apps with the same application id and signing key: the watch sends an RPC to the phone node advertising the handoff capability, and the phone answers with its tokens, user, workspace, and Review filter. The contract is [`WatchHandoffContract.kt`](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/watch/WatchHandoffContract.kt), the phone side [`WatchHandoffListenerService.kt`](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/watch/WatchHandoffListenerService.kt) with [`WatchHandoffReplyBuilder.kt`](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/watch/WatchHandoffReplyBuilder.kt), and the watch side [`WearHandoffClient.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/handoff/WearHandoffClient.kt).
- [`WearSessionViewModel.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/session/WearSessionViewModel.kt) asks on launch and on every resume and applies the reply with the same rules as the Apple Watch session; its screens are [`WearRootScreen.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/ui/WearRootScreen.kt).
- [`WearReviewViewModel.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/review/WearReviewViewModel.kt) runs Review on the shared queue and submission path, under [non-blocking review](fsrs-scheduling-logic.md#non-blocking-review); [`WearReviewScreen.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/review/WearReviewScreen.kt) and [`WearReviewCardText.kt`](../apps/android/wear/src/main/java/com/flashcardsopensourceapp/wear/review/WearReviewCardText.kt) render it.
- The watch takes its version name and languages from `:app`. The `Android Release` workflow's `publish_wear_android` job ([`android-release.yml`](../.github/workflows/android-release.yml)) uploads the watch bundle as a `wear:production` draft after the phone draft. One-time Play setup: [Wear OS opt-in](android-ci-cd.md#one-time-play-console-setup).
- Watch-only strings live in [`wear/src/main/res/values/strings.xml`](../apps/android/wear/src/main/res/values/strings.xml) and follow the Android [Play-first localization rule](../apps/android/README.md#localization-rule).

## Try it in the emulator

1. In Android Studio's Device Manager, create a phone AVD from an API 37 Google Play system image and a Wear OS AVD from the latest Wear OS system image with a round screen, and confirm `hw.lcd.circular=true` in the watch AVD's `config.ini` (`~/.android/avd/<name>.avd/`; set it if missing, or the screen renders square). Start both and stop every other emulator, so `adb devices` lists only the two.
2. Pair them with Device Manager's *Pair Wearable* (the Wear OS pairing assistant). It installs the Wear OS companion app from Play Store on the phone, so the phone needs a Google account signed in to Play Store.
3. From `apps/android/`, build and install both debug apps. They must come from the same checkout and machine, so they share the debug signing key the Data Layer requires. A release build already on either device blocks the install; remove it with `adb -s <serial> uninstall com.flashcardsopensourceapp.app`.

   ```bash
   ./gradlew :app:assembleDebug :wear:assembleDebug
   adb -s <phone-serial> install -r app/build/outputs/apk/debug/app-debug.apk
   adb -s <watch-serial> install -r wear/build/outputs/apk/debug/wear-debug.apk
   ```

4. Launch each app once and check that logcat on each prints `event=automation_environment_resolved isAutomation=true` (`adb -s <serial> logcat -d -s AutomationEnvironment`). An emulator marks itself; without that line, the run is not test evidence.

Manual test:

1. With the phone app signed out, open the watch app: it shows "Open Nibomo on your phone".
2. Sign in on the phone, put the phone app in the background, kill its process (`adb -s <phone-serial> shell am kill com.flashcardsopensourceapp.app`), then tap Retry on the watch: "Connecting to phone…", "Syncing cards…", then a card. The phone must answer from a cold start.
3. Scroll a long question, then show the answer and scroll to its end. Check that the system time is visible, that Show answer and the four ratings stay docked while scrolling, and that on a round screen the docked Show answer button and the outer corners of the rating grid are not clipped. Rate a few cards; rate one Again and see it return when due.
4. A card with an image or formula shows the "Open on your phone to see the image or formula" note.
5. On the phone, the rated cards leave the due count after its next sync.
6. Change the Review filter or workspace on the phone, then bring the watch app back to the foreground: it follows.
7. Sign out on the phone and bring the watch app back to the foreground: it shows "Open Nibomo on your phone" again.

## Before the first Android release with the watch app

Complete the [one-time Play Console setup](android-ci-cd.md#one-time-play-console-setup) step for the Wear OS form factor and Wear OS screenshots.
