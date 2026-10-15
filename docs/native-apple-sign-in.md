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
   sign-in/create-account title and fixed Apple → Google → Email order with
   official provider controls and an envelope. Only configured native providers
   appear. Select Email before the existing email fields; verify loading,
   resend, expired/consumed-code handling, demo review login and workspace choice.
4. Complete actual new/returning Apple (shared and hidden email) and Google sign-in.
   A valid authoritative identity must not require a redundant OTP. Compare the
   actual stable user/workspace on returning sign-in; never infer Apple's personal
   email. Cancel each provider and fail a request: preserve the previous good hint.
   Retain signed Google audience/nonce evidence and Catalyst Keychain results.
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
7. Opt into remembering, complete sign-in, then sign out normally and relaunch.
   Require a small localized Last used badge at the successful button's top-right,
   unchanged order, and an ordinary button tap that still signs in. Check the
   actual known email via pointer hover, keyboard focus and the accessible touch
   popover; check masking, reveal, copy and Forget. On iPad and Catalyst, use
   keyboard focus on the actual UIKit provider control and confirm the compact
   hint appears, remains usable and leaves ordinary sign-in activation intact.
   Source focus modifiers alone do not establish this runtime behavior.
   Unknown provider email must
   stay absent. Check remember off, sign out and forget, local erase and account
   deletion; all must clear the opted-out hint without retaining credentials.
8. Simulate hint-storage failure after account completion from both Settings and
   credential recovery. The recovery presenter must remain until Retry or Close
   finishes the attempt, even after its actual recovery authority clears. Retry
   must only save the hint and must not repeat account/guest linking. Close and
   success must release the presenter. Check Dynamic Type, narrow
   widths, VoiceOver, RTL and translated copy across all supported locales.
9. With automation active, require no product analytics rows. Independently review
   observed SDK invocation/callback, initiating method through mailbox, accepted
   session, account-ready and guest-completion producers against the fact catalog.
   Stored-session acceptance is observed when completion returns or fails, after
   matching protected credentials; a later sync failure may precede account ready.
   Require no accepted fact for preparation or credential-save failure, and a
   factual guest failure for a current failed upgrade, excluding cancellation and
   post-completion hint-save failure.
   Collection off and live withdrawal must suppress emission through `Analytics`;
   never infer positive analytics acceptance from an automation run.

Account-method transport/state is dormant until Settings mounts it. On the signed
artifact that exposes it, use an authorized non-demo account and verify:

1. Load actual active/disabled methods, generation, cleanup state and read-only
   proved recovery addresses. Reauthenticate with Apple for a hidden-Apple account;
   current-email OTP is offered only when that actual session mailbox appears in
   the proved recovery list. Never require a hidden relay OTP.
2. Link through fresh current-account authority, then a separate new provider
   attempt. Exercise genuine server-required secondary mailbox send/verify;
   failed, expired or ambiguous sends/submissions require a fresh full attempt.
   Close during slow SDK/network work and change account/server: no late result
   may update the replacement state or continue a mutation.
3. Unlink with a freshly listed exact subject/generation. Verify the server's last
   usable method and different-account conflict refusals. Email stays read-only.
4. For explicit re-enable, wait until fresh metadata reports cleanup complete,
   then obtain new current-account proof and a new provider attempt. Native Apple
   platforms never resume a consumed provider proof. After a failed/ambiguous
   submission, refresh actual methods; show an already-active method as the actual
   outcome, otherwise restart the full proof after cleanup. Confirm old receipts,
   mailbox codes and provider credentials cannot be replayed.
5. Verify management never redeems login tokens, changes the protected session,
   provisions an account/workspace or changes the successful-login hint. Map only
   actual SDK and mutation observations to the existing fact catalog; keep all
   subject, mailbox, token, nonce and receipt values out of analytics.
