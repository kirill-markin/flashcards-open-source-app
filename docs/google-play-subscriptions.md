# Google Play subscriptions

Human setup and handoff for Android billing. Product decisions live in
[Premium offer](premium-offer.md), access and ownership rules in
[Premium entitlements](premium-entitlements.md), and catalog IDs and all 51
Google Play locales in [Subscription store metadata](subscription-store-metadata.md#google-play).

## Readiness

Verified snapshot as of 2026-10-04; federation readback at 06:47:38 UTC.
Android billing and the backend are implemented; production acceptance remains
incomplete. The passing CI bundle is available to internal testers and the catalog
is active; genuine Play purchase acceptance and public production rollout remain pending.
Record later outcomes with their evidence and timestamp before updating a gate.

| State | Readback |
| --- | --- |
| Console setup saved | SAMO DANNI EOOD merchant setup and 15% service-fee enrollment, app-scoped billing permissions, license testing and restricted AWS federation are saved. Company EUR bank verification remains pending. |
| Backend deployed | [AWS run 37130395075](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37130395075) succeeded in all 10 jobs, including migrations, deployment and smoke gates. Its platform/web/admin SSM deployment markers read `01d6cc2e7c98693bde8ac9bcdb8ed43ab0050bde`. The live Google reconciliation rule in `eu-central-1` is `ENABLED` with `rate(15 minutes)`. |
| Federation and negative probe verified | Provider `aws-backend` in `nibomo-aws-billing` is ACTIVE with the normalized subject below; the exact AWS account/BackendHandler condition and attribute-based service-account grant are unchanged, with the same policy etag. The October 3 probe failed at STS HTTP 400 before Publisher; an opaque account ID alone proves no Google authentication. The October 4 probe recorded STS HTTP 200, then an actual Publisher `subscriptionsv2.get` HTTP 400 for a deliberately invalid token, demonstrating impersonation sufficient to call Publisher. Genuine purchase, Restore and acknowledgment acceptance remain pending. This external configuration repair has no Lambda release/commit boundary; the documentation commit is not a runtime fix. |
| Android candidate verified | Candidate `9073c12f7ad75723b3993c79b6e41a096b27fbae` ([PR 2243](https://github.com/kirill-markin/flashcards-open-source-app/pull/2243)) passed [PR Checks 37182381237](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37182381237) and [Android CI 37182780393](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37182780393). Local CI parity passed in 4m 7s; optimized signed `validationRelease` passed in 3m 53s. Full LiveSmoke passed at 06:46:42 UTC: 7 passed, 0 failed, 0 skipped, 6m 21s. Its validation AAB version code 1 is not publishable. |
| Release passed; production draft only | [Android Release 37183902617](https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/37183902617) passed all GitHub jobs for `9073c12f7ad75723b3993c79b6e41a096b27fbae`. The Play API accepted version `1.29.0`, code `23870952`, as production draft `main-draft-vc23870952-r37183902617a1-s9073c12f`; it is not submitted or publicly published. The earlier Croatian translation upload failure did not recur. |
| Firebase result verified | Actual matrix `matrix-kwf46fn1wqq0a` on Pixel 11 (`cubs`)/API 37 finished `SUCCESS`: 82 passed, 0 failed, 82 total, including both formerly failing workspace cases. [Firebase results](https://console.firebase.google.com/project/flashcards-open-source-app/testlab/histories/bh.f2d5f1386dbab916/matrices/5632459922240459317) correlate with the release run/SHA; test duration was 836 seconds, processing 32 seconds. Submission success alone is not a passing matrix. |
| Internal release published | `test-vc23870952-r37183902617a1-s9073c12f` contains only code `23870952` and 51 release notes; the paused track was resumed and its latest release reads Available to internal testers. Catalog setup is unlocked. Failed candidate `23866012` was superseded, not published. |
| Publishable artifact verified | The CI-signed AAB is 21,098,266 bytes, SHA-256 `b84c079be1125d889d4d5954688a433ba3a92166fd857df35564eea8887e53c1`. The original registered upload certificate is preserved without reset. The local validation bundle is not publishable. |
| Catalog active | `premium` has all 51 locales from [store metadata](subscription-store-metadata.md#google-play-texts): Name, Benefit 1 (1000 AI messages per month), and Description; all 153 field values matched after browser reload. Base plan `monthly` and offer `free-trial-7d` were reopened and verified ACTIVE. Device product details, offer token and pricing phases remain unverified. |
| Monthly settings verified | Monthly auto-renewal covers 175 countries/regions, with new countries/regions included. USD 6.99 base generated US USD 6.99, Bulgaria/Germany EUR 7.49, UK GBP 6.49 and India INR 790.00 through Play conversion, rounding and taxes. Grace is 7 days; automatically calculated account hold is 53 days (60 combined). Base-plan/offer changes charge at next billing date; resubscribe is allowed. No annual/lifetime sales. |
| Trial settings verified | `free-trial-7d` covers all 175 base-plan regions: one seven-day free-trial phase, then the base plan. New customer acquisition uses Google's “Never had this subscription” (`premium`) eligibility; no developer-determined eligibility or additional discount phases. |
| Notifications verified for test delivery | Authenticated Push and the resource-only Token Creator grant are saved. Play's official test reached BackendHandler at 2026-10-03 17:18:40.819 UTC and was processed/acknowledged. Unsigned requests return HTTP 401 `GOOGLE_PUSH_UNAUTHORIZED`. Real purchase lifecycle delivery remains pending. |
| Console translations reviewed | App Strings covers 49 languages, with automatic translation ON. On October 4, 47 Premium rows were reviewed and three timing/quota errors corrected in Croatian, Tamil and Kannada. This is not verification of translations delivered by the native app. |
| Privacy published; Data Safety in review | Privacy and account-deletion pages are published. Publishing overview lists only App content / Data Safety as IN REVIEW; no new production version is in review. See [Privacy and reviewer access](#privacy-and-reviewer-access) for privacy deployment evidence. |
| Store acceptance pending | The Play emulator is running with an empty Google login form; owner login and the device/tester account match remain pending. No Play-installed billing candidate or completed purchase matrix is recorded. Complete the gates below before requesting public sales. |

## Implemented contract and source

The offer is Premium: 1000 platform-key AI messages per UTC calendar month,
USD 6.99/month base price, and a Google-controlled seven-day trial. Prices and
eligible phases displayed on Android come from Play. This work does not sell
annual/lifetime products; existing lifetime gifts and highest-rank entitlement
resolution remain intact.

| Boundary | Source and contract |
| --- | --- |
| Authenticated account and purchase API | [Routes](../apps/backend/src/routes/googleBilling.ts): `GET /v1/billing/google/account` returns `{ obfuscatedAccountId }`; `POST /v1/billing/google/purchases` takes `{ purchaseToken, intent }`, with required `explicit` or `passive` intent. Guest, Bearer and Session authentication are supported. |
| Ownership and acknowledgment | [Service](../apps/backend/src/billing/google/service.ts), [store](../apps/backend/src/billing/google/store.ts), and [provider](../apps/backend/src/billing/google/provider.ts) verify authoritative Play state and linked tokens, persist ownership, acknowledge completed purchases and read back acknowledgment. Explicit purchase/Restore attaches to the current authenticated identity; passive startup/resume/replay preserves an attached owner. |
| Android completion and recovery | [Connector](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/store/GooglePlaySubscriptionConnector.kt) and [repository](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/billing/GooglePlayBillingRepository.kt) persist pending verification and require a fresh synced entitlement. `{ attached: true }` is a processing receipt, not permission to unlock Premium. |
| Native offer and Settings | [Premium controls](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/premium/PremiumBillingControls.kt), [offer terms](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/premium/PremiumOfferDetails.kt), and [Subscription route](../apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/subscription/SubscriptionRoute.kt) own loading, unavailable, pending, recovery, Restore and management states. Unknown entitlement blocks checkout while refresh remains available. |
| Notifications and missed updates | [Notifications](../apps/backend/src/billing/google/notifications.ts), [reconciliation](../apps/backend/src/billing/google/reconcile.ts), [schedule](../infra/aws/lib/gateways/api-gateway.ts), and [durable Google metadata](../db/migrations/0166_google_reconciliation.sql) own authenticated processing, duplicate handling, terminal correlation, acknowledgment retries and scheduled repair. |
| Entitlements and reporting | [Shared contract](premium-entitlements.md), [Google facts](../apps/backend/src/billing/google/facts.ts), and [limits](../apps/backend/src/billing/limits.ts). Sandbox purchases grant real access; production revenue reports exclude them. Google decides trial eligibility. |

## Public configuration identities

These are identifiers, not credentials. Keep bank details, payment-profile IDs,
tester addresses, purchase tokens, access tokens, and provider payloads out of
repository files and public evidence.

| Resource | Value |
| --- | --- |
| Play developer | `6698442103294061634` |
| Play app | `4974229050839345523` |
| Android package | `com.flashcardsopensourceapp.app` |
| Google Cloud project / number | `flashcards-open-source-app` / `360001205059` |
| Billing service account | `google-play-billing@flashcards-open-source-app.iam.gserviceaccount.com` |
| Push service account / subject | `nibomo-play-notifications@flashcards-open-source-app.iam.gserviceaccount.com` / `117934371221231125176` |
| RTDN topic | `projects/flashcards-open-source-app/topics/nibomo-play-subscriptions` |
| Push subscription | `projects/flashcards-open-source-app/subscriptions/nibomo-play-subscriptions-sub` |
| AWS federation provider | `projects/360001205059/locations/global/workloadIdentityPools/nibomo-aws-billing/providers/aws-backend` |
| AWS account | `506210661494` |
| Allowed backend role name | `FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF` |
| Push endpoint and OIDC audience | `https://api.nibomo.com/v1/billing/google/notifications` |

## Read back runtime access

The dedicated billing service account, Android Publisher API, Security Token
Service API and IAM Service Account Credentials API are enabled. The service
account has no JSON keys and no project-wide role grant; organization policy
prohibits key creation.

In Play Console **Users and permissions**, its saved invitation is Active,
Never expires, and restricted to Nibomo. The selected app permissions are:

- View app information (read-only), with implied View app quality (read-only).
- View financial data / Purchases API.
- Manage orders and subscriptions, including the owner-approved refund and
  cancellation capability.

No administrator, release, store-presence, or account-wide permissions were
granted. Reopen the invitation and verify its scope when diagnosing access. The
October 4 negative-path probe above reached Publisher through impersonation. Google's
[Developer API setup](https://developers.google.com/android-publisher/getting_started)
documents the billing permissions. Do not add catalog or release permissions to
this runtime identity to perform an operator's setup task.

The enabled federation pool/provider restricts AWS assertions with this saved
condition:

```text
assertion.account == '506210661494' && assertion.arn.startsWith('arn:aws:sts::506210661494:assumed-role/FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF/')
```

Both `google.subject` and `attribute.aws_role` use this exact saved CEL expression:

```text
assertion.arn.contains('assumed-role') ? assertion.arn.extract('{account_arn}assumed-role/') + 'assumed-role/' + assertion.arn.extract('assumed-role/{role_name}/') : assertion.arn
```

Google's [federation troubleshooting](https://cloud.google.com/iam/docs/troubleshooting-workload-identity-federation)
documents the 127-byte subject limit. The normalized role is 103 ASCII bytes;
the observed full Lambda session ARN was 163. The October 3 evidence establishes
STS HTTP 400, not Google's exact error description. The service account's saved
Workload Identity User (`roles/iam.workloadIdentityUser`) grant selects only this attribute value:

```text
arn:aws:sts::506210661494:assumed-role/FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF
```

Read back provider ACTIVE status, the exact condition, both mappings and the
connected service account's attribute-based grant together; compare its policy
etag when confirming a mapping-only repair. If CloudFormation replaces the role
name, update both restrictions
before enabling billing; do not broaden them to the whole AWS account or pool.
The existing GitHub federation and Android CI identity remain separate; see
[Android CI/CD](android-ci-cd.md).

[Runtime configuration](../apps/backend/src/billing/google/config.ts) constructs
Google's external-account `AwsClient` from the Lambda's temporary AWS credentials
and session token, then impersonates the billing service account with the
`https://www.googleapis.com/auth/androidpublisher` scope. It needs no downloaded
credential file or service-account key. Deploy through CI/CD only; never package
credentials into Android. Google's
[AWS federation procedure](https://cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds)
is the operator reference when access or the allowed role changes.

Accepted transport limitation: `google-auth-library` 11.1 bounds Publisher and
impersonation requests, but its STS exchange uses the vendor's default transport
within the enclosing Lambda/client request deadlines. Do not claim one global
SDK timeout or patch unsupported SDK internals. A real test purchase and its
acknowledgment readback are still required to complete provider acceptance.

## Notifications

The topic grants `roles/pubsub.publisher` only on that topic to Google's
`google-play-developer-notifications@system.gserviceaccount.com`. In Play
Console **Monetization setup**, RTDN is enabled with the full topic above and
subscriptions plus voided purchases selected. Pause remains enabled.

The subscription uses authenticated Push to the existing endpoint/audience,
with a 60-second acknowledgment deadline, 7-day retention, Never expire,
immediate retry and no dead-letter topic. The dedicated push identity has no
keys. Read back the saved configuration using Google's
[authenticated push procedure](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions):

1. On the **push service account resource only**, verify the saved
   `roles/iam.serviceAccountTokenCreator` grant to
   `service-360001205059@gcp-sa-pubsub.iam.gserviceaccount.com`. Read back the
   exact principal, role and resource. Do not accept the subscription editor's
   project-wide grant shortcut.
2. Verify the named subscription is Push, with the endpoint and audience in the
   identities table, authentication enabled and the dedicated push service
   account selected. Payload unwrapping must remain disabled; preserve the
   other saved delivery settings.
3. Use **Send test notification** in Play. Correlate its message ID with
   `google_test_notification_received` in the exact deployed BackendHandler
   CloudWatch log group and successful delivery. Do not pull/ack it manually
   as evidence of backend receipt. A test message grants no entitlement.
4. Test a real license-tester subscription event and the recovery rows below.
   Verify sanitized processing/acknowledgment records and the resulting server
   entitlement. Never expose the request body, token or Authorization header.

The handler validates the signed Google ID token, audience, verified service
account email and subject, subscription resource, package and wrapped payload.
Success returns 204; processing failures remain retryable by Pub/Sub. Scheduled
reconciliation invokes the same BackendHandler identity every 15 minutes, with
bounded batches and durable attempt/stop metadata. Inspect
`google_notification_failed`, `google_purchase_acknowledgement_failed` and
`google_reconciliation_completed`/`google_reconciliation_purchase_failed` when
delivery or access diverges. A green deployment or an empty reconciliation run
does not prove purchase recovery; record actual affected-purchase readbacks.

## Finish merchant verification and read back the catalog

1. In Play Console payment settings, open the linked EUR payout method. Once
   Google's small deposit appears in Revolut, enter its exact amount in the
   verification prompt and read back the verified status. Follow
   [Verify bank account](https://support.google.com/googleplay/android-developer/answer/7161378?hl=en);
   retain financial evidence privately.
2. Reopen the internal track and confirm the published release and version code
   in the readiness table. For later releases, follow [Android CI/CD](android-ci-cd.md)
   and the [release authorization runbook](release/README.md); keep the
   failed `23866012` candidate superseded and public production in draft.
3. In **Monetize with Play > Products > Subscriptions**, reopen `premium`,
   `monthly` and `free-trial-7d`; compare their settings with the snapshot above.
   Maintain all 51 [Google Play locale texts](subscription-store-metadata.md#google-play-texts).
   Google's [catalog procedure](https://support.google.com/googleplay/android-developer/answer/140504?hl=en)
   owns the Console steps. After any change, reload and verify IDs, locale entries,
   monthly period, price/currency/regions, active states, trial duration, and
   eligibility. Then query product details from the actual Play-installed test
   build and verify its returned base plan, eligible offer, pricing phases,
   and offer token before attempting purchase. Console state alone is not
   device-query evidence.

## Privacy and reviewer access

The Data Safety declaration in review marks Purchase history collected, not shared,
non-ephemeral and optional, for App functionality, Analytics, and Fraud
prevention/security/compliance. Purchases are linked to the app identity to
verify access, restore ownership and retain billing/support records. Google
handles card details; User payment info remains unchecked.

The declaration also marks existing IP-derived country as Approximate location:
collected, not shared, non-ephemeral, optional, for Analytics. Precise location
remains unchecked. Reconcile the whole form with
[audience analytics](analytics-audience.md), [billing deletion rules](premium-entitlements.md#guest-upgrade-reaping-and-deletion),
and Google's [Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
when maintaining the declaration. IN REVIEW does not mean approved or publicly published.
The [Privacy Policy](https://nibomo.com/privacy/) includes the Google billing
disclosures. [Website PR 508](https://github.com/kirill-markin/flashcards-open-source-app-website/pull/508)
merged as `566f4dcb201448fa4e733cb317d3f93a04103b74` at 15:21:11 UTC on
2026-10-03, after successful preview and
[Catalog checks](https://github.com/kirill-markin/flashcards-open-source-app-website/actions/runs/37132775111).
The [post-merge Catalog run](https://github.com/kirill-markin/flashcards-open-source-app-website/actions/runs/37132942106)
and [production Vercel deployment](https://vercel.com/kirill-markins-projects/flashcards-open-source-app-website/ZL1JUMGevk9G3SDXpZn11PVzjfNn)
succeeded; Vercel completed at 15:26:52 UTC. Rendered English HTML returned HTTP
200 at 15:27:51 UTC with Google payment handling, server billing events, Google
as recipient, retained billing history, and the account-deletion cancellation
notice linking to [Play subscription management](https://play.google.com/store/account/subscriptions).

For Play reviewer access instructions, describe the actual build: launch as a
guest or sign in, open **Settings > Subscription**, then the Premium offer.
No email is mandatory. Free users can also change a style setting in **Settings >
Style**, for example a premium color in Accent color; an actual AI allowance refusal
opens the same offer.
Restore is available on the offer and Subscription screen; Manage subscription
opens Play. Explain eligible trial versus ordinary monthly pricing, the
unavailable state when Play returns no offer, and the existing Terms/Privacy
links. Verify these steps in the Play-delivered candidate before saving reviewer
instructions. Account deletion does not cancel the Play subscription.

## Runtime and real-device acceptance gates

The saved license tester configuration uses `RESPOND_NORMALLY`; verify its
account matches the eventual device Google account. License testing does not
itself grant track access. On the Play device, enroll that account in the internal track,
and install its billing-enabled build from Play. Confirm the purchase sheet
offers test payment instruments. Use Google's
[billing testing guide and Play Billing Lab](https://developer.android.com/google/play/billing/test)
for accelerated lifecycle scenarios.

Use an Android 17/API 37 device and the final signed candidate. Record commit
SHA, version code, AAB digest, track/release identifier, device/OS, test time,
catalog readback and each observed result in private release evidence. Do not
substitute a debug emulator or Android CI result for Play billing acceptance.
Use license-tester instruments only; real-money transactions need separate
authorization. At the dated readiness snapshot, all rows below are pending,
including failure/recovery paths; record subsequent results separately from that
snapshot.

| Manual action | Required observation |
| --- | --- |
| Fresh guest and email account: open Settings, accent color and actual AI-refusal offers. | Native offer is reachable without mandatory email; immediate loading/status feedback, Terms/Privacy and Restore work. Unknown entitlement disables checkout and offers refresh; an existing Premium/lifetime account is not offered another purchase. |
| Query the activated catalog; compare eligible and ineligible store accounts, using Billing Lab's trial controls where needed. | IDs and localized price/phases match Play; eligible accounts see seven-day trial terms, ineligible accounts see ordinary monthly terms. No hardcoded regional price or universal trial promise. Missing catalog shows unavailable/retry. |
| Buy with the approving test instrument as guest, then as an email account. | Backend verifies and acknowledges; a fresh synced entitlement unlocks Premium and resumes the originating action. `sandbox` access works in production; test purchases do not produce production revenue facts. |
| Cancel the purchase sheet; use declining and delayed approve/decline instruments, restarting while pending. | Cancellation/decline does not grant access. Pending stays pending without acknowledgment or grant; completion grants only after verification, while a canceled pending payment clears recovery without starting a new charge. |
| Interrupt connectivity before checkout preparation; retry. Then interrupt after Play payment, restart and retry verification. | Preparation can restart safely; a completed payment is reconciled, never replaced with another purchase. Restore/startup/resume recover the same token; failures remain actionable until fresh server entitlement arrives. |
| In a controlled test, exercise verification, acknowledgment and fresh-entitlement sync failures, then restore service. | No false success from a stale snapshot; durable acknowledgment retry/readback completes; UI verification retry and scheduled reconciliation converge without duplicate billing facts. Record unexercised faults as pending rather than inventing failure results. |
| Reinstall or use a second device with the same Play account, then select Restore. | The existing purchase attaches to the current Nibomo identity and restores access. A lost guest lifetime gift is not a Play purchase and cannot be restored this way. |
| Explicitly Restore to a different Nibomo account; resume/replay on the former owner; switch identities during checkout/recovery. | Only the deliberate action transfers ownership. Passive updates cannot steal it back, and identity changes cannot apply completion to the wrong account. |
| Link a purchasing guest to a fresh email identity and to an existing account. | Purchases, applicable lifetime gift, preferences and AI usage follow the shared merge rules; usage is not reset. Highest valid tier wins. |
| Accelerate renewal; cancel; wait through paid-through expiry; resubscribe in Play and in app. | Cancellation retains access to the paid-through date with renewal disabled; expiry removes that purchase's contribution. Linked/out-of-app resubscription preserves lineage and does not revive an invalidated old token. |
| Use Billing Lab to enter grace and hold; exercise pause/resume and recovery. | Grace grants access; hold/pause do not. Provider state, backend snapshot and synced UI agree after recovery. Read current Play state rather than assuming test timer durations. |
| Refund/revoke the current test order, then deliver an older order's voided event after renewal. | Current revocation removes its contribution; a stale order event cannot revoke a newer healthy period. Lifetime/other valid purchases remain effective. |
| Redeliver the same authenticated RTDN, deliver events out of order, and withhold delivery for a test purchase while the schedule runs. | Completed duplicates are harmless; stale events do not roll back current access. Authoritative reads and scheduled reconciliation converge, including acknowledgment recovery. Capture sanitized event/purchase IDs and results only. |
| Go offline with cached Premium cosmetics; reconnect after a confirmed downgrade; resubscribe. | Offline local features retain cached access; confirmed downgrade displays Default while retaining the selected color; renewed access restores it. AI remains server-enforced with the UTC monthly allowance. |
| Review the Play-delivered localized UI, subscription management, privacy text, saved declarations and reviewer route. | Store text, trial/renewal disclosures and implemented data handling agree; published privacy and submitted declaration readbacks are recorded separately from drafts. |

Finish [release gates](release-gates.md) and the
[platform publication procedure](release/android.md) only within the
authorized rollout. Passing this matrix does not itself authorize public sales.
