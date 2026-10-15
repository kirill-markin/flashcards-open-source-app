# Native Apple sign-in acceptance

Use a separately authorized signed build with the real configured services.
Record its SHA, bundle identity, build, OS, device and locale with each result.
Source review and PR checks do not establish native compilation, signed provider
claims, Catalyst private Keychain access or these acceptance results.

1. Before every interaction, set `FLASHCARDS_AUTOMATION_RUN=1` in the app process
   and verify `automation_run_decided` reports `isAutomation=true`. On Mac use
   `bash scripts/ios/launch-macos-test-app.sh "<path/Nibomo.app>"`.
2. On the latest supported iOS/iPadOS runtime, run the existing full native smoke
   selection. Exercise the chooser on iPhone, iPad and both iPhone Duo displays;
   repeat the focused flows below on signed Catalyst on the latest macOS.
   For essential compatibility, repeat chooser, email OTP, returning Apple,
   ordinary sign-out and hint forgetting on iOS/iPadOS 18 and macOS 15.
3. Open sign-in from Settings and credential recovery. Require one localized
   sign-in/create-account title and fixed primary Apple → Google → Email order with
   official provider controls and an envelope. Only configured native providers
   appear. Select Email before the existing email fields; verify loading,
   resend, expired/consumed-code handling, demo review login and workspace choice.
4. Complete actual new/returning Apple (shared and hidden email) and Google sign-in.
   A valid authoritative identity must not require a redundant OTP. Compare the
   actual stable user/workspace on returning sign-in; never infer Apple's personal
   email. Cancel each provider and fail a request: preserve the previous good hint.
   Verify actual signed Google server audience, registered native `azp` and raw attempt nonce;
   Apple must echo the server's SHA-256 lowercase-hex request nonce with the configured native
   audience. Never relax verification or manufacture proof. Retain only redacted pass/fail evidence
   and signed Catalyst private-Keychain save/load/clear results. For fresh Gmail/verified Workspace
   `hd` or Apple shared email, later Email OTP must open the same stable account/workspace.
   Historical `email_verified` or external Google email alone is not current mailbox authority;
   different existing product accounts and demo/real accounts must never merge. Keep working
   hidden-relay recovery without making it a prerequisite. Personal-email add/change is deferred.
5. Where the server genuinely requires mailbox proof, send and submit the actual
   6–8 digit code. To request another code, choose Start again and select the
   provider to create a fresh attempt; require no replay of mailbox send on the
   consumed attempt. Check send failure, expiry and restart. Interrupt after successful
   verification but before redemption completes: require a fresh provider attempt,
   never resubmission of the consumed proof. Closing/reopening during a slow
   request must not update a replacement attempt or start background linking.
   Swipe away a slow email verify/resend: method choices must stay disabled until
   it finishes, and a successful consumed OTP must retain Email attribution.
   Make hint loading fail: require an actionable error/Forget control and still
   usable configured providers after metadata loads.
6. With guest cards present, complete both bound and merge-required guest upgrades,
   including explicit destination selection. Interrupt preparation/completion,
   relaunch and exercise existing recovery. Require the intended stable mapping,
   preserved local data and completed linking before the normal ready account.
   Refresh/relaunch, then use cards, reviews and workspaces offline and sync after reconnecting;
   existing purchases must remain attached to the intended account.
7. Opt into remembering, complete sign-in, then sign out normally and relaunch.
   Require a small localized Last used badge floating above/across the successful button's
   upper-right edge, without increasing button height, shifting its logo/label or changing order.
   Inside the actual SwiftUI Form, inspect and tap the badge's upper half; the previous row's
   lower-right area must not intercept it or activate the wrong method. Deliberate pointer hover,
   keyboard navigation and badge activation expose only compact masked known-email text, with
   no Show, Copy, Forget or other hint controls. Unknown email stays absent. Initial/programmatic
   focus and focus restoration after provider cancellation must not open the hint. On iPad and
   Catalyst, navigate the actual UIKit provider control and the separate badge; check Escape,
   outside dismissal and restored focus. Badge activation must not sign in; an ordinary method
   tap must. Source focus modifiers and overlay offsets do not prove focus, visibility or hit-testing.
   Preserve optional Remember and Forget outside the hint. Check remember off, explicit Forget,
   Sign out and forget, local erase and deletion; clear success must remove the hint, while a
   failed clear must show an error and never confirm forgotten. Remembered presentation data
   contains no credentials.
