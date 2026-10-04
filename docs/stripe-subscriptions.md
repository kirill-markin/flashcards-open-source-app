# Stripe subscriptions

The backend implements owned Checkout, Portal, reconciliation, account deletion
cancellation, signed webhook receivers, product email dispatch and the web purchase
UI. Live Checkout remains disabled. The [observed Sandbox acceptance](#observed-sandbox-acceptance)
records actual hosted purchase and email evidence separately from remaining gates.

[Premium offer](premium-offer.md) owns price, benefits and limits;
[Premium entitlements](premium-entitlements.md) owns access and provider-state
rules. [Configuration](stripe-subscriptions/configuration.json) owns public Stripe
identifiers; [HTTP routes](../apps/backend/src/routes/stripeBilling.ts) and
[lifecycle](../apps/backend/src/billing/stripe/service.ts) own runtime behavior.

## Offer and catalog

| Setting | Selected value |
| --- | --- |
| Business | SAMO DANNI EOOD; isolated sandbox `Nibomo Subscriptions` |
| Product name and customer-facing description | `product.name` and `product.description` in the [English map](../apps/backend/src/billing/stripe/copy/locales/en.json) |
| Marketing features | `product.aiFeature` and `product.accentFeature` in the English map |
| Internal price nickname | `Nibomo Premium Monthly` |
| Price lookup key, separately in each environment | `nibomo_premium_monthly` |
| Product metadata | `application=nibomo`, `tier=premium` |
| Price | USD 6.99 (`unit_amount=699`), monthly recurring, quantity 1 |
| Local currency presentation | Stripe Adaptive Pricing; real Sandbox Checkout and successful payment presented EUR from the USD base |
| Tax behavior | Explicit `tax_behavior=inclusive` on the price; never inherit the account default |
| Tax calculation | Automatic tax completed in the real Sandbox Checkout and paid invoice; see acceptance evidence below |
| Checkout trial | 7 days with a payment method collected for automatic renewal; catalog price has no trial |
| Trial eligibility | Once per Stripe customer; prior Apple or Google trials do not disqualify that customer |
| Web purchaser | Signed-in account with an email; web guests link an email before checkout |
| Product statement descriptor | `NIBOMO PREMIUM` read back; verify actual payment statement presentation before launch |
| Dedicated portal configuration name | `Nibomo Premium` |
| Portal headline | `portal.headline` in the English map |
| Ordinary subscription cancellation | End of the current trial or paid period; paid access continues until that period ends |
| Account deletion | Cancel future renewals of every Nibomo Stripe subscription attached to the account before completing deletion |
| Portal features | Cancellation, payment-method updates, billing details and invoice history |
| Plan/quantity changes | Disabled; only one monthly plan is sold |
| Privacy Policy | [nibomo.com/privacy/](https://nibomo.com/privacy/) |
| Terms of Service | [nibomo.com/terms/](https://nibomo.com/terms/) |
| Support | [nibomo.com/support/](https://nibomo.com/support/) |

The trial belongs to a Checkout Session, not a second product or zero-price
catalog entry. Customer mapping and trial eligibility must be server-owned and
survive repeat checkout attempts: do not mint a new Stripe customer on each
attempt. Pass a trial only when that customer is eligible; otherwise show the
non-trial purchase copy. A mobile trial history does not consume this trial.

Premium and lifetime access carry 1000 platform-key AI chat messages per calendar
month in UTC. Sync and the ability to supply an own OpenAI key remain free; that
key does not unlock Premium features, and OpenAI usage is billed separately.
There is no annual or lifetime product for sale. Preparing this catalog does not
make web purchases available.

## Resource inventory

[configuration.json](stripe-subscriptions/configuration.json) is the single ID
inventory for both environments: account, product, default monthly price,
dedicated portal configuration, uploaded icon, public file link and API pin.
Its common catalog/portal fields were verified in both environments; environment
fields distinguish live settings from sandbox copies. It contains no credentials,
customer records, bank details or raw authenticated responses.

| Resource | Verified state |
| --- | --- |
| Product and default price | Active in each environment; English source rendered with `count=1000`; monthly USD 699 cents, inclusive tax |
| Dedicated portal | Active in each environment; period-end cancellation with no proration and a cancellation survey offering all eight Stripe reasons, payment-method updates, invoice history and name/email/address/tax-ID edits enabled |
| Portal restrictions | Subscription plan/quantity changes, pause and public login page disabled |
| Portal defaults | First sandbox configuration is naturally the default; live Nibomo configuration is not the shared default. Always pass its explicit ID |
| Branding | 512 × 512 `business_icon` uploads and public product image links verified; [media evidence](media/stripe-subscriptions/README.md) |
| API pin | Explicit `Stripe-Version: 2026-09-30.endive` returned HTTP 200 in both environments. SDK 23.0.0 and event destinations use this pin |
| Historical live account default | `2020-08-27`, preserved; never rely on that default for the new integration |
| Webhooks | One enabled endpoint per environment, API pin and 30 event types freshly read back; public IDs are in the inventory. Actual Sandbox deliveries returned 204 |

Catalog readback and Live endpoint readiness do not establish Live purchase or
email delivery. The acceptance record below identifies the Sandbox flows observed.

## Authoritative copy and localization

[locales/en.json](../apps/backend/src/billing/stripe/copy/locales/en.json) is the single English
source: **55 keys**, each mapping directly to one string. All 50 canonical maps
live in [backend copy sources](../apps/backend/src/billing/stripe/copy/locales/).
Each [web locale catalog](../apps/web/src/i18n/catalogs/) imports its own map;
the [typed adapter](../apps/web/src/i18n/stripeCatalog.ts) exposes nested keys such
as `stripe.offer.title`. English remains in the app shell and other languages
retain their lazy locale chunks. The web Premium offer consumes this catalog;
new Live Checkout remains gated. The map also supplies product,
portal, tax, trial, allowance-window, reminder-email, receipt-email and deletion copy.

| Key family | Count | Use |
| --- | --- | --- |
| `product.*` | 4 | Stripe product name, description and two marketing features |
| `portal.*` | 1 | Dedicated portal headline |
| `offer.*` | 16 | Offer, price, eligibility, renewal, guest linking, free sync, tax and UTC window |
| `limit.*` | 3 | Monthly allowance prompt and free/paid explanations |
| `ownKey.*` | 2 | Own-key action and explanation |
| `legal.*` | 2 | Privacy and terms links |
| `common.*` | 1 | Close action |
| `checkout.*` | 5 | Opening, confirmation, delayed and interrupted return states |
| `subscription.*` | 12 | Refresh/manage actions, provider, dates, cancellation, payment and access status |
| `email.*` | 6 | Prepared Nibomo-specific trial-reminder, payment-receipt and refund-receipt subjects and bodies |
| `deletion.*` | 3 | Warning, cancellation progress and failure |

Keep `{count}`, `{price}`, `{date}`, `{provider}` and `{url}` verbatim in translations.
`{count}` is a locale-formatted backend allowance (currently 1000 for Premium and
lifetime); Stripe product text is rendered with that selected offer value before
upload, never with a literal placeholder. `{price}` is the provider-derived,
locale-formatted amount and currency for the offer or renewal being described,
or the actual successful payment/refund amount in receipt emails.
`{date}` is a locale-formatted server/provider date; `{provider}` is the relevant
store name. `{url}` is the allowlisted absolute Subscription settings URL below
or, in receipt emails, a trusted provider receipt/invoice URL; never a customer-supplied
redirect. Do not hardcode USD formatting in translated copy. The canonical maps
use single braces; the web adapter converts them to the `{{token}}` convention
used by the [web localization runtime](../apps/web/src/i18n/runtime.ts).

Use trial copy only for eligible customers; show the payment-method requirement,
post-trial monthly amount, automatic renewal, cancellation path and inclusive tax
notice before purchase. A currency selection in hosted Checkout can change the
presented amount; disclose the final amount there and use actual provider values
for subsequent renewal views. Never promise a converted amount that Stripe has
not supplied. `offer.allowanceWindow` distinguishes the UTC calendar-month
allowance from the subscription billing period.

Own-key copy belongs in the AI allowance context.
`deletion.*` supplements the app’s existing account/data-deletion confirmation and
must ship only with the cancellation behavior below. Technical errors follow the
web app’s actionable error presentation without exposing raw provider responses.
`email.*` supplies the [billing email dispatcher](../apps/backend/src/billing/stripe/email.ts).
It uses all 50 canonical maps without the narrower hosted Checkout locale mapping.
Shared Stripe email settings remain unchanged.

### Verified locale files

The inventory is the 50 tags in [supportedLocales](../apps/web/src/i18n/types.ts).
English and all 49 translations are present: **55 keys × 50 locales = 2750
entries**, with matching key sets and placeholder tokens. The web catalogs consume
these maps with each locale's Premium and billing terminology.

| Locale files | Locale files | Locale files | Locale files | Locale files |
| --- | --- | --- | --- | --- |
| [en](../apps/backend/src/billing/stripe/copy/locales/en.json) | [ar](../apps/backend/src/billing/stripe/copy/locales/ar.json) | [zh-Hans](../apps/backend/src/billing/stripe/copy/locales/zh-Hans.json) | [de](../apps/backend/src/billing/stripe/copy/locales/de.json) | [hi](../apps/backend/src/billing/stripe/copy/locales/hi.json) |
| [ja](../apps/backend/src/billing/stripe/copy/locales/ja.json) | [ru](../apps/backend/src/billing/stripe/copy/locales/ru.json) | [es-MX](../apps/backend/src/billing/stripe/copy/locales/es-MX.json) | [es-ES](../apps/backend/src/billing/stripe/copy/locales/es-ES.json) | [fr](../apps/backend/src/billing/stripe/copy/locales/fr.json) |
| [pt-BR](../apps/backend/src/billing/stripe/copy/locales/pt-BR.json) | [it](../apps/backend/src/billing/stripe/copy/locales/it.json) | [ko](../apps/backend/src/billing/stripe/copy/locales/ko.json) | [id](../apps/backend/src/billing/stripe/copy/locales/id.json) | [tr](../apps/backend/src/billing/stripe/copy/locales/tr.json) |
| [nl](../apps/backend/src/billing/stripe/copy/locales/nl.json) | [pl](../apps/backend/src/billing/stripe/copy/locales/pl.json) | [vi](../apps/backend/src/billing/stripe/copy/locales/vi.json) | [th](../apps/backend/src/billing/stripe/copy/locales/th.json) | [uk](../apps/backend/src/billing/stripe/copy/locales/uk.json) |
| [he](../apps/backend/src/billing/stripe/copy/locales/he.json) | [sv](../apps/backend/src/billing/stripe/copy/locales/sv.json) | [da](../apps/backend/src/billing/stripe/copy/locales/da.json) | [nb](../apps/backend/src/billing/stripe/copy/locales/nb.json) | [fi](../apps/backend/src/billing/stripe/copy/locales/fi.json) |
| [cs](../apps/backend/src/billing/stripe/copy/locales/cs.json) | [el](../apps/backend/src/billing/stripe/copy/locales/el.json) | [ro](../apps/backend/src/billing/stripe/copy/locales/ro.json) | [hu](../apps/backend/src/billing/stripe/copy/locales/hu.json) | [fa](../apps/backend/src/billing/stripe/copy/locales/fa.json) |
| [ca](../apps/backend/src/billing/stripe/copy/locales/ca.json) | [bn](../apps/backend/src/billing/stripe/copy/locales/bn.json) | [gu](../apps/backend/src/billing/stripe/copy/locales/gu.json) | [kn](../apps/backend/src/billing/stripe/copy/locales/kn.json) | [ml](../apps/backend/src/billing/stripe/copy/locales/ml.json) |
| [mr](../apps/backend/src/billing/stripe/copy/locales/mr.json) | [pa](../apps/backend/src/billing/stripe/copy/locales/pa.json) | [ta](../apps/backend/src/billing/stripe/copy/locales/ta.json) | [te](../apps/backend/src/billing/stripe/copy/locales/te.json) | [ur](../apps/backend/src/billing/stripe/copy/locales/ur.json) |
| [sw](../apps/backend/src/billing/stripe/copy/locales/sw.json) | [bg](../apps/backend/src/billing/stripe/copy/locales/bg.json) | [et](../apps/backend/src/billing/stripe/copy/locales/et.json) | [hr](../apps/backend/src/billing/stripe/copy/locales/hr.json) | [is](../apps/backend/src/billing/stripe/copy/locales/is.json) |
| [lt](../apps/backend/src/billing/stripe/copy/locales/lt.json) | [lv](../apps/backend/src/billing/stripe/copy/locales/lv.json) | [sk](../apps/backend/src/billing/stripe/copy/locales/sk.json) | [sl](../apps/backend/src/billing/stripe/copy/locales/sl.json) | [zu](../apps/backend/src/billing/stripe/copy/locales/zu.json) |

These are Nibomo-owned translations. Stripe's product name, description, marketing
features and this portal configuration's headline are single English strings;
they do not automatically select one of these 50 maps. Hosted per-session custom text selects canonical locale copy. Web purchase UI remains pending.

The verified [Checkout locale enum](https://docs.stripe.com/api/checkout/sessions/create#checkout_session_create-locale)
requires `es-MX → es-419`, `es-ES → es` and `zh-Hans → zh`. Other exact supported
app tags pass through. Unsupported app tags (`ar`, `hi`, `uk`, `he`, `fa`, `ca`,
`bn`, `gu`, `kn`, `ml`, `mr`, `pa`, `ta`, `te`, `ur`, `sw`, `is`, `zu`) must use
English hosted Checkout while Nibomo keeps their full translations. Make that
mapping explicit; browser `auto` is not a guarantee of the app's selected language.

Validate the [portal session locale](https://docs.stripe.com/api/customer_portal/sessions/create)
separately; its automatic choice uses the customer's `preferred_locales` or browser
locale. Do not assume the portal accepts every Checkout locale. English custom
product/headline text remains English even when Stripe's controls are localized.

## Branding

The [Stripe media inventory](media/stripe-subscriptions/README.md) links the
existing vector and PNG sources, upload integrity evidence and the live product
screenshot. The uploaded icon is pixel-identical to the source; Stripe's PNG
optimization changes the byte hash. No additional artwork is needed.

The live account's existing branding is preserved. The verified
[Checkout create API](https://docs.stripe.com/api/checkout/sessions/create)
supports per-session `branding_settings.display_name`, `icon.type=file` and
`icon.file` using the environment's `business_icon` ID. The provider applies these per session; inspect real hosted rendering before activation. The display-name override affects the top of Checkout,
not the business name in receipts and terms.

A dedicated portal configuration isolates feature settings, headline and legal
URLs, **not account branding**. The portal uses shared account branding. Review
that appearance before activation without overwriting unrelated products' assets.
Shared Checkout policy links are disabled and its support website points to
`https://kirill-markin.com/`. Keep Nibomo legal/support links in the app and its
portal configuration; use supported Checkout `custom_text` for session-specific
copy and policy links after verifying rendering. The reference allows up to 1200
characters per custom message. Do not enable shared policy toggles as a shortcut.

## HTTP and hosted return contracts

The [route module](../apps/backend/src/routes/stripeBilling.ts) validates public DTOs
and mounts these paths within Hono at both `/billing/stripe` and `/v1/billing/stripe`.
The [API Gateway](../infra/aws/lib/gateways/api-gateway.ts) root proxy forwards them
and the internal `/v1` aliases. Public requests append
the paths below to the [published API base](published-api-origin.md), including
its `/v1` prefix. Responses use `Cache-Control: no-store`.

| Method and path under `/billing/stripe` | Request and response |
| --- | --- |
| `GET /offer` | Projection of billing details: `environment`, `checkoutAvailable`, `checkoutUnavailableReason`, `basePrice`, `trialEligible` |
| `POST /checkout` | JSON `{}`; returns the service union `checkout`, `existing_subscription`, or `complete` |
| `GET /subscriptions` | Reconciled `StripeBillingDetails` with all owned historical customers and pending Checkouts |
| `POST /portal` | JSON `{identityId}` with an owned opaque UUID; returns `{url}` |
| `POST /checkout/return` | JSON `{attemptId,sessionId}`; returns these IDs and provider status `open`, `complete`, or `expired` |
| `POST /webhooks/sandbox` | Sandbox signature, no browser session; successful handling returns HTTP 204 |
| `POST /webhooks/live` | Production signature, no browser session; successful handling returns HTTP 204 |

The five human routes accept verified Cognito Bearer or Session authentication
with a persisted email. Guests, including web guests on `/offer`, and agent API keys
receive 403 `STRIPE_HUMAN_AUTH_REQUIRED`; guests must link email first. Session
POSTs retain existing origin and CSRF checks. No request can select environment,
customer, price, quantity, email, locale or redirect. JSON inputs are limited to
4096 bytes and reject extra fields. `identityId` selects an owned app identity,
never a provider customer ID. Public response types live in
[Checkout](../apps/backend/src/billing/stripe/checkout.ts) and
[Portal/details](../apps/backend/src/billing/stripe/portal.ts);
`StripeBillingOffer` is exported by the route module.

Persisted profile email plus `isConfiguredDemoEmail` chooses sandbox. Everyone
else uses production. Persisted locale selects hosted copy. `basePrice` is a
verified base USD monthly price, or null while purchasing is disabled; it is not
a converted-price preview. Final currency and amount come from hosted Checkout.
`trialEligible` may be null while customer recovery is unresolved.
`checkoutUnavailableReason` is `purchases_disabled`, `existing_subscription`,
`checkout_pending`, or null. A customer can have `managementAvailable=true` while
`checkoutAvailable=false`. Lifetime/mobile access does not hide Stripe subscriptions.

Checkout uses the environment catalog, quantity one, inclusive tax, automatic tax,
Adaptive Pricing, flexible subscription billing, and a payment method even during
a seven-day trial. Trial eligibility is once per Stripe customer, including that
customer's prior trials on other products; mobile trial history is independent.
[Provider](../apps/backend/src/billing/stripe/provider.ts) and
[presentation](../apps/backend/src/billing/stripe/checkoutPresentation.ts) own these inputs.

Hosted return URLs are fixed under `https://app.nibomo.com/settings/subscription`:

- Success: `?checkout_session_id={CHECKOUT_SESSION_ID}&checkout=success&checkout_attempt_id=<owned UUID>`.
- Cancel: `?checkout=cancelled&checkout_attempt_id=<owned UUID>`.
- Portal: `?portal=returned`.

The success handler sends both owned IDs to `POST /checkout/return`. Never grant
access from query parameters or provider completion status: read the shared
entitlement snapshot. Refresh details after Portal/cancel returns and handle
account changes. The web purchase and return UI is deployed.

Errors use the existing envelope `{error,requestId,code}`. Invalid JSON/fields are
400; oversized input is 413; invalid ownership/human transport/email is 403;
a retired account is 410; nonretryable reservation conflicts are 409.
Missing/incomplete configuration and retryable provider/persistence failures are
503; other provider/response failures are 502. Routes never return or log provider
payloads, secrets, raw SDK exceptions or database details. Webhook invalid
signatures, account/environment/API pin or payload envelopes are 400; handling
failures are 5xx. Missing signatures are rejected before configuration is loaded.
An unset ARN does not affect startup or non-Stripe operations. Disabling new
Checkout leaves owned details, Portal, return reconciliation, lifecycle and
deletion operational.

## Receiver and runtime provisioning procedure

Deploy reviewed code through `AWS/Web Release` and wait for the complete release
before creating either endpoint. Do not synthesize, build or deploy AWS locally.
Receiver URLs are:

- Sandbox: `https://api.nibomo.com/v1/billing/stripe/webhooks/sandbox`.
- Production: `https://api.nibomo.com/v1/billing/stripe/webhooks/live`.

The public `/v1` prefix is required by the custom-domain mapping on both permanent
API hosts, `api.nibomo.com` and `api.flashcards-open-source-app.com`. Internal Hono
aliases and the root proxy do not expose unprefixed custom-domain URLs. Register
only one destination per environment. The receiver reads at most 1,048,576 raw
bytes from the existing binary API Gateway/Lambda/Hono transport, without JSON
reserialization for verification.
Only exact internal receiver POST paths and aliases bypass browser CORS/session checks;
Google and Apple retain their existing exemptions. The service checks the
correct signing secret, environment, account and exact `2026-09-30.endive` event
API version before personal payload retention. Unknown, unrelated, unowned and
erased events are ignored. Processed, duplicate and ignored deliveries return
204 without provider data.

Configure exactly the 30 events exported by
[`stripeLifecycleEventTypes`](../apps/backend/src/billing/stripe/state.ts):

```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.trial_will_end
invoice.created
invoice.finalized
invoice.finalization_failed
invoice.updated
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.payment_action_required
invoice.voided
invoice.marked_uncollectible
charge.refunded
charge.refund.updated
refund.created
refund.updated
refund.failed
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
```

Only the HTTP backend receives these nonsecret deployment inputs:

| GitHub repository variable | CI context environment | CDK context | Runtime environment |
| --- | --- | --- | --- |
| `CDK_STRIPE_BILLING_SECRET_ARN` | `CDK_CONTEXT_STRIPE_BILLING_SECRET_ARN` | `stripeBillingSecretArn` | `STRIPE_BILLING_SECRET_ARN` |
| `CDK_STRIPE_CHECKOUT_LIVE_ENABLED` | `CDK_CONTEXT_STRIPE_CHECKOUT_LIVE_ENABLED` | `stripeCheckoutLiveEnabled` | `STRIPE_CHECKOUT_LIVE_ENABLED` |

Both workflow context jobs pass these inputs. The ARN is optional. Only the exact
string `true` enables new production Checkout; unset and every other value become
runtime `false`. Set the GitHub flag to `false` during provisioning.
`scripts/setup/setup-github.sh` can create missing variables from root `.env`
`STRIPE_BILLING_SECRET_ARN` and `STRIPE_CHECKOUT_LIVE_ENABLED` (default `false`),
and never overwrites existing variables. No Stripe secret discovery is needed in
`scripts/lib/deploy-config.sh`. Update the two repository variables explicitly for
an existing installation, then use normal CI/CD.

Use the complete vault ARN
`arn:aws:secretsmanager:eu-central-1:506210661494:secret:flashcards-open-source-app/stripe-billing-juxXCn`.
CDK grants that secret's read access only to the HTTP backend and injects its ARN,
never its value. Chat/MCP/auth functions and frontend/build environments receive
neither secret values nor a Stripe runtime grant.

The [runtime parser](../apps/backend/src/billing/stripe/config.ts) accepts a JSON
object with optional `sandbox` and `production` objects. Each present object needs
both fields below; the selected environment must exist:

| JSON field | Required value shape |
| --- | --- |
| `sandbox.apiKey` | Restricted key matching `^rk_test_[A-Za-z0-9]+$` |
| `sandbox.webhookSigningSecret` | Real endpoint signing secret matching `^whsec_[A-Za-z0-9]+$` |
| `production.apiKey` | Restricted key matching `^rk_live_[A-Za-z0-9]+$` |
| `production.webhookSigningSecret` | Real endpoint signing secret matching `^whsec_[A-Za-z0-9]+$` |

An API-key-only provisioning object deliberately fails closed; never invent
placeholder signing secrets. Preserve both approved restricted keys when adding
their real endpoint secrets. The nine runtime permissions are Accounts read,
Charges and Refunds read, Payment Disputes read, Invoices read, Prices read,
Customers write, Customer Portal write, Subscriptions write and Checkout Sessions
write. Operator/admin keys must never enter this vault.

After deployment, an authorized operator creates each endpoint in its matching
Stripe account with the API pin and event list above, capturing its signing secret
privately. Assemble the full JSON via a protected file or stdin, never value-bearing
command arguments, shell history, Git, stdout, logs or CI artifacts. Given an
operator-prepared complete JSON object on redirected stdin, use this upload pattern:

```bash
set +x
umask 077
stripe_secret_file="$(mktemp -t nibomo-stripe-secret.XXXXXX)"
trap 'rm -f "$stripe_secret_file"' EXIT
cat > "$stripe_secret_file"
aws --profile flashcards-open-source-app --region eu-central-1 secretsmanager put-secret-value \
  --secret-id arn:aws:secretsmanager:eu-central-1:506210661494:secret:flashcards-open-source-app/stripe-billing-juxXCn \
  --secret-string "file://${stripe_secret_file}" \
  --query '{ARN:ARN,VersionId:VersionId}' --output json
```

Use redirected private input, not a terminal that echoes pasted values. Do not
upload an incomplete replacement that drops another environment. Secrets load
lazily per operation, so a full vault update needs no frontend rebuild.
Provisioning never enables live Checkout on its own.

### Manual acceptance after CI/CD

1. Confirm normal health, authentication, sync and Apple/Google routes still work.
   With the flag false, an ordinary human account without Stripe mappings sees
   an unavailable offer and cannot create a new production Checkout.
2. Confirm guest and agent refusal on all five human routes. Confirm Session
   POST refusal without valid CSRF/origin, including checkout return.
3. Send unsigned/malformed bodies to both public receiver URLs above:
   expect 400, or 413 over the body bound. Before complete provisioning, a
   structurally valid signed-looking delivery must fail closed with 503.
4. After provisioning, send real provider-signed sandbox deliveries. Confirm 204
   for owned processing, ignored events and duplicates; wrong-environment
   signatures/API versions must return 400. Inspect sanitized diagnostics and
   ownership-stamped receipts. A controlled retryable sandbox processing failure
   must return 5xx and permit successful redelivery.
5. Use a configured review account for the sandbox launch checklist below. Check
   owned return IDs and refusal after switching accounts. Verify existing details,
   Portal, return reconciliation and deletion while live purchasing stays off.
   Do not make live purchases.

### Account deletion

[Deletion](../apps/backend/src/billing/stripe/deletion.ts) runs before account
erasure and demo reset across all clients. It expires open Nibomo Checkouts and
confirms cancellation of future Nibomo renewals across all owned environments and
historical identities, independently of lifetime or mobile access. Other Stripe
products and Apple/Google subscriptions are unaffected. No automatic refunds or
prorations occur. An ambiguous session reservation blocks deletion until its
absolute expiry; cancellation failure preserves the account with HTTP 503
`ACCOUNT_DELETE_STRIPE_CANCELLATION_FAILED`. Billing-history anonymization remains
in [Premium entitlements](premium-entitlements.md#guest-upgrade-reaping-and-deletion).

## Product billing email verification

[Email dispatch](../apps/backend/src/billing/stripe/email.ts),
[provider projections](../apps/backend/src/billing/stripe/provider.ts), and
[delivery storage](../db/migrations/0167_stripe_email_deliveries.sql) own selection,
amounts, locks, retries and deduplication. Access commits before dispatch. A send
failure cannot roll back paid access. Resend acceptance is recorded separately
from inbox delivery, which still needs the checks below.

The existing HTTP backend `RESEND_API_KEY` and `RESEND_FROM_EMAIL` supply the
private transport and sender, with display name Nibomo. The recipient is the
currently owned Stripe customer's billing email; the language is the persisted
Nibomo profile locale. No client-provided contact, locale or redirect is accepted.
Payment/refund links are validated HTTPS Stripe hosted URLs; reminders link to
[Subscription settings](https://app.nibomo.com/settings/subscription).

Frozen private request bytes survive retries until acceptance or a stopped
attempt; those terminal states clear the request and notice. The retained opaque
customer identity supplies ownership across merges and erasure. Account deletion
also clears pending private data and the provider message identifier, while
preserving the entity receipt to prevent replay. Delivery data is withheld from
reporting. No background mail queue or new scheduled job is installed.

Resend's [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys)
is 24 hours. Automatic sends stop conservatively 23 hours after the durable first
attempt; neither a new webhook ID nor changing the sender, recipient, locale or
copy creates a new send key. An unresolved result past that window, or a provider
payload conflict, requires operator reconciliation; do not delete its receipt or
issue a new key. A concurrent-request conflict retries the same frozen payload.
Use only sanitized error codes and provider message IDs when recording evidence.

Adaptive Pricing amounts on successful charges and refunds are used directly;
[Stripe API currency units](https://docs.stripe.com/currencies) govern formatting,
including zero-decimal currencies, ISK/UGX versus HUF/TWD, and Stripe's
[three-decimal charge currencies](https://support.stripe.com/questions/which-payments-methods-and-products-are-available-in-the-uae?locale=en-GB).
The trial template
must describe the verified monthly **base** price in the provider price currency
and explain that Stripe shows the final charge in the billing currency. The
[Adaptive Pricing subscription](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=stripe-hosted)
exposes its presentment currency without a guaranteed future converted amount.
No exchange-rate estimate or previous charge substitutes for that future amount.

After normal cloud checks and deployment, using only an authorized sandbox
review account and a controlled real inbox:

1. Set a supported persisted Nibomo locale that hosted Checkout does not support,
   then complete the eligible trial through the actual owned flow. Confirm its
   verified billing email differs safely from any synthetic review login.
2. Trigger Stripe's real trial-will-end event and inspect the inbox: exact end
   date/time, explicitly labeled verified monthly base price, final billing
   currency disclosure, localized text and fixed settings URL. Shorten/end/cancel
   the trial and replay the old event; no stale future charge reminder may arrive.
3. Complete first payment and renewal, including a converted currency. Compare
   the received amount/currency and hosted receipt with actual charge presentment
   data. Redeliver `invoice.paid` and `invoice.payment_succeeded`: one receipt per
   invoice, including redelivery after 24 hours.
4. Issue authorized sandbox partial and full refunds. Each successful refund
   gets its own actual amount and receipt; pending/failed refunds send nothing.
   Replay charge/refund event types and confirm entity deduplication.
5. Exercise a controlled Resend transient failure and concurrent delivery. Access
   must already be correct; retry uses the same request and key. Inspect durable
   pending/error state. For ambiguous or payload-conflict results, reconcile the
   provider record without manufacturing a replacement send. Confirm accepted
   deliveries clear private request bytes.
6. Confirm erased, unowned and unrelated-product events send nothing; deletion
   clears pending delivery contacts/content and keeps entity deduplication. Check
   an account with a separate lifetime/mobile purchase and historical Stripe
   customer mappings. Verify the existing sender's authenticated domain, inbox
   placement and truthful From presentation; API success alone is insufficient.

## Verified settings and remaining launch gates

The [configuration inventory](stripe-subscriptions/configuration.json) records the
sanitized 2026-10-03 catalog/API readback and Dashboard settings audit. This table
distinguishes those observations from application work:

| Area | Observed preparation state | Required before activation |
| --- | --- | --- |
| Tax | Tax active in both environments; explicit inclusive prices and product code `txcd_10105001`. Sandbox defaults use Stripe/inclusive/the same code | Exercise implemented session automatic tax and customer-location collection |
| Registrations | Existing live BG standard and Union OSS registrations read back; their configuration and head office copied into the isolated sandbox only. Live global Tax settings preserved | Verify applicable collection in real sandbox flows; these test copies create no new real-world registration |
| Receipts | Shared live successful-payment and refund emails off; Nibomo dispatch uses the existing private Resend sender | Verify real localized payment/refund delivery and customer presentment amounts using the procedure above |
| Trial reminders | Shared live trial reminder off; Nibomo handles `customer.subscription.trial_will_end` | Verify future-trial guards, clearly labeled base price and sender delivery |
| Other billing emails | Live renewal, expiring-card, failed-card-payment and failed-bank-debit emails on | Inspect the actual messages and management destination for Nibomo before launch |
| Recovery | Smart retries enabled, maximum 4 attempts over 3 weeks; first failure leaves overdue, exhaustion cancels; incomplete authentication cancels after 15 days; disputed payment leaves overdue | Exercise grace, recovery, terminal cancellation and explicit refund/dispute handling against the entitlement mapping |
| Billing defaults | Live Classic and sandbox Flexible Dashboard billing modes; live upcoming-invoice event 7 days before and shared Checkout one-subscription limit off | Exercise explicit flexible mode and owned trial/session orchestration |
| Sandbox email evidence | Future-trial reminder, converted payment receipt and two refund receipts reached the authorized inbox; SPF, DKIM and DMARC passed | Live delivery and unexercised retry/erasure cases remain separate checks |
| Runtime | Backend, web purchase/return UI, receivers, reconciliation and product email dispatch are deployed | Close the remaining manual acceptance cases below |
| Legal | Stripe/Resend terms and privacy wording deployed; English, Russian and Arabic public pages returned 200, including Arabic RTL | Recheck public links during final activation |

The product code is an **inference** from server-hosted AI chat being the primary
paid benefit, using Stripe's
[tax category](https://docs.stripe.com/tax/tax-codes) label “Artificial Intelligence
as a Service (AIaaS) - Cloud Based - Personal Use”. It is the observed product
classification, not a claim of Stripe's independent approval or a new tax
registration. Inclusive pricing alone neither calculates tax nor establishes
collection obligations.

### Observed Sandbox acceptance

Manual browser and operator API observations on **2026-10-03**, against the deployed
web/backend and the isolated account in the inventory. No local project test,
smoke suite, build or deployment was run. No Live transaction or merchant-wide
setting was changed. Actual captures are in the [media index](media/stripe-subscriptions/README.md).

| Check | Observed result |
| --- | --- |
| Authentication and environment | Ordinary configured review-account sign-in succeeded. The backend selected Sandbox; the client supplied no environment. Offer/subscriptions returned 200 and `Cache-Control: no-store` |
| Hosted trial | The app opened actual Stripe Checkout. Nibomo icon/name, Sandbox badge, seven days free, required payment method, renewal disclosure and Nibomo legal links rendered. Provider state confirmed a 604800-second trial and attached test payment method |
| Price and tax | USD 699-cent monthly inclusive base, quantity one; automatic tax completed. Checkout presented EUR 6.46 after the trial and EUR 0 due initially. The later successful charge carried EUR 646-cent presentment; invoice total USD 699 cents included USD 117 cents tax |
| Shared access and return | Owned Checkout return completed; the app showed Premium, Active, trial dates and the backend-derived 1000-message allowance. Access came from shared entitlement sync |
| Period-end cancellation | Stripe remained `trialing` with `cancel_at_period_end=true`; app detail remained `active`, with `willRenew=false` and the original access end. The screen retained Premium access |
| Future reminder | After shortening the actual trial to two days, Stripe emitted `customer.subscription.trial_will_end`. Nibomo sent one future-dated reminder with explicitly labeled USD 6.99 monthly base price, final billing-currency disclosure and the fixed settings link |
| Failed payment and recovery | Ending the trial with the vendor decline fixture produced `past_due` and app `in_grace`. Paying the same invoice with the original hosted test method restored Stripe/app `active` |
| Partial and full refund | USD 100 cents / EUR 92 cents refunded first: access stayed active. Refunding the USD 599-cent / EUR 554-cent remainder revoked the fully refunded current-period contribution while the provider subscription was still active |
| Payment/refund communications | One EUR 6.46 payment receipt and one receipt for each EUR 0.92 / EUR 5.54 refund. Resend reported delivered; all four messages including the reminder were in the authorized Gmail inbox with SPF, DKIM and DMARC passes |
| Portal | Owned Portal opened with the Nibomo Premium headline, trial/current price, EUR billing disclosure, cancellation, payment-method, billing-details and invoice-history controls. No customer-bearing Portal screenshot is retained |
| Repeat eligibility and cleanup | After cancelling the subscription, another real Checkout reused the same Stripe customer and returned `trialDays=0`. That open Checkout was expired. No future test renewal remains |
| Localization | Arabic subscription copy rendered with document `lang=ar` and `dir=rtl`; browser language was restored afterwards. This is not evidence for a different persisted server locale or a hosted unsupported-language fallback |
| Actual delivery and replay | API Gateway recorded 29 primary lifecycle and five later genuine Dashboard replay POSTs, all 204. Dashboard delivery readback confirmed `2026-09-30.endive`. Replaying the old trial, both paid event types and both refunds after cancellation left four delivered emails, shared Free access and the refunded contribution revoked; no stale reminder was sent |
| Focused Git/log secret audit | No private Stripe/Resend credentials found in 4519 tracked files, 8260 reachable historical blobs in the inspected Stripe/web/infra paths, or 2385 recent backend/API log records. Runtime vault contained restricted API keys, not operator keys |
| Deployed web artifact secret audit | No known private Stripe/Resend credential or credential-pattern matches in 107 distinct responses: one HTML page, 105 JavaScript files and one stylesheet. The inspected graph includes Subscription settings/Stripe subscriptions, Premium offer code and all 50 Stripe locale maps (2750 entries). Every accepted response returned 200 with its expected content type; HTML shell fallbacks are excluded from JS/CSS coverage |
| Live gate and free cap | Deployed HTTP backend and GitHub variable both read `false` for Live Checkout. Free-account message cap remains unactivated; free guest 15 and paid/lifetime 1000 are unchanged |

The secret audit compares known private values in memory and credential patterns.
Hosted coverage is the `app.nibomo.com` HTML entry and its recursively discovered
literal JavaScript/CSS references: Vite `assets/` dependency entries resolve from
the app root, while relative imports resolve from their containing module. All
50 deployed Stripe maps contain their exact 55 source keys and values. The audit
does not execute the app or cover source maps, service workers, media, computed
asset URLs, external hosts or native builds. Git and log coverage remains bounded
to the named paths and observation window; this is not a claim about all historical
repository paths, all cloud artifacts or all provider traces. Public Stripe account
IDs are deliberately not secrets. No secret,
customer ID, email address, raw authenticated response or session URL belongs in
this acceptance record or its screenshots.

### Remaining manual acceptance

These cases are **not passed by the primary lifecycle above**. Keep them explicit
until actual evidence is available; do not manufacture signed events or attach
a test clock through a test-only account/database binding.

1. Check delayed/retried delivery after the provider's idempotency window using
   the documented recovery procedure. The same-day actual Dashboard replays above
   prove duplicate and stale-event handling, not recovery after that window.
2. Exercise a subsequent monthly renewal and healthy later period after an older
   refund, using an actual compatible test-clock flow or the real provider billing
   schedule. Compare charge presentment and invoice tax with the renewal receipt.
   The first post-trial invoice above is not a subsequent monthly renewal.
3. On dedicated owned test accounts with existing Apple/Google trial history and
   lifetime/native access, verify Stripe trial independence and highest-rank shared
   access while separately managing every subscription. Do not alter native review
   accounts or release native apps for this check.
4. Interrupt Checkout before completion, return after actual delayed delivery,
   and switch between two authorized accounts. Old return/Portal identifiers must
   not grant access or open another account's billing. Verify guest/agent refusal
   and Session origin/CSRF refusal through the deployed routes.
5. In an authorized disposable-account exercise, delete while a Nibomo Checkout is
   open and while subscriptions exist on historical owned customers. Verify future
   billing cancels before erasure. Introduce a controlled provider failure without
   changing shared runtime credentials; expect the documented 503 and intact
   account. Verify pending email private fields clear on erasure.
6. Exercise a real Sandbox dispute/lost/won sequence and confirm only the affected
   current payment contribution changes. Inspect retry exhaustion/terminal expiry
   independently of refund revocation. Use the existing provider flow rather than
   an invented application event.
7. Set a supported persisted account locale unsupported by Stripe through its
   ordinary profile flow, then verify the hosted English fallback and localized
   Nibomo emails. Browser-only language selection is a separate preference.
8. Exercise controlled email transport failure and concurrent sends. Verify
   committed access, the original frozen retry request/key, terminal private-field
   clearing and explicit operator recovery outside the safe retry window. Do not
   use a new idempotency key to make an ambiguous send look successful.

### CI-only Live activation

Live activation remains a separate final gate, after essential real acceptance,
legal/email/security checks and the reviewed metadata patch have merged. A GitHub
variable readback alone does not deploy a runtime flag.

1. Verify the reviewed `main` commit and all required cloud checks. Recheck
   [Terms](https://nibomo.com/terms/) and [Privacy](https://nibomo.com/privacy/).
   Their canonical Stripe/Resend wording is maintained in the website repository's
   [terms source](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/terms/index.md)
   and [privacy source](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/privacy/index.md).
2. The authorized activation operator sets `CDK_STRIPE_CHECKOUT_LIVE_ENABLED=true`
   and dispatches the existing `AWS/Web Release` workflow on `main`. Its manual
   dispatch selects the deployment components. Do not run AWS deployment locally,
   bump versions or dispatch mobile/MCP publication workflows for this activation.
3. Watch every selected deployment and release gate to completion; read back the
   actual HTTP backend `STRIPE_CHECKOUT_LIVE_ENABLED=true`. Verify normal-account
   offer availability and the existing review account's server-selected Sandbox.
   A real financial purchase needs its own user authorization.
4. On a failed activation gate, restore the variable to `false` and deploy the
   correction through the same CI path. Verify the runtime readback.


## Stripe references

- [Products](https://docs.stripe.com/api/products/create),
  [prices](https://docs.stripe.com/api/prices/create), and
  [inclusive tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
- [Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
  and [configuration API](https://docs.stripe.com/api/customer_portal/configurations/create).
- [Checkout appearance](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=stripe-hosted),
  [trial reminders](https://docs.stripe.com/payments/checkout/free-trials?payment-ui=stripe-hosted),
  and [API changelog](https://docs.stripe.com/changelog).
