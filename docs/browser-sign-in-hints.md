# Browser sign-in hints

The auth-origin [storage core](../apps/auth/src/templates/browserHints.ts) and
[bridge document](../apps/auth/src/routes/browser/browserHints.ts) provide presentation metadata.
The [web client](../apps/web/src/api/browserHints.ts) exposes only accepted-method consumption and
explicit forgetting. Call consumption after the actual account and workspace are ready. Keep
forgetting in the privacy lifecycle even when the session is absent.

The [auth controls](../apps/auth/src/templates/browserHintControls.ts) expose explicit remembering,
small last-used method badges and auth-local email reveal/copy. The web
[account privacy controls](../apps/web/src/screens/settings/account/BrowserSignInPrivacy.tsx) and
[deletion cleanup](../apps/web/src/appData/session/browserSessionRecovery.ts) use the existing bridge.
Ordinary logout, account switch and reauthentication cleanup retain the opted-in hint. Deletion and
explicit Forget clear it; there is no separate user-facing local-erase feature. Optional hint errors
keep the accepted session and offer continuation; a failed clear never confirms that data is gone.

[UI facts](../apps/auth/src/routes/browser/authFact.ts) use the existing auth producer and live shared
consent cookies. [Email request/verification facts](../apps/auth/src/routes/browser/emailAuthFacts.ts)
and provider callbacks observe their own results. Web session-accepted and account-ready are distinct
facts after fresh method consumption, a revalidated same-user cookie, actual workspace readiness
and preference reconciliation. Cookie issuance alone reports neither fact. OAuth-only consent
continuations have no method bound to their persisted cookie at that boundary, so omit these facts.
Legacy sessions have no method inference. Web guests own no product data and run no guest upgrade;
the legacy analytics identity link remains its existing background operation, rather than a
fabricated upgrade fact.

No bridge response contains email or session identity. Origins must be the matching same-site pair;
cross-family framing does not share storage or cookies. Native sessionStorage opener cloning can
copy pending presentation context: consumption is per tab, with no global deduplication guarantee.

## Manual browser acceptance

Run these procedures through the real deployed UI. Source and cloud
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
   remember preference is written. With the remembering checkbox, verify only the successful email or
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
8. On both login and OAuth authorization entry, including Safari, verify Google → Apple → Email
   with the envelope icon. Opt in, complete each actual method, sign out normally, and verify a
   small localized Last used badge at the top right of only the successful method. Failed/cancelled
   attempts preserve it. Hover and keyboard-focus that button; use the badge on touch. Reveal/copy
   only the known successful email, never a different recovery/profile address or Apple's personal
   address. A normal method-button tap must still authenticate. Switch UI locales, including RTL.
9. In Settings → Account Status, use Forget, then Sign out and forget. Block the auth frame/site
   storage and retry each: display an actionable error with no forgotten confirmation or sign-out.
   Restore access and retry. Delete an authorized disposable account through the existing flow and
   inspect that its hint is cleared, including deletion recovery. A confirmed account switch or
   ordinary cache/reauth cleanup must retain the opted-in hint.
10. Inspect actual facts with collection off, absent shared consent/visitor cookies, and withdrawal
    during provider authorization. No disabled-collection fact should be sent or retained. With
    collection enabled, observe method selection, code form/submission, explicit email resend,
    request/verification outcomes, provider callback, session acceptance and web account readiness.
    Account-ready must follow real workspace readiness, occur once per consumed tab context, and
    omit old/missing method context. No email/hash, subject, token, nonce, query/fragment or journey
    identifier may appear. Do not infer delivery or abandonment from these events.
11. Exercise secondary provider mailbox proof. A successful continuation retains Google/Apple as
    the initiating method; another code starts a fresh provider request. Interrupt send/verify
    transport after submission: the UI must require a fresh attempt, and later redemption failure
    must not claim an invalid code. Repeat an actual Google → email login into the same stable user
    and workspace, plus hidden-Apple returning login. These require real provider/mailbox evidence;
    synthetic demo accounts and database fixtures cannot establish them.
