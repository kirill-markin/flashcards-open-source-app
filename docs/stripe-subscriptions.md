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

The configuration holds the catalog, tax, portal and branding settings in both environments. The
store setup it cannot hold:

| Setting | Selected value |
| --- | --- |
| Business | SAMO DANNI EOOD; isolated sandbox `Nibomo Subscriptions` |
| Product statement descriptor | `NIBOMO PREMIUM` read back; verify actual payment statement presentation before launch |

The trial belongs to a Checkout Session, not a second product or zero-price
catalog entry, and collects a payment method for automatic renewal. Customer
mapping and trial eligibility must be server-owned and survive repeat checkout
attempts: do not mint a new Stripe customer on each attempt. Pass a trial only when that customer is eligible; otherwise show the
non-trial purchase copy. A mobile trial history does not consume this trial.

The live account's historical default API version is preserved for its other
integrations; this integration always sends its pinned version. Catalog and endpoint readiness do not establish a Live purchase or email delivery.

## Regional offers and Managed activation gate

The [regional resolver](../apps/backend/src/billing/regionalPricing/offers.ts) owns
country-to-band-to-Price selection over the canonical country lists and known catalog,
with Managed Payments as its target sale mode. Existing attempts retain their frozen
mode and Price; existing subscriptions are never converted. Migration `0234` must deploy
before the country-aware backend and dependent web/public-offer consumers. Its additive
defaults preserve old backend inserts during deployment.

All new reservations use the resolved Managed offer, including when country is omitted.
Existing attempts keep their frozen legacy or Managed selection. Keep
`STRIPE_CHECKOUT_LIVE_ENABLED=false` until real Managed acceptance, the dependent web
selector and public marketing offer are deployed, and the separate CI-only activation below.

Offer and subscription queries accept optional `country=XX`; Checkout accepts optional
`{ "country": "XX" }`, with `{}` still valid. Codes are normalized to uppercase and unknown
codes fail explicitly. `basePrice` remains available to old clients. `selectedOffer` identifies
the requested new sale; pending Checkout `offer` identifies its frozen original selection
and provider amount, and each subscription's `basePrice` describes its actual purchased Price.
Country, band, Price and mode commit with locale, trial and expiry before the first Session POST.
Retries retain that attempt and its idempotency key. An omitted country resumes an
existing attempt unchanged.

