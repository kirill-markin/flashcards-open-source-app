import { type ReactElement, useState } from "react";
import { flushBeforeIdentityTeardown, track } from "./analytics";

type Props = Readonly<{
  className: string;
  href: string;
  label: string;
}>;

/**
 * Whether this document has already reported a sign-out.
 *
 * Module scope, not component state, and that is the whole point. Two sign-out controls are on
 * screen at the same time on `/settings/account` — the always-mounted account menu in the topbar
 * and the screen's own button — and the menu's overlay unmounts whenever it closes, taking any
 * component-local flag with it. A per-control flag therefore covers neither a person who presses
 * one control, sees nothing happen on the page behind it and presses the other, nor a person who
 * presses the menu's control, clicks away, reopens the menu and presses it again. Both write a
 * second `signed_out` row for one departure, and `analytics.product_events` is append-only with no
 * repair path, so an over-count is permanent.
 *
 * Never reset. Every path out of here navigates away and the flag dies with the document, and a
 * document that somehow stays is one whose navigation did not happen — where reporting the
 * departure twice would be worse than not reporting the retry at all.
 */
let hasReportedSignOutForThisDocument = false;

/**
 * The sign-out control, which holds its own navigation.
 *
 * Leaving for the auth origin destroys the credential everything this browser queued would have
 * gone out on, and the analytics reset that follows runs on a later load, with no credential left
 * to send anything under. So the navigation waits for the bounded drain instead of starting it and
 * leaving: what the bound does not cover is lost, which is the accepted trade for the interface
 * meaning what it says when it reports the person as signed out.
 *
 * Rendered as a real link, so the browser's own affordances — middle click, open in a new tab,
 * copying the address — keep working. Those paths never reach the handler and never wait, which is
 * correct: this document is not leaving.
 *
 * `isSigningOut` is never cleared either, on purpose and for the same reason as the module flag
 * above. The only way back into this handler is a document that did not navigate — the assignment
 * failed, or a `bfcache` Back restored this page — and on that document the control stays dead and
 * the spinner stays on rather than inviting a press that could only write a row for a departure
 * already reported. It costs the person one control, not the page: the modifier and middle-click
 * paths return above this state, and every other way out of the account screen still works.
 */
export function SignOutLink(props: Props): ReactElement {
  const { className, href, label } = props;
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  return (
    <a
      className={className}
      href={href}
      aria-busy={isSigningOut}
      onClick={(event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        if (isSigningOut) {
          return;
        }

        setIsSigningOut(true);
        // Tracked here rather than on the load that comes back, because that load has no
        // credential left to send it under and discards the queue with the rest of the account's
        // local state. The drain below is what gets it off the browser before either happens.
        if (hasReportedSignOutForThisDocument === false) {
          hasReportedSignOutForThisDocument = true;
          track({ name: "signed_out", reason: "user_initiated" });
        }
        void flushBeforeIdentityTeardown()
          .catch((): void => {
            // The sign-out leaves either way: nothing analytics does may strand a person on a page
            // they asked to leave. The drain reports its own failures.
          })
          .then((): void => {
            window.location.assign(href);
          });
      }}
    >
      {/* Decorative: the link carries `aria-busy`, which is what announces the wait. An
          `aria-label` on a bare `<span>` with no role is not exposed at all. */}
      {isSigningOut ? <span className="sign-out-link-spinner" aria-hidden="true" /> : null}
      {label}
    </a>
  );
}
