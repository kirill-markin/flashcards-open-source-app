# Stripe subscription media

The [Stripe preparation runbook](../../stripe-subscriptions.md) owns the procedure;
[configuration.json](../../stripe-subscriptions/configuration.json) is the canonical
inventory of uploaded file IDs, public file links, dimensions and integrity hashes.

| Asset | Source or evidence | Role |
| --- | --- | --- |
| Vector icon | [icon.svg](../../../apps/web/public/icon.svg) | Existing editable source |
| 512 × 512 PNG icon | [icon-preview.png](../../../apps/web/public/icon-preview.png) | Original uploaded with `purpose=business_icon` in sandbox and live; no duplicate export |
| Live product screenshot | [stripe-live-product.png](stripe-live-product.png) | Readback of the Nibomo product, icon, monthly USD price, tax category and rendered marketing features on 2026-10-03 |

Both uploaded PNGs were retrieved and their decoded pixels matched the repository
source exactly at 512 × 512. Stripe's optimized PNG has a different byte hash;
that is not a pixel mismatch. The accepted file IDs and public URLs belong to their
respective environments. Product image readback does not prove future Checkout
Session or portal branding.

The screenshot contains only the Nibomo catalog view, without credentials or
customer records. It is preparation evidence, not an implemented checkout or
subscription screen. Capture runtime offer, Checkout and portal evidence only
after the corresponding integration exists.
