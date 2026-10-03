# Google Play subscriptions

Human setup and handoff for Android billing. Product decisions live in
[Premium offer](premium-offer.md), access and ownership rules in
[Premium entitlements](premium-entitlements.md), and catalog IDs and all 51
Google Play locales in [Subscription store metadata](subscription-store-metadata.md#google-play).

## Readiness

Console readback as of 2026-10-03. Setup alone does not implement purchases or
enable public sales.

| State | Readback |
| --- | --- |
| Completed | SAMO DANNI EOOD merchant setup and 15% service-fee enrollment; billing service account, app-scoped Play permissions, notification topic and pull subscription, RTDN setting, license testing, and restricted AWS federation saved. |
| Pending | Linked Revolut EUR payout account awaits small-deposit verification. |
| Blocked; upload deferred by the owner | Console has no subscriptions and shows “Upload a new APK”. A billing-enabled bundle must reach Play before catalog setup can continue; the Android Release upload is explicitly deferred. |
| Planned only | Product `premium`, monthly base plan `monthly`, and new-customer offer `free-trial-7d` are neither created nor activated. Pricing and localized source text are repository inputs only. |
| Transport verified | Play test notification reached the pull subscription for the correct package, with `testNotification` version `1.0`; acknowledgment succeeded and the message row cleared. This proves Play-to-Pub/Sub delivery only. |
| Deferred | External-account credential file download is unconfirmed; runtime token exchange, purchases, restore, purchase acknowledgment, backend notification processing, and entitlement integration are untested or unimplemented. |

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
| RTDN topic | `projects/flashcards-open-source-app/topics/nibomo-play-subscriptions` |
| Pull subscription | `projects/flashcards-open-source-app/subscriptions/nibomo-play-subscriptions-sub` |
| AWS federation provider | `projects/360001205059/locations/global/workloadIdentityPools/nibomo-aws-billing/providers/aws-backend` |
| AWS account | `506210661494` |
| Allowed backend role name | `FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF` |

## Read back access before runtime integration

The dedicated billing service account is enabled. Android Publisher API
(`androidpublisher.googleapis.com`) is enabled. The service account has no JSON
keys and no project-wide role grant; organization policy prohibits key creation.

In Play Console **Users and permissions**, its saved invitation is Active,
Never expires, and restricted to Nibomo. The selected app permissions are:

- View app information (read-only), with implied View app quality (read-only).
- View financial data / Purchases API.
- Manage orders and subscriptions, including the owner-approved refund and
  cancellation capability.

No administrator, release, store-presence, or account-wide permissions were
granted. Reopen the invitation and verify its scope before treating API access
as ready; successful API authorization has not been exercised. Google's
[Developer API setup](https://developers.google.com/android-publisher/getting_started)
documents the billing permissions. Do not add catalog or release permissions to
this runtime identity to perform an operator's setup task.

The enabled federation pool/provider restricts AWS assertions with this saved
condition:

```text
assertion.account == '506210661494' && assertion.arn.startsWith('arn:aws:sts::506210661494:assumed-role/FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF/')
```

`google.subject` maps to `assertion.arn`; `attribute.aws_role` normalizes role
sessions to the session-free ARN. The service account's saved Workload Identity
User (`roles/iam.workloadIdentityUser`) grant selects only this attribute value:

```text
arn:aws:sts::506210661494:assumed-role/FlashcardsOpenSourceApp-BackendHandlerServiceRoleE5-gAiVg357pADF
```

Read back the provider condition, mapping, and connected service account
together. If CloudFormation replaces the role name, update both restrictions
before enabling billing; do not broaden them to the whole AWS account or pool.
The existing GitHub federation and Android CI identity remain separate; see
[Android CI/CD](android-ci-cd.md).

For implementation, follow Google's
[AWS federation procedure](https://cloud.google.com/iam/docs/workload-identity-federation-with-other-clouds)
to generate and inspect an AWS external-account credential configuration for
the provider and billing service account above. No downloaded path or deployed
configuration is confirmed. Verify the required STS and IAM Credentials APIs,
use the Lambda's temporary AWS credentials including its session token, and
request the `https://www.googleapis.com/auth/androidpublisher` scope for the
impersonated token. Prove token exchange and an authorized
[subscription purchase read](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get)
using a real test purchase before marking access complete. Never package a
service-account key or token into Android. AWS runtime configuration and
deployment belong to the future implementation and CI/CD.

## Notifications

The topic grants `roles/pubsub.publisher` only on that topic to Google's
`google-play-developer-notifications@system.gserviceaccount.com`. In Play
Console **Monetization setup**, RTDN is enabled with the full topic above and
subscriptions plus voided purchases selected. Pause remains enabled.

The pull subscription has a saved 60-second acknowledgment deadline,
7-day retention, Never expire, immediate retry, and no dead-letter topic.
There is no production consumer or push endpoint. Before using it in production,
review acknowledgment, retention, retry, and failure handling against the
chosen consumer; see [Pub/Sub subscription properties](https://cloud.google.com/pubsub/docs/subscription-properties).

To repeat the transport check, use **Send test notification** in Play, then
pull from the named subscription in Cloud Console and verify the package and
`testNotification`. Acknowledge the test message and confirm the operation
succeeded. Follow Google's [RTDN setup](https://developer.android.com/google/play/billing/getting-ready).
Keep this result separate from backend acceptance: a test notification contains
no purchase to grant. Real RTDN processing must obtain authoritative purchase
state from the Developer API, authenticate delivery/access, handle duplicates,
retry failures, and reconcile missed updates before deriving entitlements.

## Finish merchant and catalog setup

1. In Play Console payment settings, open the linked EUR payout method. Once
   Google's small deposit appears in Revolut, enter its exact amount in the
   verification prompt and read back the verified status. Follow
   [Verify bank account](https://support.google.com/googleplay/android-developer/answer/7161378?hl=en);
   retain financial evidence privately.
2. Resume the billing-enabled bundle upload only when the owner requests it.
   Follow [Android CI/CD](android-ci-cd.md) and the
   [release authorization runbook](release-current-version.md). A green PR or
   Android CI run is not an upload. Google's
   [billing setup](https://developer.android.com/google/play/billing/getting-ready)
   calls for a billing-enabled build published to a track, including internal
   testing. After the authorized upload, reopen Subscriptions; if the draft
   alone does not unlock it, complete the authorized test-track step before
   proceeding. Do not infer readiness from the library being present in source.
3. In **Monetize with Play > Products > Subscriptions**, create `premium`.
   Apply every field for all 51 [Google Play locales](subscription-store-metadata.md#google-play-texts).
   Create `monthly` as a one-month auto-renewing base plan. Set the USD 6.99
   base price, review Play's regional conversions and intended availability,
   then save and activate the base plan. Review grace, hold, and resubscribe
   settings and record the actual selections for lifecycle testing.
4. Add `free-trial-7d` to `monthly`, with a seven-day free phase and
   Google-managed new-customer acquisition eligibility. Read back the exact
   “never had this subscription” or “never had any subscription” selection;
   do not use developer-determined eligibility. Save and activate the offer.
   Google's [catalog procedure](https://support.google.com/googleplay/android-developer/answer/140504?hl=en)
   owns the Console steps.
5. Reopen the product, base plan, and offer. Verify all IDs, 51 locale entries,
   monthly period, price/currency/regions, active states, trial duration, and
   eligibility. Then query product details from the actual Play-installed test
   build and verify its returned base plan, eligible offer, pricing phases,
   and offer token before attempting purchase. Console state alone is not
   device-query evidence.

## Runtime and real-device acceptance gates

The license tester list is saved with the owner account only and
`RESPOND_NORMALLY`. License testing does not itself grant access to a test
track. On a real Android device, use that account, enroll in the chosen track,
and install its billing-enabled build from Play. Confirm the purchase sheet
offers test payment instruments. Use Google's
[billing testing guide and Play Billing Lab](https://developer.android.com/google/play/billing/test)
for accelerated lifecycle scenarios.

Before launch, implement purchase/restore/acknowledgment, verification and
ownership attachment, notification consumption, reconciliation, Android's
subscription and management screens, and shared entitlement/limit handling.
Follow [Premium entitlements](premium-entitlements.md) and preserve deliberate
restore versus automatic replay semantics described by the
[Apple ownership implementation](apple-subscriptions.md#transaction-intent).
These are Google implementation requirements, not claims about current behavior.

The current Console reports no policy issues and no App content declarations
needing attention (10 actioned). Data Safety and privacy were last edited on
2026-09-23; Financial info has both Purchase history and User payment info
unchecked. Before paid submission, review the implemented purchase-token,
order, and entitlement data flow and update Purchase history, its purposes,
and the privacy policy accordingly. Google handles card details; do not infer
app collection of card/payment information merely from using Play Billing.
Use Google's [Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).
Update reviewer access instructions to the actual paywall and restore flow.

Run these manual acceptance paths once that implementation and catalog exist:

- Purchase as a guest and signed-in user; test eligible and ineligible trial
  offers, completed, canceled, declined, and pending payments. Verify server
  purchase acknowledgment, entitlement sync, and sandbox revenue separation.
- Restore after reinstall and on a second device; deliberately restore to a
  different Nibomo account, then replay updates on the first. Confirm ownership
  follows the deliberate action, with guest linking and lifetime gifts intact.
- Accelerate renewal; cancel and check access through the paid period; exercise
  grace, hold, pause/resume, expiry, and refund/revoke. Compare provider state,
  backend entitlement, and synced clients with the shared status contract.
- Interrupt backend delivery, retry and replay messages, then reconcile.
  Confirm eventual entitlement correction without duplicate purchases or facts.
  Check offline cached access and server AI limits against the shared contract.
- Verify localized pricing, trial eligibility, terms and privacy links, restore,
  and Play subscription management in the final Android UI. Finalize privacy,
  Data Safety, and reviewer metadata against the shipped implementation, then
  complete [release gates](release-gates.md) and the
  [platform publication procedure](manual-production-release.md).

Record actual outcomes privately without tokens or personal data. Public sales
remain deferred until these gates and the requested release are complete.
