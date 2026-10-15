# Browser sign-in hints

The auth-origin [storage core](../apps/auth/src/templates/browserHints.ts) and
[bridge document](../apps/auth/src/routes/browser/browserHints.ts) provide presentation metadata.
The [web client](../apps/web/src/api/browserHints.ts) exposes only accepted-method consumption and
explicit forgetting. Call consumption after the actual account and workspace are ready. Keep
forgetting in the privacy lifecycle even when the session is absent.

Persistent remembering is dormant until the auth UI supplies opt-in and the app installs all
forget, deletion and local-erase consumers. `enableRemembering()` opts into future successful
hints; `readHint()` returns only the server's successful hint. Ordinary sign-out retains that
opt-in. Explicit forgetting removes it. The auth UI can observe `nibomo-auth-hint-error` to present
optional storage failures without rejecting an accepted login. No bridge response contains email
or session identity. The two origins must be the matching same-site pair; cross-family framing
does not share storage or cookies.

## Manual browser acceptance

Run these procedures through the real UI after its consumers are mounted. Source and cloud
checks do not prove browser storage partitioning, provider proof, mailbox delivery or these flows.

1. On `app.nibomo.com`, sign in through Google, Apple and email in the same tab. Observe the auth
   response's successful hint and accepted-session metadata without copying their values into
   logs. After real account/workspace acceptance, consumption must return the initiating method
   once, then absence. Secondary mailbox OTP must retain the initiating provider. Repeat on
   `app.flashcards-open-source-app.com` with its matching auth host.
2. Refresh the session before consumption: original authentication time must still match. Sign in
   as a different principal before consumption: the obsolete context must yield absence. A legacy
   response without accepted-session metadata must also yield absence, with no profile or saved
   hint inference. Failed or cancelled attempts must leave an earlier successful hint unchanged.
3. Without opting in, complete sign-in and inspect auth-origin local storage: no personal hint or
   remember preference is written. With the future opt-in UI, verify only the successful email or
   provider hint is stored; provider email and recovery email remain distinct, and a missing
   provider email stays missing. Ordinary sign-out retains the opted-in hint.
4. Forget while signed out and confirm all hint, preference and same-tab context keys disappear.
   Start a sign-in in a second auth tab, forget in the first, then finish the older sign-in: no
   hint or accepted context may reappear. Repeat with forgetting and success both pending on the
   native storage lock. Start a fresh sign-in after forgetting and verify it records normally.
5. Inspect the bridge's CSP: only its exact paired configured app origin may frame it. Marketing,
   admin, a foreign site and the other domain family must be denied. All other auth document
   framing policies remain unchanged. Configured localhost acceptance uses ports 3000 and 8081.
6. From an allowed parent, send wrong-version, wrong-operation, extra-field and malformed messages,
   and send a valid-shaped message from a sibling frame: none may consume or forget anything.
   On the app receiver, wrong-origin or sibling-window messages must be ignored; malformed data
   from the actual auth frame must reject explicitly. Inspect traffic: exact destination origins,
   bounded method/status messages, no email, subject, credentials or analytics identifiers.
7. Block auth site storage, block its iframe, and interrupt connectivity separately. Optional hint
   storage must report its actionable error while sign-in still completes. Explicit consume/forget
   must fail clearly, including the eight-second bridge timeout; no cookie or URL fallback occurs.
   Retry after restoring access. Test the browser's normal privacy/storage partitioning settings,
   especially Safari and Chrome, in both permanent host families.
