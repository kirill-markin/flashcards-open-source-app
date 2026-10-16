# Browser sign-in hints

The auth-origin [storage core](../apps/auth/src/templates/browserHints.ts) and
[bridge document](../apps/auth/src/routes/browser/browserHints.ts) provide presentation metadata.
The [web client](../apps/web/src/api/browserHints.ts) exposes only accepted-method consumption and
deletion cleanup. Call consumption after the actual account and workspace are ready. Keep
deletion cleanup available even when the session is absent.

The [auth controls](../apps/auth/src/templates/browserHintControls.ts) expose small last-used method
badges and compact masked-email hints. Successful sign-in saves its hint automatically, regardless
of a previous remember preference. Ordinary logout ends the session while retaining the hint;
account switch and reauthentication cleanup also retain it. The existing
[deletion cleanup](../apps/web/src/appData/session/browserSessionRecovery.ts) clears it through the
bridge. Optional hint errors keep the accepted session and offer continuation; a failed deletion
clear never confirms that data is gone.

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

Run these procedures through the real deployed UI after the applicable AWS/Web release succeeds.
Record the deployed SHA, browser/OS, locale, UTC window and actual outcome. Source and cloud
checks do not prove browser storage partitioning, provider proof, mailbox delivery or these flows.
Use genuine browser cookies and natural Origin/CSRF traffic; fabricated headers, credentials or
database fixtures cannot establish positive acceptance. Keep private evidence outside this document.

1. On `app.nibomo.com`, sign in through Google, Apple and email in the same tab. Observe the auth
   response's successful hint and accepted-session metadata without copying their values into
   logs. After real account/workspace acceptance, consumption must return the initiating method
   once, then absence. Secondary mailbox OTP must retain the initiating provider. Repeat on
   `app.flashcards-open-source-app.com` with its matching auth host.
2. Refresh the session before consumption: original authentication time must still match. Sign in
   as a different principal before consumption: the obsolete context must yield absence. A legacy
   response without accepted-session metadata must also yield absence, with no profile or saved
   hint inference. Failed or cancelled attempts must leave an earlier successful hint unchanged.
3. Complete each successful sign-in and inspect auth-origin local storage: the successful method
   and email hint are saved automatically, including with an old disabled remember preference.
   No new remember preference is written. Provider email and recovery email remain distinct, and a
   missing provider email stays missing. Ordinary sign-out ends the session and retains the hint.
4. Delete an authorized disposable account and confirm its hint, legacy preference and same-tab
   context disappear. With a second auth tab holding an older attempt, finish it after deletion
   cleanup: no old hint or accepted context may reappear. Repeat with deletion cleanup and success
   both pending on the native storage lock. A fresh sign-in must record its own hint normally.
5. Inspect the bridge's CSP: only its exact paired configured app origin may frame it. Marketing,
   admin, a foreign site and the other domain family must be denied. All other auth document
   framing policies remain unchanged. Configured localhost acceptance uses ports 3000 and 8081.
6. From an allowed parent, send wrong-version, wrong-operation, extra-field and malformed messages,
   and send a valid-shaped message from a sibling frame: none may consume or forget anything.
   On the app receiver, wrong-origin or sibling-window messages must be ignored; malformed data
   from the actual auth frame must reject explicitly. Inspect traffic: exact destination origins,
   bounded method/status messages, no email, subject, credentials or analytics identifiers.
7. Block auth site storage, block its iframe, and interrupt connectivity separately. Optional hint
   storage must report its actionable error while sign-in still completes. Consumption and deletion
   cleanup must fail clearly, including the eight-second bridge timeout; no cookie or URL fallback
   occurs.
   Retry after restoring access. Test the browser's normal privacy/storage partitioning settings,
   especially Safari and Chrome, in both permanent host families.
8. On both login and OAuth authorization entry, including Safari, verify one localized
   sign-in/create-account screen with Google → Apple → Email
   with the envelope icon. Complete each actual method, sign out normally, and verify a
   small localized Last used badge floating above/across the upper-right edge of only the successful
   method. It must not increase button height, shift its label/logo, reorder or duplicate actions.
   Failed/cancelled attempts preserve it. Deliberately hover, navigate with Tab/Shift-Tab, and tap
   or keyboard-activate the badge: show only compact masked text for the known successful email,
   with no Show, Copy, Forget or other controls inside the hint. Unknown email stays absent.
   Initial/programmatic focus and focus restored after provider cancellation must not open it.
   Escape, outside click and leaving keyboard focus dismiss it; restoration must not reopen it.
   Badge activation must not authenticate; ordinary method-button taps must authenticate.
   No Remember or Forget controls appear on the entry screen. Check narrow widths, large text,
   screen-reader labels and UI locales including RTL.
