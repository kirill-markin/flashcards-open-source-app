# Stripe subscription media

The [Stripe preparation runbook](../../stripe-subscriptions.md) owns the procedure;
[configuration.json](../../stripe-subscriptions/configuration.json) is the canonical
inventory of uploaded file IDs, public file links, dimensions and integrity hashes.

| Asset | Source or evidence | Role |
| --- | --- | --- |
| Vector icon | [icon.svg](../../../apps/web/public/icon.svg) | Existing editable source |
| 512 × 512 PNG icon | [icon-preview.png](../../../apps/web/public/icon-preview.png) | Original uploaded with `purpose=business_icon` in sandbox and live; no duplicate export |
| Live product screenshot | [stripe-live-product.png](stripe-live-product.png) | Readback of the Nibomo product, icon, monthly USD price, tax category and rendered marketing features on 2026-10-03 |
| Sandbox web offer | [stripe-sandbox-offer.png](stripe-sandbox-offer.png) | Deployed English offer before purchase; seven-day trial, inclusive base price, payment-method requirement and backend-derived allowance |
| Empty hosted Checkout | [stripe-sandbox-checkout-empty.png](stripe-sandbox-checkout-empty.png) | Actual app-created Sandbox Checkout before entering billing fields; Nibomo branding, EUR conversion, inclusive tax and seven-day trial |
| Arabic web offer | [stripe-sandbox-offer-ar.png](stripe-sandbox-offer-ar.png) | Actual Arabic subscription page after the refund/cleanup flow; document language Arabic and direction RTL |
| Genuine refund replay | [stripe-sandbox-refund-replay.jpg](stripe-sandbox-refund-replay.jpg) | Actual Stripe Dashboard delivery; manually resent original Sandbox refund, pinned API version and HTTP 204, with request/customer fields outside the viewport |

The captures are unedited renders from 2026-10-03 and contain no email address, entered card data,
customer identifier or credential. Portal and receipt pages carried customer information and were
verified privately without screenshots. The Arabic capture does not prove a persisted server locale
or the hosted English fallback, and the product readback does not prove future Checkout or Portal
branding.
