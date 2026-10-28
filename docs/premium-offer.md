# Premium Offer

The product decisions behind the paid offer: what premium sells, what counts against a limit, the
price, the plan name, and who gets what for free. Each one is closed by the repository owner. Do not
reopen, reinterpret, or extend them in code or copy; a change here is a product decision first.

This document names decisions and links to where they ship:

- the platform contract — tiers, ranks, access status, derivation, what a client may trust — is
  [docs/premium-entitlements.md](premium-entitlements.md);
- limit numbers are [apps/backend/src/billing/limits.ts](../apps/backend/src/billing/limits.ts);
  where the code and this document disagree, the code has not caught up and this document is the
  target;
- store product identifiers and store texts are
  [docs/subscription-store-metadata.md](subscription-store-metadata.md).

What is still open is listed in
[Decided later, on purpose](premium-entitlements.md#decided-later-on-purpose).

## Premium sells AI

Server-enforced limits are the paid AI axis. Custom styles are the local premium cosmetic specified
below.

The standard shared offer stays compact; allowance-reset details live in Subscription settings,
and the own-key explanation and action appear in the offer only for an AI-limit request (see
[Own OpenAI key](#own-openai-key)).

## The AI limit counts messages

One message is one chat turn that reached the model on the platform key. Only in-app chat turns
count.

- Registered and native dictation is not limited; browser guests use the [browser trial](#browser-guest-ai-trial).
- Card image generation keeps its own ceilings.
- Composer suggestions never count.
- A turn made with the person's own OpenAI key never counts.

## Limits

All limits are per person per month, in the [UTC monthly window](premium-entitlements.md#the-monthly-ai-window-is-utc).

| Who | Messages per month |
| --- | --- |
| Free account | 50 |
| Free guest | 15 |
| Premium or lifetime, account or guest | 1000, as an anti-abuse refusal |

Weighted tokens are not refused. A person's monthly total of 5,000,000 weighted tokens on the
platform key raises a Sentry warning.

## Browser guest AI trial

Authenticated browser-product cookie guests can use Nibomo-funded chat, dictation and card images
under independent lifetime and shared UTC-day budgets. The authoritative limits live in
[`ai.browser_guest_trial_policy`](../db/migrations/0221_browser_guest_ai_trial.sql); `/me/ai-usage`
publishes their current availability separately from monthly usage. Only a new logical chat turn
spends a message; dictation spends validated audio seconds rounded up. Paid failures and unknown
provider outcomes retain spend. Image and dictation trials use one provider attempt per operation.
Normal refusals invite sign-in inside the conversation without discarding drafts or disabling the
other features. Analytics consent does not control access. Native, registered and own-key behavior
is unchanged; legacy web tokens remain analytics-only. See
[browser guest credentials](auth-service.md#browser-guest-credentials).

## Own OpenAI key

- Any person, guest included, may enter their own key on each client.
- The key is sent with each request and never stored by the backend.
- It unlocks AI usage only — chat, dictation, and card images, for guests too — and never unlocks
  premium features.
- Card images made with it have one anti-abuse ceiling of 1000 per workspace per month.
- It is not offered on MCP or the Agent API.
- Usage made with it is still recorded, and excluded from limits.

## Price and products

One monthly subscription at a base price of USD 6.99, with a 7-day free trial. No annual plan and
no lifetime product is for sale for now. The price is the same on every provider. Regional prices
and their formatting come from the store, never from our code.

## Plan name

The customer-facing plan name is "Premium".

## Lifetime is a gift

Lifetime is a gift only. The one-time early-user gift is complete: it covered accounts with an
email and iOS or Android guests in the selected early cohort, excluding web guests. Opening
public sales does not grant another cohort lifetime access. A gift on a guest moves to the
account when the guest links an email. It is lost only if the guest identity is lost before that,
for example on a reinstall without linking, because a gift is not a store purchase and cannot be
restored.

## Sync stays free

Sync is free for everyone. It is a public selling point of the app, not a subscription benefit.

## Sandbox purchases grant entitlement

A purchase marked `sandbox` grants entitlement in production, so TestFlight and Play testing reach
the real backend. Reports separate test purchases from revenue by filtering on `environment`.

## Store rail order

Apple and Google purchases use the shared native Premium offers on iOS and Android. Android
shows an explicit unavailable state until Google Play returns an eligible catalog offer. The web
uses the shared Stripe offer; new live purchases remain gated by backend configuration. Web guests
see the full trial offer. Their Premium choice continues through sign-in and guest conversion directly
to Stripe with the verified account email. Account trial history selects a trial or paid Checkout,
with the charge shown before confirmation when the trial has been consumed. Existing Premium access skips
Checkout and resumes any pending feature choice.

## Plan order

Every shared Premium offer shows the Premium plan first and the Free plan second.

## Style settings

The Style section of Settings holds the custom styles: Accent color, Review Animations, AI Chat
Suggestions, and, on iOS and Android, App icon. Premium and lifetime (effective rank at least 20)
can change them. Free users see each setting's default and a premium note, and a change opens the
shared Premium offer on every client.

Each selection is stored independently of entitlement and distinct from what is displayed. A
confirmed downgrade displays the default while retaining the selection; resubscription restores it.
While a person cannot customize, choosing the default writes nothing, so the retained selection survives.
Unknown or offline entitlement follows the [cached local-feature policy](premium-entitlements.md#offline-behaviour).
Client setting and display boundaries gate usage; the backend adds no billing gate for storing a
selection. Accent color and Review Animations are account-wide; AI Chat Suggestions and App icon are
stored per device. The launcher icon follows the displayed App icon on
[iOS](../apps/ios/Flashcards/Flashcards/Store/FlashcardsStore+AppIcon.swift) and
[Android](../apps/android/app/src/main/java/com/flashcardsopensourceapp/app/appicon/LauncherAppIcon.kt).

### Accent color

Accent color offers Default `#FF6719`, Blue `#4D8DFF`, Purple `#A78BFA`, Pink `#F472B6`, Teal
`#2DD4BF`, Gold `#EAB308`, or an arbitrary opaque RGB color with explicit HEX entry. The exact chosen
RGB is used without contrast correction; alpha is unsupported. Default remains available to everyone.
Card themes are outside this feature.

The wire contract is [account preference parsing](../apps/backend/src/routes/system/support.ts) and
[persistence](../apps/backend/src/routes/system/account/accountPreferences.ts);
[guest merge](../apps/backend/src/guestAuth/store/identity.ts) states which color an upgraded guest keeps.

## Review paywall schedule

On web, iOS, and Android, automatic review offers apply only to a known free entitlement, for
existing and new users alike. Unknown entitlement, premium, an active trial, and lifetime never
qualify. Thresholds, cooldowns, and order live in
[reviewPromptConfig.ts](../apps/backend/src/reviewPrompts/reviewPromptConfig.ts).

Display history is functional account state and syncs even when product analytics is off; guest
upgrades and connected accounts retain it.

Only a saved app review can trigger an automatic offer, and at most one presentation follows each
review; no timer or catch-up presentation opens an offer.

MCP may later offer a card-shaped soft paywall with an explicit choice to continue free. This is
deferred; it adds no tool or schema contract now.
