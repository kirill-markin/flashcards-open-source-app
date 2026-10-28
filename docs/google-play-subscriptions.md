# Google Play subscriptions

Human setup and handoff for Android billing. Product decisions live in
[Premium offer](premium-offer.md), access and ownership rules in
[Premium entitlements](premium-entitlements.md), and catalog IDs and all 51
Google Play locales in [Subscription store metadata](subscription-store-metadata.md#google-play).

## Readiness

Readback as of 2026-10-04. Android billing and the backend are implemented and deployed; the
catalog is active and the billing build is available to internal testers. Record later outcomes
with their evidence and timestamp before updating a gate.

| Area | Readback |
| --- | --- |
| Console | SAMO DANNI EOOD merchant setup and 15% service-fee enrollment, app-scoped billing permissions, license testing and restricted AWS federation are saved. |
| Backend | The Google reconciliation rule runs every 15 minutes. Federation is ACTIVE; a deliberately invalid Publisher `subscriptionsv2.get` returned HTTP 400 after STS HTTP 200, proving impersonation reaches Publisher. |
| Catalog | `premium` has all 51 locales from [store metadata](subscription-store-metadata.md#google-play-texts). Base plan `monthly` covers 175 countries/regions with new ones included, USD 6.99 base with Play-converted regional prices, 7-day grace and a 53-day account hold (60 combined), charge-at-next-billing-date changes and resubscribe allowed. Offer `free-trial-7d` covers the same regions with Google's “Never had this subscription” eligibility and no further phases. |
| Notifications | Authenticated Push and the resource-only Token Creator grant are saved; Play's official test was processed and acknowledged, and unsigned requests return HTTP 401 `GOOGLE_PUSH_UNAUTHORIZED`. |
| Console translations | App Strings covers 49 languages with automatic translation ON; the Premium rows were reviewed. This is not verification of translations delivered by the native app. |
| Privacy | Privacy and account-deletion pages are published; the Data Safety declaration is IN REVIEW. |
| Pending | Company EUR bank verification; device product details, offer token and pricing phases; genuine purchase, Restore, acknowledgment and real lifecycle delivery; the owner login and device/tester account match on the Play device; public production rollout. Complete the gates below before requesting public sales. |

## Implemented contract and source

[Routes](../apps/backend/src/routes/googleBilling.ts),
[service](../apps/backend/src/billing/google/service.ts),
[notifications](../apps/backend/src/billing/google/notifications.ts),
[reconciliation](../apps/backend/src/billing/google/reconcile.ts) and the Android
[repository](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/billing/GooglePlayBillingRepository.kt)
own ownership, acknowledgment, recovery and the native offer states. `{ attached: true }` is a
processing receipt, not permission to unlock Premium: Android unlocks only on a fresh synced
entitlement.

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
granted. Reopen the invitation and verify its scope when diagnosing access. Google's
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
documents the 127-byte subject limit, which the full Lambda session ARN exceeds
and the normalized role fits. The service account's saved
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
The Play bulk reports import uses its own provider and service account; see
[Store Analytics Import](store-analytics.md#google-play).

[Runtime configuration](../apps/backend/src/billing/google/config.ts) constructs
Google's external-account `AwsClient` from the Lambda's temporary AWS credentials
and session token, then impersonates the billing service account with the
`https://www.googleapis.com/auth/androidpublisher` scope. It needs no downloaded
credential file or service-account key. Deploy through CI/CD only; never package
credentials into Android. Google's
[AWS federation procedure](https://cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds)
is the operator reference when access or the allowed role changes.

A real test purchase and its acknowledgment readback are still required to complete provider
acceptance.

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

The [handler](../apps/backend/src/billing/google/notifications.ts) returns 204 on success and
leaves processing failures retryable by Pub/Sub; scheduled reconciliation repairs missed updates.
Inspect `google_notification_failed`, `google_purchase_acknowledgement_failed` and
`google_reconciliation_completed`/`google_reconciliation_purchase_failed` when
delivery or access diverges; each run's `google_reconciliation_run` outcome feeds
its alarm. A green deployment or an empty reconciliation run
does not prove purchase recovery; record actual affected-purchase readbacks.

## Finish merchant verification and read back the catalog

1. In Play Console payment settings, open the linked EUR payout method. Once
   Google's small deposit appears in Revolut, enter its exact amount in the
   verification prompt and read back the verified status. Follow
   [Verify bank account](https://support.google.com/googleplay/android-developer/answer/7161378?hl=en);
   retain financial evidence privately.
2. Reopen the internal track and confirm its latest release is the intended billing
   build. For later releases, follow [Android CI/CD](android-ci-cd.md) and the
   [release authorization runbook](release/README.md); keep public production in draft.
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
The published [Privacy Policy](https://nibomo.com/privacy/) includes the Google billing
disclosures: Google payment handling, server billing events, Google as recipient, retained billing
history, and the account-deletion cancellation notice linking to
[Play subscription management](https://play.google.com/store/account/subscriptions).

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
