# Known Device Run network issue

Device Run physical-device networking is unreliable in the 1.35.0 release
investigation. Root cause and ownership remain unproved; this is not evidence
that app transport, OkHttp, AWS, or Google alone is responsible.

## Reproduction and limits

- Real sign-in/sync runs intermittently time out awaiting response headers.
  Instrumented attempts show approximately 30-second HTTP/2 timeouts across
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

## Standing known-issue procedure

Track the vendor report at [Google issue 574921431](https://issuetracker.google.com/issues/574921431). Ownership remains unknown. Apply the [standing best-effort release policy](release/README.md#standing-best-effort-release-policy) to future releases while the issue remains unresolved and there is no material new evidence. Reuse the bounded diagnosis above; no new owner decision, unavailable physical evidence or repeated blind probes are required each release.

Dispatch `Android Release` with `known_device_run_network_exception=true` only
when preflight selects this known-issue route. It defaults to false. The exception skips all four
physical sessions as `waived_not_executed`; it does not pass them, repair earlier
failures, or produce a green mobile-readiness result. Retain the run's
`android-device-run-policy-r<runId>a<attempt>` artifact and visible summaries.
Normal dispatch still requires four passing sessions and complete named results.

Before publication, retain a separate dated operator readiness decision with
the standing-policy reference, exact source/run/attempt/version/code/AAB hash,
failed/skipped history, best-effort full latest-OS local native results and
feasible compatibility checks, applicable API 30 walkthrough results or coverage gaps,
and exact Play-delivered candidate/translation verification. Local success is
bounded evidence, not a physical-device pass. CI/build/lint/local-data gates,
security/warning policy, signing, R8, managed publishing and publisher guards
remain mandatory. Public production availability at the chosen rollout scope
is still required by [Android release completion](release/android.md).

Preserve all original failures and skips and the readiness CLI's unchanged
contract/report. Recheck physical networking on provider remediation or
materially new evidence; avoid unchanged expensive reruns or speculative app
transport changes. Fix identifiable app/test defects and actionable failures under the standing policy.
