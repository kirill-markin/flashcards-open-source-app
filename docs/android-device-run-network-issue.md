# Device Run network issue and recovery

The 1.35.0 release investigation reproduced intermittent Device Run
physical-device network timeouts. The retained native evidence does not
independently isolate app transport, OkHttp, AWS, or Google as the cause.
The [recovery verification](#recovery-verification) below passed.

## Reproduction and limits

- During that investigation, real sign-in/sync runs intermittently timed out
  awaiting response headers. Instrumented attempts show approximately 30-second HTTP/2 timeouts across
  different connections; server-side successful requests do not establish that
  a timed-out client received a response.
- The manual [protocol probe](../apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/diagnostics/HttpProtocolProbeTest.kt)
  reproduced timeouts without app authentication, sync, or Sentry: a physical
  API 37 execution passed 10/12 HTTP/1.1 requests and 4/12 HTTP/2 requests.
  The exact APKs passed all 24 requests locally in 3.802 seconds.
- The independent [stack controls](../apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/diagnostics/HttpStackControlTest.kt)
  reproduced AWS endpoint timeouts through platform `HttpsURLConnection` as
  well as raw OkHttp while Google connectivity controls passed in the same
  physical execution. This narrows the symptom but does not isolate its owner.
- Public API/source references: published [OkHttp 5.5.0 Android sources](https://repo.maven.apache.org/maven2/com/squareup/okhttp3/okhttp-android/5.5.0/okhttp-android-5.5.0-sources.jar),
  Android [HttpsURLConnection](https://developer.android.com/reference/javax/net/ssl/HttpsURLConnection),
  and Google's [Device Run result layout](https://docs.cloud.google.com/developer-device-platform/device-run/find-logs).
  Aggregate findings above come from retained private native evidence, not
  those vendor documents. Keep raw logs, identifiers and credentials private.

## Recovery verification

Google's Omnilab team reported recovery of the Atlanta lab's transit and Wi-Fi
egress on November 2, 2026. November 4 reruns rebuilt the original reproduction
source, `99525ea3009c2499cfc2d2f5c32bc51b9018d644`, on physical Pixel 11 devices
running Android 17 / API 37:

- [Protocol and stack controls](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/41789641935):
  all 6 named tests and 48 requests passed, with expected statuses, complete
  response bodies and no exceptions. Both HTTP/1.1 and HTTP/2 passed, as did
  platform HTTPS and Google controls.
- [App smoke selection](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/41790646660):
  all 7 named tests passed, including account linking, sync, card creation and
  review, progress reset and guest AI flows.

Private archive and submitted APK hashes, session/job/execution success, named
JUnit results and physical-device automation markers were verified. No selected
case was missing, duplicated or skipped. The retained reports and logs do not
expose the allocated lab or host, so these passes do not independently establish
the exact Atlanta route or the network failure's mechanism.

## Release acceptance

The original report is [Google issue 574921431](https://issuetracker.google.com/issues/574921431).
Follow the required sessions and other gates in [the Android release procedure](release/android.md), with complete named results
under [release result verification](android-ci-cd.md#device-run-results-and-release-correlation).
These diagnostic selections do not replace release acceptance. Preserve historical
failures, skips and readiness records.
