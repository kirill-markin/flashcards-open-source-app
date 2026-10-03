# Stripe subscriptions

Repository-owned preparation inputs for Nibomo Premium on the web. The English
copy, branding references and target configuration below are ready for review;
this document does not establish that Stripe resources, settings, translations or
application behavior have been deployed. External resource and settings readback
belongs to preparation item 05. Translation items 02–04 supply the other locales.

[Premium offer](premium-offer.md) owns the shared price, benefits and limits;
[Premium entitlements](premium-entitlements.md) owns access and provider-state
rules. [Subscription store metadata](subscription-store-metadata.md) owns mobile
catalog material. This preparation changes none of those runtime contracts.

## Target configuration

| Setting | Selected value |
| --- | --- |
| Business | SAMO DANNI EOOD; verify the target account before operations |
| Product name and customer-facing description | `product.name` and `product.description` in the [English map](stripe-subscriptions/locales/en.json) |
| Marketing features | `product.aiFeature` and `product.accentFeature` in the English map |
| Internal price nickname | `Nibomo Premium Monthly` |
| Price lookup key, separately in each environment | `nibomo_premium_monthly` |
| Product metadata | `application=nibomo`, `tier=premium` |
| Price metadata | `application=nibomo`, `tier=premium`, `period=monthly` |
| Price | USD 6.99 (`unit_amount=699`), monthly recurring, quantity 1 |
| Local currency presentation | Stripe Adaptive Pricing; verify the account and subscription Checkout flow support it before launch |
| Tax behavior | Explicit `tax_behavior=inclusive` on the price; never inherit the account default |
| Tax calculation | Verify product-specific tax classification, registrations, customer-location collection and Stripe Tax configuration in item 05; inclusive pricing does not itself calculate or register tax |
| Trial | 7 days with a payment method collected for automatic renewal |
| Trial eligibility | Once per Stripe customer; prior Apple or Google trials do not disqualify that customer |
| Web purchaser | Signed-in account with an email; web guests link an email before checkout |
| Proposed product statement descriptor | `NIBOMO PREMIUM`; verify resulting statement presentation before use |
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

Replace pending cells only with verified operational readback, separately for
sandbox and live. Record non-secret identifiers and the observed settings in item
05; do not turn a planned value into a claim that it exists. API-version selection
must be recorded with the actual integration and webhook endpoint configuration.

| Resource | Sandbox | Live |
| --- | --- | --- |
| Stripe account ID | Pending item 05 readback | Pending item 05 readback |
| Premium product ID | Pending item 05 readback | Pending item 05 readback |
| Monthly price ID | Pending item 05 readback | Pending item 05 readback |
| Dedicated portal configuration ID | Pending item 05 readback | Pending item 05 readback |
| Branding file ID | Pending item 05 readback | Pending item 05 readback |
| Integration API version | Pending integration verification | Pending integration verification |
| Webhook endpoint ID and API version | After receiver deployment | After receiver deployment |

Customers, Checkout Sessions, subscriptions and portal sessions are created for
real user actions during integration/testing and launch, not as shared catalog
resources during preparation. Keep credentials and authenticated raw responses
outside Git. Never record customer identifiers or transaction data here.

## Authoritative copy and localization

[locales/en.json](stripe-subscriptions/locales/en.json) is the single English
source: **51 keys**, each mapping directly to one string. These are authoring
keys only. No application imports these files, and future runtime key names are
not prescribed. The map covers every product, portal, offer, return and management
entry from the preparation draft, plus tax, trial, allowance-window, reminder-email and deletion
copy. This document intentionally links the strings instead of duplicating them.

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
| `email.*` | 2 | Future Nibomo-specific trial-reminder subject and body |
| `deletion.*` | 3 | Warning, cancellation progress and failure |