A changed country never silently replaces an open offer: the Checkout response includes
its original `offer` and `requoteRequired`. The human-only
`POST /v1/billing/stripe/checkout/requote` accepts `{ "attemptId": "...", "country": "XX" }`.
It rechecks ownership and subscriptions, recovers the original attempt if necessary, confirms
provider expiration, then reserves a new offer through the ordinary Checkout flow. Completion
races require reconciliation. Country changes do not reset account trial history. The shared
resolver performs no identity/subscription reads. The display-only
[public offer](regional-subscription-pricing.md#public-web-offer) uses the same resolver.

The independent [tax coverage config](../apps/backend/src/billing/regionalPricing/taxCoverage.json)
records Stripe's 82 published codes, including all EU27. An uncovered selected country makes
new sales unavailable. The selector is a commercial preference, not evidence of billing
jurisdiction, card origin or sanctions eligibility. Customers across the EU may choose any
supported EU offer; no residence/card-country matching is enforced.

Production Managed Payments is configured Ready to use, with Nibomo's explicit AI product tax
code and inclusive Prices. Shared Consulting tax defaults remain separate. Radar Plus is
approved and the Nibomo-scoped rules are enabled at 100%: production
`ssr_1UWa7JE3K3xV54NrXpF9XY20`, sandbox `ssr_1UWaH0CVkVWAch1VcPotdcoB`.
They block when `::customer:nibomo_tax_coverage_required:: = 'true'` and
`billing_address_country` is missing or outside the coverage config. Before a new Managed
Session POST, after the existing-subscription guard, the backend verifies Nibomo Customer
ownership and sets/verifies `customer.metadata.nibomo_tax_coverage_required='true'`.
Customer metadata scopes the documented Radar attribute across payments and renewals;
Session/Subscription metadata alone does not. Legacy retries and bulk customer history are
never tagged. Keep the configured rule's country set aligned with the config. Serbia coverage
applies only while the seller is not VAT-registered in Serbia; a registration requires an
operator coverage/rule review before further sales there.

Real sandbox allowed-country purchase and blocked/missing billing-country acceptance,
including a buyer changing country inside hosted Checkout and subsequent renewal handling,
remain final activation gates. Configuration readiness is not proof of that acceptance.
References: [Managed Checkout migration](https://docs.stripe.com/payments/managed-payments/update-checkout),
[tax coverage](https://docs.stripe.com/payments/managed-payments/tax-compliance), and
[Radar metadata attributes](https://docs.stripe.com/radar/rules/reference#metadata-attributes).

## Authoritative copy and localization

[locales/en.json](../apps/backend/src/billing/stripe/copy/locales/en.json) is the English source;
every [web locale catalog](../apps/web/src/i18n/catalogs/) imports its own map from the
[backend copy sources](../apps/backend/src/billing/stripe/copy/locales/) through the
[typed adapter](../apps/web/src/i18n/stripeCatalog.ts), and the
[billing email dispatcher](../apps/backend/src/billing/stripe/email.ts) reads the same maps.

Keep `{count}`, `{price}`, `{date}`, `{provider}` and `{url}` verbatim in translations.
`{count}` is a locale-formatted backend allowance (currently 1000 for Premium and
lifetime); Stripe product text is rendered with that selected offer value before
upload, never with a literal placeholder. `{price}` is the provider-derived,
locale-formatted amount and currency for the offer or renewal being described,
or the actual successful payment/refund amount in receipt emails.
`{date}` is a locale-formatted server/provider date; `{provider}` is the relevant
store name. `{url}` is the allowlisted absolute Subscription settings URL below
or, in receipt emails, a trusted provider receipt/invoice URL; never a customer-supplied
redirect. Do not hardcode USD formatting in translated copy.

Use trial copy only for eligible customers; show the payment-method requirement,
post-trial monthly amount, automatic renewal, cancellation path and inclusive tax
notice before purchase. A currency selection in hosted Checkout can change the
presented amount; disclose the final amount there and use actual provider values
for subsequent renewal views. Never promise a converted amount that Stripe has
not supplied. `offer.allowanceWindow` distinguishes the UTC calendar-month
allowance from the subscription billing period.

Stripe's product name, description, marketing features and this portal configuration's headline
are single English strings; they do not select a locale map. Hosted Checkout follows
[`stripeHostedLocale`](../apps/backend/src/billing/stripe/checkoutPresentation.ts).

Validate the [portal session locale](https://docs.stripe.com/api/customer_portal/sessions/create)
separately; its automatic choice uses the customer's `preferred_locales` or browser
locale. Do not assume the portal accepts every Checkout locale. English custom
product/headline text remains English even when Stripe's controls are localized.

## Branding

The [Stripe media inventory](media/stripe-subscriptions/README.md) links the icon sources and the
captures. The live account's existing branding is preserved. Checkout branding is set per session
from the environment's `business_icon` ID; inspect real hosted rendering before activation. The
display-name override affects the top of Checkout, not the business name in receipts and terms.

A dedicated portal configuration isolates feature settings, headline and legal
URLs, **not account branding**. The portal uses shared account branding. Review
that appearance before activation without overwriting unrelated products' assets.
Shared Checkout policy links are disabled and its support website points to
`https://kirill-markin.com/`. Keep Nibomo legal/support links in the app and its
portal configuration; use supported Checkout `custom_text` for session-specific
copy and policy links after verifying rendering. The reference allows up to 1200
characters per custom message. Do not enable shared policy toggles as a shortcut.

## HTTP and hosted return contracts

[Routes](../apps/backend/src/routes/stripeBilling.ts),
[Checkout](../apps/backend/src/billing/stripe/checkout.ts) and
[Portal/details](../apps/backend/src/billing/stripe/portal.ts) own the request, response, error and
return-URL contracts. A persisted configured demo email selects Sandbox; everyone else uses
production, and no request can select the environment. The web client never grants access from
return query parameters or provider completion status: it reads the shared entitlement snapshot.

## Receiver and runtime provisioning procedure

Deploy reviewed code through `AWS/Web Release` and wait for the complete release
before creating either endpoint. Do not synthesize, build or deploy AWS locally.
Receiver URLs are:

- Sandbox: `https://api.nibomo.com/v1/billing/stripe/webhooks/sandbox`.
- Production: `https://api.nibomo.com/v1/billing/stripe/webhooks/live`.

The public `/v1` prefix is required by the custom-domain mapping on both permanent
API hosts, `api.nibomo.com` and `api.flashcards-open-source-app.com`. Internal Hono
aliases and the root proxy do not expose unprefixed custom-domain URLs. Register
only one destination per environment.

Configure exactly the events exported by
[`stripeLifecycleEventTypes`](../apps/backend/src/billing/stripe/state.ts).

The HTTP backend receives these nonsecret deployment inputs; the hourly importer
also receives the secret ARN for [native history reads](billing-history.md#stripe-inventory-and-backfill):

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
CDK grants that secret's read access to the HTTP backend and existing hourly
store-analytics importer and injects its ARN, never its value.
Chat/MCP/auth functions and frontend/build environments receive
neither secret values nor a Stripe runtime grant.

The [runtime parser](../apps/backend/src/billing/stripe/config.ts) defines the vault JSON. An
API-key-only provisioning object deliberately fails closed; never invent
placeholder signing secrets. Preserve both approved restricted keys when adding
their real endpoint secrets. The nine runtime permissions are Accounts read,
Charges and Refunds read, Payment Disputes read, Invoices read, Prices read,
Customers write, Customer Portal write, Subscriptions write and Checkout Sessions
write. Operator/admin keys must never enter this vault.

After deployment, an authorized operator creates each endpoint in its matching
Stripe account with the API version pinned by
[`stripeApiVersion`](../apps/backend/src/billing/stripe/catalog.ts) and the
`stripeLifecycleEventTypes` events above, capturing its signing secret
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

[Deletion](../apps/backend/src/billing/stripe/deletion.ts) cancels future Nibomo renewals on every
owned customer before erasure, across all clients, independently of lifetime or mobile access. No
automatic refunds or prorations occur, and other Stripe products and Apple/Google subscriptions are
unaffected. Billing-history anonymization is in
[Premium entitlements](premium-entitlements.md#guest-upgrade-reaping-and-deletion).

## Product billing email verification

[Email dispatch](../apps/backend/src/billing/stripe/email.ts) owns selection, amounts, locks,
retries and deduplication. The existing HTTP backend `RESEND_API_KEY` and `RESEND_FROM_EMAIL` supply
the private transport and sender, with display name Nibomo.
Resend acceptance is recorded separately from inbox delivery, which still needs the checks below.
Use only sanitized error codes and provider message IDs when recording evidence.

For subscriptions whose verified Stripe `managed_payments.enabled` is true, Link sends mandatory
payment/invoice and refund receipts, regardless of the shared Dashboard receipt settings. Nibomo
suppresses its overlapping receipts before projection and outbox reservation. Legacy subscriptions
and their queued deliveries keep their existing Nibomo receipt and retry behavior. Link also sends a
trial-start email; its mandatory trial-ending reminder applies only to trials longer than seven days.
Nibomo retains its trial-ending reminder for the seven-day trial. See
[Managed Payments email ownership](https://docs.stripe.com/payments/managed-payments/how-it-works).

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
| Legal | Stripe/Resend terms and privacy wording deployed; English, Russian and Arabic public pages returned 200, including Arabic RTL | Recheck public links during final activation |

The product code is an **inference** from server-hosted AI chat being the primary
paid benefit, using Stripe's
[tax category](https://docs.stripe.com/tax/tax-codes) label “Artificial Intelligence
as a Service (AIaaS) - Cloud Based - Personal Use”. It is the observed product
classification, not a claim of Stripe's independent approval or a new tax
registration. Inclusive pricing alone neither calculates tax nor establishes
collection obligations.

### Observed Sandbox acceptance

On **2026-10-03**, manual browser and operator API checks against the deployed web/backend and the
isolated Sandbox account passed the primary lifecycle: Sandbox selection for the configured review
account, hosted trial Checkout with Nibomo branding, automatic tax and Adaptive Pricing, shared
access on return, period-end cancellation, the future trial reminder, failed payment into grace and
recovery, partial and full refund, payment and refund receipts with SPF/DKIM/DMARC passes, the owned
Portal, repeat-trial ineligibility, Arabic RTL rendering, genuine Dashboard replays, and focused
secret audits of Git, logs and the deployed web artifact. No Live transaction or merchant-wide
setting was changed. Captures are in the [media index](media/stripe-subscriptions/README.md); no
secret, customer ID, email address, raw authenticated response or session URL belongs in this record
or its screenshots.

### Remaining manual acceptance

These cases are **not passed by the primary lifecycle above**. Keep them explicit
until actual evidence is available; do not manufacture signed events or attach
a test clock through a test-only account/database binding.

1. Check delayed/retried delivery after the provider's idempotency window. A
   result still unresolved past that window, or a provider payload conflict, is
   reconciled by the operator against the provider record: do not delete its
   receipt or issue a new key. The same-day actual Dashboard replays above
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
   changing shared runtime credentials; expect 503
   `ACCOUNT_DELETE_STRIPE_CANCELLATION_FAILED` from
   [deletion](../apps/backend/src/billing/stripe/deletion.ts) and an intact
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
   clearing and explicit operator recovery (case 1) outside the safe retry window. Do not
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