9. In Settings → Account Status, verify only ordinary Sign out is offered. It must end the session
   and retain the hint, including while the hint bridge is blocked. Delete an authorized disposable
   account through the existing flow and inspect that its hint is cleared, including deletion
   recovery. Block the auth frame/site storage during deletion cleanup: require its actionable
   error, then restore access and retry. A confirmed account switch or ordinary cache/reauth
   cleanup must retain the hint.
10. Inspect actual facts with collection off, absent shared consent/visitor cookies, and withdrawal
    during provider authorization. No disabled-collection fact should be sent or retained. With
    collection enabled, observe method selection, code form/submission, explicit email resend,
    request/verification outcomes, provider callback, session acceptance and web account readiness.
    Account-ready must follow real workspace readiness, occur once per consumed tab context, and
    omit old/missing method context. No email/hash, subject, token, nonce, query/fragment or journey
    identifier may appear. Requested code is not mailbox delivery; provider-internal screens and
    abandonment are not observed. The auth producer's 150 ms report budget is best effort, so
    distinguish missing delivery from a missing producer and derive funnels by querying facts.
11. Exercise secondary provider mailbox proof. A successful continuation retains Google/Apple as
    the initiating method; another code starts a fresh provider request. Interrupt send/verify
    transport after submission: the UI must require a fresh attempt, and later redemption failure
    must not claim an invalid code. Repeat an actual Google → email login into the same stable user
    and workspace, plus hidden-Apple returning login. For first enrollment with fresh authoritative
    Gmail/verified Workspace `hd` or verified Apple shared email, require no redundant OTP and later
    Email OTP into that same account/workspace. Historical `email_verified` alone or an external
    Google email is not current mailbox authority. Never merge different existing accounts or demo
    and real accounts. Hidden Apple returns through Apple; retain working relay recovery without
    requiring it. Personal-email add/change and standalone aliases are outside these procedures.
    These require real provider/mailbox evidence; synthetic demo accounts cannot establish them.

## Manual Settings acceptance

Use an operator-authorized non-demo account on each permanent app/auth host pair, including Safari.
Security-method mutations require separate authorization for the selected account and operation.

1. Open Settings → Account Status → Sign-in methods through the normal app. Require actual
   providers, cleanup state, exact opaque generation and read-only proved non-relay recovery emails.
   An empty list must not advertise disabled Email or infer a profile/provider address as authority.
   Verify the demo refusal. Applicable proof actions keep Google → Apple → envelope Email order.
2. Select an authorized link/unlink/re-enable and freshly prove the current account, then separately
   prove the intended new provider for link/re-enable. Hidden Apple must offer Apple reauthentication;
   current-email OTP is available only for the actual session mailbox in the proved recovery list.
   Check already-linked same-provider proof: show the explicit no-op outcome and unchanged generation.
3. Exercise actual current-email send failure (offline, timeout, rate limit and server error), wrong
   or expired verification, and genuine provider-required mailbox continuation. Inspect the existing
   request/verification facts at those boundaries. A successful verification followed by redemption
   failure must retain Verified. No pre-invocation or later local-storage failure is a send failure.
4. Unlink only the freshly listed target with its exact unnormalized generation. Verify conflict,
   changed-generation and last-usable-method refusals. After cleanup, web re-enable requires entirely
   fresh current-account and intended-provider proofs. Failed/ambiguous submission discards old
   receipts/codes, refreshes actual metadata and shows any already-completed result before restart.
5. Cancel, navigate away, switch account or sign out during proof and deliver the late return.
   Management must not become login, replace session/workspace, provision an account or update hints.
   For authorized unlink/deletion lifecycle checks, inspect actual cleanup/revocation and refusal of
   old principal JWT/refresh credentials; fresh login after completed cleanup must work. Scheduled
   cleanup or a green source gate alone does not prove real Apple revocation.
6. Repeat with collection off, cookie refusal, missing visitor/consent and live withdrawal during
   authorization. Only actual provider/code/link observations belong to the finite catalog; an
   already-linked outcome is distinct from a new link, and there is no unlink/re-enable event.
   Check localized loading/errors, keyboard access, large text, narrow layout and RTL.