Keep `{count}`, `{price}`, `{date}`, `{provider}` and `{url}` verbatim in translations.
`{count}` is a locale-formatted backend allowance (currently 1000 for Premium and
lifetime); Stripe product text is rendered with that selected offer value before
upload, never with a literal placeholder. `{price}` is the provider-derived,
locale-formatted amount and currency for the offer or renewal being described.
`{date}` is a locale-formatted server/provider date; `{provider}` is the relevant
store name. `{url}` is the allowlisted absolute Subscription settings URL below,
never a customer-supplied redirect. Do not hardcode USD formatting in translated copy. The authoring map
uses single braces from the draft; during implementation explicitly adapt it to
the web catalog’s `{{token}}` convention in the [web localization guide](web-localization.md).

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
`email.*` prepares a future Nibomo-specific trial reminder with actual trial end,
renewal price and management URL. It does not send mail or enable shared Stripe
reminders; the sending mechanism and schedule remain integration work.

### Expected locale files

The inventory is the 50 tags in [supportedLocales](../apps/web/src/i18n/types.ts).
English is authored here. All other 49 files are **pending translation items
02–04**; the links reserve their paths and do not claim that files already exist.
Each translation must contain exactly the same 51 keys and placeholder tokens,
using the locale’s existing Premium, AI, subscription and cancellation terminology.

| Locale files | Locale files | Locale files | Locale files | Locale files |
| --- | --- | --- | --- | --- |
| [en](stripe-subscriptions/locales/en.json) | [ar](stripe-subscriptions/locales/ar.json) | [zh-Hans](stripe-subscriptions/locales/zh-Hans.json) | [de](stripe-subscriptions/locales/de.json) | [hi](stripe-subscriptions/locales/hi.json) |
| [ja](stripe-subscriptions/locales/ja.json) | [ru](stripe-subscriptions/locales/ru.json) | [es-MX](stripe-subscriptions/locales/es-MX.json) | [es-ES](stripe-subscriptions/locales/es-ES.json) | [fr](stripe-subscriptions/locales/fr.json) |
| [pt-BR](stripe-subscriptions/locales/pt-BR.json) | [it](stripe-subscriptions/locales/it.json) | [ko](stripe-subscriptions/locales/ko.json) | [id](stripe-subscriptions/locales/id.json) | [tr](stripe-subscriptions/locales/tr.json) |
| [nl](stripe-subscriptions/locales/nl.json) | [pl](stripe-subscriptions/locales/pl.json) | [vi](stripe-subscriptions/locales/vi.json) | [th](stripe-subscriptions/locales/th.json) | [uk](stripe-subscriptions/locales/uk.json) |
| [he](stripe-subscriptions/locales/he.json) | [sv](stripe-subscriptions/locales/sv.json) | [da](stripe-subscriptions/locales/da.json) | [nb](stripe-subscriptions/locales/nb.json) | [fi](stripe-subscriptions/locales/fi.json) |
| [cs](stripe-subscriptions/locales/cs.json) | [el](stripe-subscriptions/locales/el.json) | [ro](stripe-subscriptions/locales/ro.json) | [hu](stripe-subscriptions/locales/hu.json) | [fa](stripe-subscriptions/locales/fa.json) |
| [ca](stripe-subscriptions/locales/ca.json) | [bn](stripe-subscriptions/locales/bn.json) | [gu](stripe-subscriptions/locales/gu.json) | [kn](stripe-subscriptions/locales/kn.json) | [ml](stripe-subscriptions/locales/ml.json) |
| [mr](stripe-subscriptions/locales/mr.json) | [pa](stripe-subscriptions/locales/pa.json) | [ta](stripe-subscriptions/locales/ta.json) | [te](stripe-subscriptions/locales/te.json) | [ur](stripe-subscriptions/locales/ur.json) |
| [sw](stripe-subscriptions/locales/sw.json) | [bg](stripe-subscriptions/locales/bg.json) | [et](stripe-subscriptions/locales/et.json) | [hr](stripe-subscriptions/locales/hr.json) | [is](stripe-subscriptions/locales/is.json) |
| [lt](stripe-subscriptions/locales/lt.json) | [lv](stripe-subscriptions/locales/lv.json) | [sk](stripe-subscriptions/locales/sk.json) | [sl](stripe-subscriptions/locales/sl.json) | [zu](stripe-subscriptions/locales/zu.json) |

These are repository translations, not a claim that Stripe-hosted UI supports all
50 tags or that arbitrary product descriptions translate automatically. Stripe
owns its hosted UI translations. Verify supported Checkout/portal locale values,
locale mapping and each custom-text field’s localization mechanism during
integration; one portal configuration has one custom headline. Preserve full
50-locale coverage in the Nibomo UI regardless of Stripe’s hosted inventory.