8. Simulate hint-storage failure after account completion from both Settings and
   credential recovery. The recovery presenter must remain until Retry or Close
   finishes the attempt, even after its actual recovery authority clears. Retry
   must only save the hint and must not repeat account/guest linking. Close and
   success must release the presenter. Check Dynamic Type, narrow
   widths, VoiceOver, RTL and translated copy across all supported locales.
9. With automation active, require no client authentication product facts; unrelated server-owned
   facts follow the [automation coverage](analytics-audience.md#automation-installations).
   Independently review
   observed SDK invocation/callback, initiating method through mailbox, accepted
   session, account-ready and guest-completion producers against the fact catalog.
   Stored-session acceptance is observed when completion returns or fails, after
   matching protected credentials; a later sync failure may precede account ready.
   Require no accepted fact for preparation or credential-save failure, and a
   factual guest failure for a current failed upgrade, excluding cancellation and
   post-completion hint-save failure.
   Collection off and live withdrawal must suppress emission through `Analytics`;
   never infer positive analytics acceptance from an automation run.

Open Settings → Account Status → Sign-in methods on a separately authorized
signed artifact. Use an authorized non-demo account and verify:

1. Load actual active/disabled methods, exact generation, cleanup state and read-only
   proved recovery addresses. An empty address list must not claim email is disabled.
   Check the explicit demo-account refusal. On iPhone, iPad, both Duo displays and
   Catalyst, inspect Dynamic Type, VoiceOver, RTL and translated copy; applicable
   proof options retain official Apple → Google → Email/envelope order.
   Reauthenticate with Apple for a hidden-Apple account;
   current-email OTP is offered only when that actual session mailbox appears in
   the proved recovery list. Never require a hidden relay OTP.
2. Link through fresh current-account authority, then a separate new provider
   attempt. Exercise genuine server-required secondary mailbox send/verify;
   failed, expired or ambiguous sends/submissions require a fresh full attempt.
   Close during slow SDK/network work and change account/server: no late result
   may update the replacement state or continue a mutation. Close must remain
   available during loading. Start again must discard proofs and fetch new methods;
   no failed send or consumed verification can be resubmitted.
   Inspect actual current-email and provider-mailbox request outcomes for offline, timeout,
   rate limit and server failure, and verification outcomes for wrong/expired codes. A preflight
   failure emits no request outcome; a later failure must not overwrite an observed success.
   Repeat linking the already-linked provider and require its explicit no-op outcome.
3. Unlink with a freshly listed exact subject/generation. Verify the server's last
   usable method and different-account conflict refusals. Email stays read-only.
   On an authorized disposable account, verify actual Apple revocation/cleanup and old principal
   JWT/refresh refusal, then a fresh usable sign-in after completion. Source, scheduling and
   signed-app installation alone cannot establish those service results.
4. For explicit re-enable, wait until fresh metadata reports cleanup complete,
   then obtain new current-account proof and a new provider attempt. Native Apple
   platforms never resume a consumed provider proof. After a failed/ambiguous
   submission, refresh actual methods; show an already-active method as the actual
   outcome, otherwise restart the full proof after cleanup. Confirm old receipts,
   mailbox codes and provider credentials cannot be replayed.
5. Verify management never redeems login tokens, changes the protected session,
   provisions an account/workspace or changes the successful-login hint. Map only
   actual SDK and mutation observations to the existing fact catalog; keep all
   subject, mailbox, token, nonce and receipt values out of analytics. Link success
   requires a server-confirmed mutation, even if the subsequent metadata refresh
   fails; workspace completion is never identity-link evidence. The finite catalog
   has no unlink/re-enable mutation event, so those do not emit link success.
   Check collection off and live consent withdrawal independently; automation
   suppresses product events and cannot establish positive analytics delivery.
