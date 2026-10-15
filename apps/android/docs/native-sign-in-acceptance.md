# Native sign-in acceptance

These checks require an authorized real account and a correctly registered, signed Android app.
Source review and Android CI do not establish provider acceptance. No device checks below have
been performed for this change. Keep account identifiers, email, codes, tokens, return handles,
URLs and nonce values out of analytics and shared artifacts.

Use the full sequence on Android 17 / API 37. Repeat the essential chooser, Google, Apple return
and email recovery checks on API 30, 31 and 33; the same implementation also supports API 32.
Use the existing release procedure for any later device run or Play draft; this checklist does
not authorize dispatch or publication.

1. Open sign-in from Settings, review prompt, catalog import and the credential-recovery gate.
   Confirm one sign-in/create-account entry, Google first and primary, envelope Email second,
   and Apple third only when server browser metadata and an installed browser make it usable.
   Test large text, TalkBack, RTL, keyboard focus and a small phone with its keyboard visible.
2. On a registered Play/debug/CI-upload signing identity, invoke Google Credential Manager.
   Have the operator verify the actual Google-signed server audience, raw nonce and registered
   Android `azp` through the existing secure acceptance procedure. Registration alone does not
   prove `azp`; an ephemeral CI debug certificate is not registered. If the strict server verifier
   rejects the actual signed presenter claim, stop activation and revisit the security contract.
   Never manufacture a JWT, relax verification or substitute browser Google sign-in.
3. Cancel the actual Google system sheet. Confirm immediate feedback, another-method access and
   retention of the last good hint. Repeat without usable Google services: a clear retry/Email
   path must remain. A launch failure must not report credential receipt.
4. Launch Apple through Custom Tabs/system browser, complete its genuine exact callback
   `com.nibomo.app:/auth/social/apple`, and verify warm and killed-process return. Cancel in the
   browser and explicitly start again. A denied/unproved return must not claim successful proof.
   Deliver a foreign candidate followed by the genuine callback before server proof: the genuine
   callback must remain replaceable until PKCE verification. Confirm one-use server redemption.
5. Exercise callback storage failure. Expect a localized Retry/Close dialog, no opaque handle or
   raw error displayed, retry using the retained private callback, and a working fresh attempt
   after Close. Close and reopen the app while an Apple attempt is pending.
6. Where the server requires secondary mailbox proof, send once, enter a real 6–8 digit code,
   and complete the same initiating provider journey. Another code requires an explicit fresh
   provider attempt; no replay/resend control is advertised. Test expiration, wrong code,
   lost send response, killed process during send/verification, failed completion-record write
   after successful verification, and redemption failure after code use. Restart must offer a fresh
   attempt with consumed Send/Verify controls disabled; an unlaunched attempt still offers Send.
   Close at mailbox or Apple waiting, reopen Sign in from recovery, and expect the clean chooser.
   Do not claim verification failed after a successful verification followed by redemption failure.
7. Sign out normally, choose Email, request a fresh 8-digit code and verify the same stable user
   and workspace as a previously proved open-email Google/Apple account. Hidden Apple returns
   through Apple; never infer or request its underlying personal email. Retain working relay
   recovery without making hidden-relay OTP a prerequisite. Confirm the review demo still works.
8. Cover empty guest, bound guest, merge-required guest, workspace choice, credential restoration,
   guest-local recovery, failed initial sync and restart during workspace completion. Existing
   cards/reviews/workspaces must survive; retry must retain the chosen workspace and use the
   established protected credential recovery. An account-ready fact requires completion, not
   merely credentials or a workspace-selection screen.
9. Opt in to remembering and finish each method. Expect only a small top-right Last used badge
   on the existing successful method button, with fixed method order. Hover/focus shows only the
   actually known successful email; badge touch opens compact masked/reveal/copy/forget controls.
   Ordinary button taps still sign in. Unknown provider email has no invented email detail.
   Cancel or fail at verification, workspace selection and initial sync: preserve the prior hint.
   Restart after Email credentials are installed but before initial sync finishes: the encrypted
   deferred hint retains only the actual verified identity, bound to that session and server.
   Kill during a guest upgrade after credentials install and before hydration succeeds. On restart,
   finish real recovery and check the badge only after successful hydration. Repeat with remembering
   off (clear the prior badge only after success), and Forget before completion (never revive it).
   A different server or refresh session must not consume the deferred record.
10. Opt out and finish successfully: the previous hint clears only after completion. Ordinary
    sign-out retains an opted-in hint; Forget, Sign out and forget, account deletion and local
    erase clear it. Explicit Forget during pending completion must not be undone on resume.
11. With collection enabled, inspect the existing factual event stream for actual method selection,
    SDK/browser launch, verified provider result, code request/submission/result, accepted stored
    session, guest upgrade and account ready. Ordinary workspace completion must not emit an
    account-identity link fact. Restart at an accepted-session/workspace screen: no new credential,
    session-accepted or sign-in-success facts should appear from restoration. Apple credential
    receipt is observed only at a successful PKCE-validated server mailbox-send/redemption response;
    the Android callback contains no credential and cannot prove receipt by itself. A failed
    exchange must not invent receipt. Verify timeout, offline and HTTP 5xx outcomes on actual code
    requests; later preparation/redemption failures must not become code-verification failures.
    Fail guest preparation or the pre-upgrade outbox drain: no guest-completion result is emitted.
    Fail the actual guest-completion request: report its observed outcome. Return a successful server
    result, then fail checkpoint or hydration: report completed only. Recover the saved result:
    no duplicate completion appears without a new request. Later sync or hint failures must not
    report a failed upgrade. Request Email, return to the chooser, then close:
    expect one explicit Email cancellation, including at recovery; rotation must add none.
    Secondary OTP keeps its initiating provider. Turn collection off, withdraw it mid-flow and test missing consent/auth-first entry:
    the shared analytics consent boundary must discard prohibited events, with no PII or journey IDs.
12. In a later authorized Play draft, translate the new base English keys through Play App strings.
    Verify the explicit supported-language list, per-app language settings and actual delivered
    translated UI. Repository `values-xx` overlays are not part of this workflow.

Actual signed Android `azp`, native Google/Apple success, cancellation, guest/recovery, hint and
consent acceptance, and Play-delivered translations remain unproved until these checks run.
The accepted existing rare interruption/final-storage gap after successful recovery may require
a fresh attempt to finalize a hint; it does not establish an unusable account or data loss.