## Branding

Use the [Stripe media inventory](media/stripe-subscriptions/README.md). It points
to the existing vector source and 512 × 512 PNG without copying either asset.
Render product name and features from the English map for an English Stripe
resource. Additional exports are unnecessary unless Stripe rejects the existing
PNG or a distinct upload format is required; record a derived export’s source
and uploaded file ID before use.

Shared Stripe account branding can affect other products. Prefer a supported
Checkout Session branding override for Nibomo; audit the portal’s actual branding
scope before changing anything. A dedicated portal configuration alone does not
isolate account branding. Do not overwrite shared branding for this preparation.

Shared Checkout support/policy settings also affect other products. Keep Nibomo’s
legal links in the app offer and use the dedicated portal configuration’s legal
URLs. For Checkout, review the supported Markdown-link fields under
[`custom_text`](https://docs.stripe.com/api/checkout/sessions/create?query=custom_text)
for product-specific policy links during integration. Do not silently change the
shared business profile or account-wide policy toggles. These links are not a
substitute for the pending legal-page updates.

## Return routes and future integration

The current [subscription route](../apps/web/src/routes.ts) is
`/settings/subscription`. Use the allowlisted absolute production return URL
`https://app.nibomo.com/settings/subscription` for hosted Checkout success/cancel
and the customer portal. Return-state query parameters and any session-reference
transport are **proposals to define during integration**, not existing handlers.
A return URL alone never proves payment or grants access: authenticate the current
account and resolve the subscription on the backend. Do not accept arbitrary
client-supplied return URLs, and handle logout/account changes before refreshing.

Use hosted Checkout in subscription mode. Stripe documents
`subscription_data.trial_period_days` for eligible trials and payment-method
collection by default in [Checkout trials](https://docs.stripe.com/payments/checkout/free-trials?payment-ui=stripe-hosted).
For this offer, select 7 days and require collection; do not use the no-payment-
method trial option. Confirm any explicit `payment_method_collection`,
`adaptive_pricing`, `branding_settings` and automatic-tax parameters against the
[Checkout create reference](https://docs.stripe.com/api/checkout/sessions/create)
for the pinned API version before implementing them. No API version is established
by this document, including any default attached to a historical Stripe account.

[Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=stripe-hosted)
requires compatible account/settlement currency and Checkout configuration.
Item 05 must verify USD settlement eligibility and the selected setting in each
environment; integration must verify the trial, first payment and later renewal
in the customer’s presented currency. Do not silently substitute manual regional
prices if this fails: record the specific unmet requirement.

The backend offer, checkout, subscription-detail, portal and webhook routes remain
proposed. Choose exact paths with the implementation and update API Gateway in the
same change. The webhook receiver URL, event list, pinned event API version and
runtime secret names remain pending; no endpoint is registered or activated by
this preparation. Plan lifecycle coverage for checkout completion, subscription
creation/update/end, invoices paid/failed, refunds and disputes, then select the
exact [subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks)
that the implemented handler can process. Verify signatures, idempotent delivery,
account ownership, reconciliation and cross-environment separation before launch.

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

## Preparation and launch procedure

1. Review this configuration and all 51 English strings. Translate every expected
   locale in items 02–04 and review placeholders, billing meaning and terminology.
   Keep authoring files outside the application catalogs until implementation.
2. In item 05, verify the existing Stripe account, isolated sandbox and private
   operator access. Use the main checkout’s ignored `.env`: `STRIPE_ADMIN_API_KEY`
   with `STRIPE_ACCOUNT_ID` for the target live account, and
   `STRIPE_SANDBOX_ADMIN_API_KEY` with `STRIPE_SANDBOX_ACCOUNT_ID` for the isolated
   sandbox. Resolve the main checkout when operating from a worktree. Agent-tagged
   keys can carry Stripe approval restrictions; do not place keys in this document.
3. Create/read back the product, inclusive monthly price and dedicated portal
   configuration in sandbox and live from these reviewed inputs. Record their IDs
   and settings in the inventory. Enable period-end cancellation, billing details,
   payment-method updates and invoices, with plan and quantity changes disabled.
   Do not create customer subscriptions or public Payment Links during preparation.
4. Record the item 05 settings audit below, distinguishing selected values from
   observed account-wide settings. Do not accept agreements, invent registrations,
   or overwrite another product’s settings to complete it.
5. Merge reviewed preparation inputs and verified readback before implementation.
   Cloud PR static checks and triggered post-merge workflows own project validation.
6. Implement the provider, stable customer mapping, trial eligibility, lifecycle
   persistence and reconciliation over the shared entitlement system. Add API
   routes and secret access with API Gateway changes; select and pin the verified
   API version. Deploy through CI/CD before registering webhook endpoints.
7. Register sandbox/live endpoints only after signature verification and event
   processing exist. Store signing secrets privately and record non-secret IDs and
   API versions. Check signed delivery and duplicate processing in real sandbox
   flows, then implement offer, return, status, management and deletion behavior.
8. Move reviewed locale copy into the web catalogs and replace the shared Premium
   placeholder in Subscription settings, AI allowance, accent-color and Tests
   entry points. Preserve guest email linking, own-key access, cached local
   features and immediate feedback. Confirm a return resumes the original action
   only for the same account and backend-confirmed access.
9. Before live purchases, complete real sandbox/manual acceptance: eligible trial;
   repeat-customer ineligibility; prior mobile trial eligibility; payment-method
   collection; inclusive tax and converted-currency first payment/renewal;
   interrupted and delayed checkout; failed payment/recovery; period-end
   cancellation; duplicate and out-of-order webhooks; logout/account switch;
   lifetime plus a separate subscription; and account deletion with provider
   failure or a racing checkout. Capture the implemented screens after they exist.
10. Coordinate legal-page updates and live purchase activation with payment
    readiness. Activate the shared free-account limit only in its separate
    coordinated rollout. Monitor provider events and deployment; resource
    preparation alone is not authorization to enable the paywall or that limit.

### Item 05 settings audit still required

| Area | Evidence to record before closing preparation |
| --- | --- |
| Branding | Uploaded file IDs, supported Nibomo session overrides, shared portal branding scope; leave unrelated branding intact |
| Adaptive Pricing | Observed sandbox/live enablement and USD settlement compatibility; subscription lifecycle verification remains integration work |
| Tax | Explicit inclusive price readback, product-specific tax code, actual tax head-office and registrations, enabled calculation settings; no claim of registrations elsewhere |
| Receipts and emails | Current receipt/payment email settings and their account-wide scope; record any Nibomo-specific option without changing other products’ messages |
| Trial reminders | Selected/observed reminder settings and scope; Stripe does not send trial-reminder emails in a sandbox, so do not claim sandbox email delivery |
| Failed payments | Observed retry schedule, dunning emails and terminal state, consistent with the shared Stripe entitlement mapping |
| Legal pages | Billing terms, Stripe data handling and deletion wording reviewed against the actual public pages; website edits tracked separately |

The inspected [Terms](https://nibomo.com/terms/) and
[Privacy Policy](https://nibomo.com/privacy/) identify the operator and general
data/deletion rules but do not yet describe Stripe recurring billing, the trial,
inclusive tax presentation, Stripe processing or Stripe renewal cancellation on
account deletion. Their canonical sources are the neighboring website repository’s
[`terms/index.md`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/terms/index.md)
and [`privacy/index.md`](https://github.com/kirill-markin/flashcards-open-source-app-website/blob/main/src/content/en/pages/privacy/index.md).
Record this gap for that repository’s launch work; these authoring inputs do not
publish or replace the legal pages. Do not invent a refund or tax-registration
policy from their current silence.

## Stripe references

- [Products](https://docs.stripe.com/api/products/create),
  [prices](https://docs.stripe.com/api/prices/create), and
  [inclusive tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior).
- [Portal configuration](https://docs.stripe.com/customer-management/configure-portal)
  and [configuration API](https://docs.stripe.com/api/customer_portal/configurations/create).
- [Checkout appearance](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=stripe-hosted),
  [trial reminders](https://docs.stripe.com/payments/checkout/free-trials?payment-ui=stripe-hosted),
  and [API changelog](https://docs.stripe.com/changelog).
