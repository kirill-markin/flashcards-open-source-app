# Native sign-in acceptance

These checks require an authorized real account and a correctly registered, signed Android app.
Source review and Android CI do not establish provider acceptance. Record the exact SHA,
package/signing identity, build, OS, device, locale, UTC window and actual results. Keep account
identifiers, email, codes, tokens, return handles, URLs and nonce values out of analytics and shared artifacts.

Use the full sequence and existing full native smoke selection on Android 17 / API 37.
Repeat the essential chooser, Google, Apple return and email recovery checks on API 30, 31 and 33;
the same implementation also supports API 32.
Use the existing release procedure for any later device run or Play draft; this checklist does
not authorize dispatch or publication.
For instrumentation, declare `isAutomation=true` and verify
`automation_environment_resolved isAutomation=true` before interacting, using the existing
[Android automation detector](../app/src/main/java/com/flashcardsopensourceapp/app/automation/AutomationEnvironment.kt).
Automation suppresses client product facts and cannot establish their positive delivery; use a
separately authorized real collection-enabled session for those observations.

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
   after Close. Include an encrypted ownership-read IOException wrapped in IllegalStateException:
   the same dialog must appear without navigating or resetting the current recovery step. Retry
   must re-read protected ownership, including after it changes; unknown ownership never selects login.
   Also fail saving the callback before and after its candidate record commits, then Retry the
   same saved unproved completed candidate. Close and reopen the app while an Apple attempt is pending.
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
   recovery without making hidden-relay OTP a prerequisite. Fresh authoritative Gmail/verified
   Workspace `hd` and verified Apple shared email must avoid redundant OTP; historical
   `email_verified` or external Google email alone is not current mailbox authority. Never merge
   different existing accounts or demo/real accounts. Personal-email add/change is deferred.
   Confirm the review demo still works.
8. Cover empty guest, bound guest, merge-required guest, workspace choice, credential restoration,
   guest-local recovery, failed initial sync and restart during workspace completion. Existing
   cards/reviews/workspaces must survive; retry must retain the chosen workspace and use the
   established protected credential recovery. Deliver duplicate/stale Apple callbacks while an
   accepted session is waiting at workspace choice or POST_AUTH: preserve that screen and pending
   recovery. Repeat after actual mailbox completion has been stored. An account-ready fact requires
   completion, not merely credentials or a workspace-selection screen.
   Refresh/relaunch, use cards/reviews/workspaces offline and sync after reconnecting; existing
   purchases must remain attached to the intended account.
9. Opt in to remembering and finish each method. Expect a small Last used badge floating
   above/across the existing successful button's upper-right edge, without increasing button
   height, shifting logo/label, reordering or duplicating methods. In the actual scrolling Column,
   inspect and tap its upper half; the previous row's lower-right area must not intercept it or
   activate the wrong method. Deliberate hover, keyboard navigation and badge tap/keyboard activation
   show only compact masked known-email text, with no Show, Copy, Forget or other hint controls.
   Initial/programmatic focus and focus restored after provider cancellation must not open it.
   Check Back/Escape, outside dismissal and restored keyboard focus. Badge activation must not
   authenticate; ordinary method taps must. Unknown email stays absent. Keep optional Remember
   and explicit Forget outside the hint. Inspect narrow widths, large text, TalkBack and RTL.
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
    Fail the protected clear: require an actionable error and no forgotten confirmation.
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

## Internal account-method boundary

The [Settings consumer](../feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/account/methods/AccountMethodsRoute.kt)
uses `AppGraph.cloudAccountMethodsRepository`; these steps exercise the real module
and deployed API, without demo identities or manufactured provider credentials.

1. In a linked real account, call `loadMethods()`. Check actual active/disabled methods,
   `revocationPending`, and read-only `verifiedRecoveryEmails`. Retain the exact target generation
   string, including PostgreSQL spaces, timezone and microseconds. An empty email list does not
   mean Email is disabled. No metadata or proof result may replace credentials, provision a
   workspace, change a sign-in hint or report account ready.
2. Call `beginReauthentication` with Google, Email or usable browser Apple, in Android order.
   For Google, call `prepareProviderLaunch(localId)` immediately before the existing official
   Credential Manager helper with that launch’s server audience and raw nonce. Observe its
   actual `onRequested` callback; do not count preparing an attempt as an SDK launch. Submit only
   the real returned token to that local ID. Email’s `onEmailCodeRequestStarted` observes gateway
   invocation after protected state/session preparation; `onEmailCodeRequested` observes a successful
   server send before local persistence.
   Email uses server-selected current-account OTP;
   no caller email selects the principal. Apple opens the returned authenticated `browserStart`
   URL through usable Custom Tabs. It must contain only client and opaque attempt parameters.
   On both supported auth hosts, confirm genuine Apple reauth/link/re-enable begin responses
   accept the selected HTTPS origin’s `/api/social/apple/callback` as the provider redirect.
3. Return Apple through the exact hostless app URI. Protected management purpose is read before
   decoding/dispatch, and `ManagementAccepted` is isolated from ordinary sign-in navigation.
   Completed reauth is a PKCE candidate receipt; it is not itself credential-receipt evidence.
   For `verification_required`, send once, then verify the actual mailbox code. Restore waiting
   state after process death and exercise callback storage Retry with the private retained URI.
