import { useEffect } from "react";
import {
  registerWebGuestOwnerForAnalytics,
  requestWebGuestSessionOnInteraction,
} from "./webGuestSession";

/**
 * Watches for the first real interaction on any surface a signed-out visitor can reach, and asks for
 * a guest session then — never on a page view.
 *
 * That boundary is what keeps crawlers and pure readers out of `auth.guest_sessions`. A crawler
 * renders the page and dispatches no pointer or keyboard events at all, and `isTrusted` additionally
 * excludes anything page script synthesises. Someone who lands on a public deck or invite page,
 * reads it and leaves never activates a control either: scrolling, hovering and selecting text all
 * fail the check, so neither creates a server-side user.
 */
const interactiveElementSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[role=\"button\"]",
  "[role=\"link\"]",
  "[role=\"menuitem\"]",
  "[role=\"tab\"]",
  "[role=\"switch\"]",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

function isRealInteraction(event: Event): boolean {
  if (event.isTrusted === false) {
    return false;
  }

  const target = event.target;
  if (target instanceof Element === false) {
    return false;
  }

  return target.closest(interactiveElementSelector) !== null;
}

export function WebGuestSessionLifecycle(): null {
  useEffect(() => {
    // Registered before the session layer can confirm an account owner, so a sign-in that follows an
    // earlier guest visit is recognised as the same person continuing on this browser.
    registerWebGuestOwnerForAnalytics();
  }, []);

  useEffect(() => {
    function handleInteraction(event: Event): void {
      if (isRealInteraction(event)) {
        requestWebGuestSessionOnInteraction();
      }
    }

    // Capture phase and passive: this observes the interaction and never participates in it, so a
    // handler that stops propagation cannot hide a real activation, and nothing here can delay the
    // action the person is performing.
    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("pointerdown", handleInteraction, listenerOptions);
    document.addEventListener("keydown", handleInteraction, listenerOptions);
    return (): void => {
      document.removeEventListener("pointerdown", handleInteraction, listenerOptions);
      document.removeEventListener("keydown", handleInteraction, listenerOptions);
    };
  }, []);

  return null;
}
