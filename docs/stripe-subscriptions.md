# Stripe subscriptions

Nibomo Premium's sandbox and live catalogs, dedicated portal configurations and
branding uploads were read back on **2026-10-03**. All 50 repository locale maps
feed the web locale catalogs. The canonical non-secret identifiers and observed settings are in
[configuration.json](stripe-subscriptions/configuration.json); this is preparation
data, not application configuration. Web purchasing and lifecycle handling remain
future implementation work. No customer, Checkout Session, subscription, portal
session, Payment Link or webhook endpoint was created by this preparation.

[Premium offer](premium-offer.md) owns the shared price, benefits and limits;
[Premium entitlements](premium-entitlements.md) owns access and provider-state
rules. [Subscription store metadata](subscription-store-metadata.md) owns mobile
catalog material. This preparation changes none of those runtime contracts.

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
| Local currency presentation | Stripe Adaptive Pricing; both toggles and USD settlement verified, session lifecycle verification pending |
| Tax behavior | Explicit `tax_behavior=inclusive` on the price; never inherit the account default |
| Tax calculation | Product tax code and active Tax settings read back; customer-location collection and automatic calculation remain session implementation work (see settings audit) |
| Trial (future session setting) | 7 days with a payment method collected for automatic renewal; catalog price has no trial |
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
activate the free-account 50-message limit or make web purchases available.

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
| Dedicated portal | Active in each environment; period-end cancellation with no proration, payment-method updates, invoice history and name/email/address/tax-ID edits enabled |
| Portal restrictions | Subscription plan/quantity changes, pause, cancellation survey and public login page disabled |
| Portal defaults | First sandbox configuration is naturally the default; live Nibomo configuration is not the shared default. Always pass its explicit ID |
| Branding | 512 × 512 `business_icon` uploads and public product image links verified; [media evidence](media/stripe-subscriptions/README.md) |
| API pin | Explicit `Stripe-Version: 2026-09-30.endive` returned HTTP 200 in both environments. Use it for future integration and event destinations after implementation |
| Historical live account default | `2020-08-27`, preserved; never rely on that default for the new integration |
| Webhooks | Zero endpoints in both environments; endpoint IDs and signing secrets do not exist for this integration |

Catalog preparation does not verify checkout, payment, renewal, portal-session
rendering or email delivery. Those require the real acceptance flows below.

## Authoritative copy and localization

[locales/en.json](../apps/backend/src/billing/stripe/copy/locales/en.json) is the single English
source: **55 keys**, each mapping directly to one string. All 50 canonical maps
live in [backend copy sources](../apps/backend/src/billing/stripe/copy/locales/).
Each [web locale catalog](../apps/web/src/i18n/catalogs/) imports its own map;
the [typed adapter](../apps/web/src/i18n/stripeCatalog.ts) exposes nested keys such
as `stripe.offer.title`. English remains in the app shell and other languages
retain their lazy locale chunks. Catalog availability does not enable Checkout
or replace the existing Premium placeholder. The map also supplies product,
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

`limit.freeExplanation` is prepared for the future coordinated limit rollout; it
does not enable that limit. Own-key copy belongs in the AI allowance context.
`deletion.*` supplements the app’s existing account/data-deletion confirmation and
must ship only with the cancellation behavior below. Technical errors follow the
web app’s actionable error presentation without exposing raw provider responses.
`email.*` prepares Nibomo-specific trial reminders and receipts for successful
payments and refunds. It does not send mail or enable shared Stripe emails;
the sending mechanism and schedule remain integration work.

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
they do not automatically select one of these 50 maps. Future Nibomo UI and
supported per-session custom text must select and render their own locale copy.

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
`icon.file` using the environment's `business_icon` ID. Apply these when sessions
are implemented and inspect real hosted rendering; the upload alone does not
brand a Checkout Session. The display-name override affects the top of Checkout,
not the business name in receipts and terms.

