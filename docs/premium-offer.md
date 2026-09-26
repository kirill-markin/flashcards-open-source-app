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

Server-enforced limits are the paid AI axis. Accent color is the local premium cosmetic specified below.

## The AI limit counts messages

One message is one chat turn that reached the model on the platform key. Only in-app chat turns
count.

- Dictation is not limited.
- Card image generation keeps its own ceilings.
- Composer suggestions never count.
- A turn made with the person's own OpenAI key never counts.

## Limits

All limits are per person per month, in the [UTC monthly window](premium-entitlements.md#the-monthly-ai-window-is-utc).

| Who | Messages per month |
| --- | --- |
| Free account | 50, switched on together with the paywall |
| Free guest | 15 |
| Premium or lifetime, account or guest | 1000, as an anti-abuse refusal |

Weighted tokens are not refused. A person's monthly total of 5,000,000 weighted tokens on the
platform key raises a Sentry warning.

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

Lifetime is a gift only. It is granted to every account with an email and every iOS or Android guest
that exists on the day the paywall launches. Web guests are excluded. A gift on a guest moves to the
account when the guest links an email. It is lost only if the guest identity is lost before that,
for example on a reinstall without linking, because a gift is not a store purchase and cannot be
restored.

## Sync stays free

Sync is free for everyone. It is a public selling point of the app, not a subscription benefit.

## Sandbox purchases grant entitlement

A purchase marked `sandbox` grants entitlement in production, so TestFlight and Play testing reach
the real backend. Reports separate test purchases from revenue by filtering on `environment`.

## Store rail order

Apple first, then Google, then Stripe on the web.

## Accent color

General settings opens an Accent color subscreen. Premium and lifetime (effective rank at least 20)
can choose Default `#C44B2D`, Blue `#4D8DFF`, Purple `#A78BFA`, Pink `#F472B6`, Teal `#2DD4BF`,
Gold `#EAB308`, or an arbitrary opaque RGB color with explicit HEX entry. The exact chosen RGB is
used without contrast correction; alpha is unsupported. Default remains available to everyone.
Free users see a premium note and the shared coming-soon paywall.

The selection is account-wide, stored independently of entitlement, and distinct from the displayed
color. A confirmed downgrade displays Default while retaining the selection; resubscription restores
it. Unknown or offline entitlement follows the [cached local-feature policy](premium-entitlements.md#offline-behaviour).
Client setting and theme boundaries gate usage; the backend adds no billing gate for storing it.

The wire contract lives in [account preference parsing](../apps/backend/src/routes/system/support.ts)
and [persistence](../apps/backend/src/routes/system/account/accountPreferences.ts): `accentColor` is
canonical uppercase `#RRGGBB`, and an omitted PATCH field preserves the stored selection. Guest
binding retains its row; [guest merge](../apps/backend/src/guestAuth/store/identity.ts) carries the
guest color only when the destination still has Default. Card themes are outside this feature.