4. After `PROOF_READY`, invoke `beginLink` or `beginReenable` and use its **new local ID**, new
   nonce/PKCE and actual provider return. The original receipt/verifier remains separate.
   Complete a normal link with `completeLink`; unlink uses the exact freshly listed target.
   Check conflict, changed generation and last-usable-method refusals with the real server.
5. Explicit Apple re-enable accepts only the matching `provider_proved` attempt and calls
   `resumeAppleReenable` on that same bound attempt. Google never resumes: after actual cleanup
   metadata becomes ready, start completely new reauthentication and new provider proof.
   Lost/failed one-use requests restore `SUBMITTING` (expired proof becomes `RESTART_REQUIRED`),
   disable replay, refresh `loadMethods()` and
   show actual active results or require entirely fresh proof. Do not infer a nonexistent public
   revocation-pending error code or poll by resubmitting receipts.
6. Kill during begin, provider submission, mailbox send/verify, link redemption, unlink and
   re-enable; interrupt after server success before disk completion too. Confirm no replay after
   restart, no duplicate confirmed-mutation callback from restoration, and no hint/session writes.
   Cancel or Forget during a suspended call; change account, server, workspace or installation;
   sign out normally and sign out/forget. Deliver the late Apple return after each action: it
   cannot restore the cancelled proof, dispatch to login, reopen sign-in or change recovery steps.
   Repeat with no pending purpose and with a storage retry whose protected purpose changed.
   Finally repeat ordinary Google/Apple/Email, guest recovery, hints and login callback storage
   Retry. Signed-device acceptance and Play translation/publication remain unproved.

## Settings sign-in methods

Source and CI checks do not establish the following device acceptance. Use a signed app and an
operator-authorized real account; the demo must show its explicit management refusal.

1. Open Settings → Account status → Sign-in methods. Check active/disabled providers, pending
   cleanup, the unchanged opaque generation string, and the actual read-only recovery email list.
   An empty list must not advertise disabled Email or infer a hidden Apple personal address.
   Open the supported review demo: expect its explicit management refusal, working Back, and no
   refresh/proof/restart loop. A real-account restart or provider denial must never be labeled Demo.
2. Verify the current account using an active native Google method, server-selected Email OTP,
   or usable browser Apple. Check fixed Google → envelope Email → Apple ordering, official
   branding, immediate loading, large text, TalkBack and a small keyboard-visible phone.
   Google uses Credential Manager with the server audience and raw nonce; verify actual signed
   Android azp through the existing secure procedure. Stop on a real presenter rejection.
3. After current-account proof, link a new provider, unlink an exact listed method after its
   confirmation dialog, or explicitly re-enable a disabled provider. Confirm the intended new
   provider account and fresh proof; check conflict, changed-generation, expiry and sole hidden
   Apple last-usable refusals. Metadata refresh must show the actual server result. During
   revocation cleanup, refresh without submitting proof. After cleanup use entirely fresh current
   and new Google proof. Only Apple’s matching APPLE_PROVED browser attempt offers Resume.
   Repeat same-provider linking and require the explicit already-linked outcome with unchanged
   generation. For authorized lifecycle changes, check actual Apple revocation/cleanup and refusal
   of old principal JWT/refresh credentials, then fresh usable sign-in after cleanup completes.
   Cloud checks and scheduled cleanup alone do not prove real provider revocation.
4. Exercise genuine mailbox send/verify, wrong code, timeout, cancellation, denied Apple return,
   duplicate/foreign return, and killed-process restoration at every protected phase. A failed or
   ambiguous one-use request disables replay, refreshes metadata and offers Start again. If the
   server already completed it, show its actual active status; never infer failure from lost local
   persistence. Apple callback storage failure exposes Retry/Close with retained private callback.
5. Leave via toolbar/system Back, change account/server/workspace, sign out, delete or erase, then
   deliver a late callback. Cancelled proof must stay cancelled, ordinary login must not reopen,
   and neither session/workspace nor Last used hints may change. Repeat ordinary sign-in afterward.
6. Inspect actual existing consent-gated facts: provider request at SDK/browser launch, Google
   credential return, Apple credential only after a PKCE-validated response, code request/verify
   callbacks before later persistence, and LINK success only after server mutation. Unlink and
   re-enable do not invent events absent from the finite inventory. Restoring pending state emits
   no new provider receipt, session accepted, account ready or guest-upgrade facts. Withdraw consent
   mid-flow and repeat with collection off. Keep emails, generations, handles and raw errors out
   of analytics. Verify new English keys in a later authorized Play-translated draft.
   With current-account Email proof, fail the actual request with timeout, offline, rate limit and
   server errors: expect the corresponding code-request outcome. Fail protected load/save or session
   preparation before invocation: expect no send outcome. Accept the send, then fail encrypted
   persistence: retain only Accepted, without a failure fact.
   Complete Apple current-account proof, then link Google or explicitly re-enable a provider:
   observe Apple Credential received at the first successful server proof-validation response,
   even if later encrypted persistence or new-provider launch fails. Repeat after mailbox proof
   and killed-process restoration: a previously observed mailbox receipt must not be duplicated.