A dedicated portal configuration isolates feature settings, headline and legal
URLs, **not account branding**. The portal uses shared account branding. Review
that appearance before activation without overwriting unrelated products' assets.
Shared Checkout policy links are disabled and its support website points to
`https://kirill-markin.com/`. Keep Nibomo legal/support links in the app and its
portal configuration; use supported Checkout `custom_text` for session-specific
copy and policy links after verifying rendering. The reference allows up to 1200
characters per custom message. Do not enable shared policy toggles as a shortcut.

## Return routes and future integration

The current [subscription route](../apps/web/src/routes.ts) is
`/settings/subscription`. Use the allowlisted absolute production return URL
`https://app.nibomo.com/settings/subscription` for hosted Checkout success/cancel
and the customer portal. Return-state query parameters and any session-reference
transport are **proposals to define during integration**, not existing handlers.
A return URL alone never proves payment or grants access: authenticate the current
account and resolve the subscription on the backend. Do not accept arbitrary
client-supplied return URLs, and handle logout/account changes before refreshing.

### Future Checkout inputs

Use the explicit API pin in the inventory, `mode=subscription`, hosted Checkout
(`ui_mode=hosted_page` in the verified Endive reference), the environment's price
and quantity 1. The [create reference](https://docs.stripe.com/api/checkout/sessions/create)
confirms these inputs; none has been exercised in a Nibomo session yet:

| Input | Required integration behavior |
| --- | --- |
| `customer` | Reuse the server-owned customer for this Nibomo account/environment; verify account ownership |
| `subscription_data.trial_period_days=7` | Only for eligible customers; omit after that Stripe customer's trial is consumed |
| `payment_method_collection=always` | Collect a payment method even when the trial makes the amount due zero |
| `adaptive_pricing.enabled=true` | Enable eligible session currency localization explicitly |
| `automatic_tax.enabled=true` | Calculate tax using customer location and the configured registrations; persist required address updates for a reused customer |
| `branding_settings`, `locale`, `custom_text` | Apply the Nibomo icon, supported hosted locale and rendered localized disclosures described above |
| `success_url`, `cancel_url` | Use the allowlisted Subscription settings destination; define return-state handling in the implementation |

[Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=stripe-hosted)
requires compatible settlement currency and eligible session/payment methods.
Live USD settlement and enabled Dashboard toggles in both environments were
verified. Sandbox USD settlement was added while preserving EUR as default.
Use the explicit session parameter and verify the trial, first payment and later
renewals in the customer's presented currency. International subscription support
is limited to cards, Link, Apple Pay and Google Pay in the inspected reference.
Do not replace the chosen approach with manual regional prices if verification
fails; report the exact requirement.

### Proposed backend routes and secrets

The existing web route is described above. The following backend routes are
**proposals**, absent from the current route/Gateway inventory:

| Proposed route | Purpose |
| --- | --- |
| `GET /billing/stripe/offer` | Authenticated offer, actual currency/price and customer trial eligibility |
| `POST /billing/stripe/checkout` | Create a hosted session for the authenticated account |
| `GET /billing/stripe/subscriptions` | Reconcile and return that account's Stripe purchases |
| `POST /billing/stripe/portal` | Create an authenticated portal session with the explicit configuration ID |
| `POST /billing/stripe/webhooks/sandbox` | Sandbox signed event receiver |
| `POST /billing/stripe/webhooks/live` | Live signed event receiver |

Proposed receiver URLs are `https://api.nibomo.com/billing/stripe/webhooks/sandbox`
and `https://api.nibomo.com/billing/stripe/webhooks/live`. Implement the routes and
[API Gateway](../infra/aws/lib/gateways/api-gateway.ts) together. Deploy signature
verification, persistence, ownership checks, idempotency and reconciliation through
CI/CD **before** registering either endpoint with the pinned event API version.

Candidate event subscriptions for implemented handlers are
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `customer.subscription.trial_will_end`,
`invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
`charge.refunded`, `refund.updated`, `refund.failed`, `charge.dispute.created`,
`charge.dispute.updated` and `charge.dispute.closed`. Finalize this list against
[Stripe lifecycle events](https://docs.stripe.com/billing/subscriptions/webhooks)
and the implemented handlers; events alone do not settle refund/dispute entitlement
policy. Fetch authoritative state and follow the shared entitlement contract.

Private operator access is established using `STRIPE_ADMIN_API_KEY` plus
`STRIPE_ACCOUNT_ID`, and `STRIPE_SANDBOX_ADMIN_API_KEY` plus
`STRIPE_SANDBOX_ACCOUNT_ID`, in the main checkout's ignored `.env`. These are
operator credentials, not provisioned application secrets. Proposed runtime
secret names are `STRIPE_LIVE_SECRET_KEY`, `STRIPE_SANDBOX_SECRET_KEY`,
`STRIPE_LIVE_WEBHOOK_SIGNING_SECRET` and `STRIPE_SANDBOX_WEBHOOK_SIGNING_SECRET`.
Provision runtime API access privately during implementation; provision signing
secrets only when registering endpoints after receiver deployment. Keep values
out of Git, client bundles and logs. A server-created hosted Checkout URL can be
redirected to without a frontend publishable key.

### Account deletion

The settled Stripe behavior is automatic cancellation of future renewals when an
account is deleted. The shared backend deletion path must cover deletion from web,
iOS, Android and the agent API, including accounts with multiple Stripe purchases
or a lifetime gift. Cancellation applies to Nibomo subscriptions, never unrelated
products attached to the same Stripe customer. It does not cancel Apple or Google
subscriptions. Ordinary cancellation while keeping the account retains access to
the end of the current period under the entitlement contract.

Before erasing account/customer links, confirm that every affected Stripe
subscription will generate no future renewal charge. Prevent a racing checkout
from attaching a renewable subscription during deletion, including an already
open Checkout Session. If cancellation cannot be confirmed, stop deletion with
`deletion.cancellationFailed`; preserve the account and enough state to retry.
Keep the process idempotent across provider success and local transaction failure.
Implement this contract before displaying the deletion promise. Do not infer it
from a mobile warning or treat an account deletion as an automatic refund policy.
The billing-history anonymization requirements remain in
[Premium entitlements](premium-entitlements.md#guest-upgrade-reaping-and-deletion).

## Verified settings and remaining launch gates

The [configuration inventory](stripe-subscriptions/configuration.json) records the
sanitized 2026-10-03 catalog/API readback and Dashboard settings audit. This table
distinguishes those observations from application work:

| Area | Observed preparation state | Required before activation |
| --- | --- | --- |
| Tax | Tax active in both environments; explicit inclusive prices and product code `txcd_10105001`. Sandbox defaults use Stripe/inclusive/the same code | Enable and exercise session automatic tax and customer-location collection |
| Registrations | Existing live BG standard and Union OSS registrations read back; their configuration and head office copied into the isolated sandbox only. Live global Tax settings preserved | Verify applicable collection in real sandbox flows; these test copies create no new real-world registration |
| Receipts | Shared live successful-payment and refund emails off; default language English, sender `stripe.com` | Choose and implement Nibomo receipt/payment/refund communication without silently changing other products' messages; portal invoice history alone is not email delivery |
| Trial reminders | Shared live trial reminder off; subscription-management email link and trial-over descriptor off; legacy trial link points to Kirill's LinkedIn profile | Implement the prepared product-specific `email.*` reminder with actual price/end date/management URL and verify delivery; no sender or schedule is deployed |
| Other billing emails | Live renewal, expiring-card, failed-card-payment and failed-bank-debit emails on | Inspect the actual messages and management destination for Nibomo before launch |
| Recovery | Smart retries enabled, maximum 4 attempts over 3 weeks; first failure leaves overdue, exhaustion cancels; incomplete authentication cancels after 15 days; disputed payment leaves overdue | Exercise grace, recovery, terminal cancellation and explicit refund/dispute handling against the entitlement mapping |
| Billing defaults | Live Classic and sandbox Flexible Dashboard billing modes; live upcoming-invoice event 7 days before and shared Checkout one-subscription limit off | Set intentional integration behavior; do not assume a shared toggle enforces Nibomo trial eligibility or purchase ownership |
| Sandbox email evidence | No sandbox delivery evidence; live email/retry observations do not establish sandbox settings | Stripe does not send trial reminder emails in a sandbox; verify the chosen Nibomo sender separately |
| Runtime | Session branding, per-session Adaptive Pricing and product-specific reminder copy are supported/prepared inputs only | Implement and deploy the provider, sessions, webhooks, messages and UI |
| Legal | Dedicated portal legal URLs set; Stripe-specific website wording still pending | Update public terms/privacy against actual billing data and behavior before accepting live purchases |

The product code is an **inference** from server-hosted AI chat being the primary
paid benefit, using Stripe's
[tax category](https://docs.stripe.com/tax/tax-codes) label “Artificial Intelligence
as a Service (AIaaS) - Cloud Based - Personal Use”. It is the observed product
classification, not a claim of Stripe's independent approval or a new tax
registration. Inclusive pricing alone neither calculates tax nor establishes
collection obligations.

1. Merge reviewed preparation inputs and this verified inventory before application
   work; cloud PR checks and triggered post-merge workflows own project validation.
2. Implement stable customer mapping, trial eligibility and lifecycle persistence
   over the shared entitlements; deploy receivers before registering endpoints.
   Preserve environment separation and retain enough state for deletion/retries.
3. Use the Stripe namespace in the web catalogs to replace the Premium placeholder
   in Subscription settings, AI allowance, accent-color and Tests entry points.
   Preserve guest email linking, own-key access, cached local features and immediate
   feedback. Resume the original action only for the same account and confirmed access.
4. Complete sandbox/manual acceptance: eligible trial, repeat-customer ineligibility,
   prior mobile trial eligibility, payment-method collection, inclusive tax,
   converted-currency first payment/renewal, real hosted branding/locales, interrupted
   or delayed return, failed payment/recovery, period-end cancellation and retained
   access, refunds/disputes, duplicate/out-of-order webhooks, logout/account switch,
   lifetime plus a separate subscription, and deletion with provider failure or
   racing checkout. Verify customer and environment ownership throughout.
5. Complete Nibomo-specific reminder and receipt decisions/delivery, portal appearance
   review and website legal updates. Capture implemented screens after they exist.
6. Activate live purchases only after these gates pass. The free-account 50-message
   limit remains a separate coordinated rollout; preparation does not activate it.

The inspected [Terms](https://nibomo.com/terms/) and
[Privacy Policy](https://nibomo.com/privacy/) identify the operator and general
data/deletion rules but do not yet describe Stripe recurring billing, the trial,
inclusive tax presentation, Stripe processing or Stripe renewal cancellation on
account deletion. Their canonical sources are the neighboring website repository’s
[`terms/index.md`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/terms/index.md)
and [`privacy/index.md`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/privacy/index.md).
Before activation, update that repository's Stripe billing terms and privacy
wording against the implemented flow: data actually shared with Stripe (such as
email, billing address and customer/subscription identifiers), payment processing,
retention/anonymization, trial/renewal disclosures and cancellation on deletion.
Coordinate the legal translations there. Separate Apple privacy work does not
close this Stripe launch gate. These inputs do not publish legal pages or establish
a refund or tax-registration policy from their current silence.

## Stripe references

- [Products](https://docs.stripe.com/api/products/create),
  [prices](https://docs.stripe.com/api/prices/create), and
  [inclusive tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
- [Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
  and [configuration API](https://docs.stripe.com/api/customer_portal/configurations/create).
- [Checkout appearance](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=stripe-hosted),
  [trial reminders](https://docs.stripe.com/payments/checkout/free-trials?payment-ui=stripe-hosted),
  and [API changelog](https://docs.stripe.com/changelog).
