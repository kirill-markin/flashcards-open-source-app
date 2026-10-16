import type { LoginPageLocale } from "../routes/browser/loginPageLocale.js";
import { BROWSER_HINT_COPY } from "./browserHintCopy.js";
import { BROWSER_CONTINUATION_COPY } from "./browserContinuationCopy.js";

export function renderBrowserHintFeedback(locale: LoginPageLocale): string {
  return `<div id="signin-hint-feedback" class="auth-hint-feedback" role="status" hidden>
    <p>${BROWSER_HINT_COPY[locale].error}</p>
    <details><summary>${BROWSER_HINT_COPY[locale].details}</summary><p id="signin-hint-error"></p></details>
    <button id="signin-hint-continue" type="button" hidden>${BROWSER_CONTINUATION_COPY[locale].continue}</button>
  </div>`;
}

export const browserHintControlsStyles = `
  .auth-method-option { position: relative; }
  .auth-last-used { position: absolute; top: 0; right: 12px; transform: translateY(-50%); width: auto; min-height: 24px;
    padding: 1px 6px; border: 0; border-radius: 8px; background: #3a3a3c; color: #fff;
    font: 500 10px/1.2 system-ui, sans-serif; cursor: pointer; }
  .auth-last-used:hover { background: #48484a; }
  .auth-last-used:active { background: #636366; }
  .auth-hint-popover { display: none; position: absolute; top: calc(100% - 2px); right: 0; z-index: 2;
    max-width: 100%; padding: 6px 8px; border: 1px solid #8e8e93; border-radius: 8px;
    background: #1c1c1e; color: #f6f6f8; font-size: 12px; overflow-wrap: anywhere; }
  .has-hint[data-keyboard-focus] .auth-hint-popover, .has-hint[data-open] .auth-hint-popover,
  .has-hint[data-hover] .auth-hint-popover { display: block; }
  .auth-hint-popover p { margin: 0; }
  .auth-hint-popover:empty, .has-hint[data-dismissed] .auth-hint-popover { display: none !important; }
  .auth-hint-feedback button { width: auto; min-height: 32px;
    padding: 4px 8px; border: 1px solid #8e8e93; border-radius: 8px; background: #2c2c2e; color: #f6f6f8; font: inherit; cursor: pointer; }
  .auth-last-used:focus-visible { outline: 2px solid #8e8e93; outline-offset: 2px; }
  .auth-hint-feedback { font-size: 12px; color: #ff858b; overflow-wrap: anywhere; }
  .auth-hint-feedback[hidden], .auth-last-used[hidden] { display: none; }
`;

export const browserHintControlsScript = `
  var hintFeedback = document.getElementById("signin-hint-feedback");
  var hintContinue = document.getElementById("signin-hint-continue");
  var entrySessionAccepted = false;
  var hintKeyboardNavigation = false;

  function hintError(error) {
    document.getElementById("signin-hint-error").textContent = error instanceof Error ? error.message : String(error);
    hintFeedback.hidden = false;
  }

  window.addEventListener("nibomo-auth-hint-error", function(event) { hintError(new Error(event.detail)); });

  function renderRememberedHint() {
    try {
      var hint = browserHints.readHint();
      stepMethods.querySelectorAll(".auth-method-option").forEach(function(option) {
        var button = option.querySelector(".auth-method");
        var badge = option.querySelector(".auth-last-used");
        var popover = option.querySelector(".auth-hint-popover");
        var active = hint !== null && button.id === "signin-" + hint.method;
        option.classList.toggle("has-hint", active);
        option.removeAttribute("data-open");
        option.removeAttribute("data-dismissed");
        option.removeAttribute("data-keyboard-focus");
        option.removeAttribute("data-hover");
        badge.hidden = !active;
        button.removeAttribute("aria-describedby");
        badge.removeAttribute("aria-describedby");
        popover.replaceChildren();
        if (!active) return;
        var email = hint.method === "email" ? hint.email : hint.providerEmail;
        if (email === null) return;
        var emailLabel = document.createElement("p");
        emailLabel.dir = "ltr";
        var masked = email.slice(0, 1) + "•••@" + email.split("@")[1];
        emailLabel.textContent = masked;
        popover.append(emailLabel);
        badge.setAttribute("aria-describedby", popover.id);
      });
    } catch (error) { hintError(error); }
  }

  function configureBrowserHints() {
    renderRememberedHint();
    document.addEventListener("keydown", function(event) {
      hintKeyboardNavigation = event.isTrusted && event.key === "Tab";
    }, true);
    document.addEventListener("focusin", function(event) {
      var option = event.target.closest(".auth-method-option");
      if (option && hintKeyboardNavigation) {
        option.removeAttribute("data-dismissed");
        option.setAttribute("data-keyboard-focus", "");
      }
      hintKeyboardNavigation = false;
    });
    document.addEventListener("pointerdown", function(event) {
      hintKeyboardNavigation = false;
      stepMethods.querySelectorAll(".auth-method-option").forEach(function(option) {
        if (!option.contains(event.target)) {
          option.removeAttribute("data-open");
          option.setAttribute("data-dismissed", "");
        }
      });
    });
    stepMethods.querySelectorAll(".auth-last-used").forEach(function(badge) {
      badge.addEventListener("click", function() {
        var option = badge.closest(".auth-method-option");
        var open = option.hasAttribute("data-open") && !option.hasAttribute("data-dismissed");
        option.toggleAttribute("data-dismissed", open);
        option.toggleAttribute("data-open", !open);
      });
      badge.closest(".auth-method-option").addEventListener("focusout", function(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.removeAttribute("data-keyboard-focus");
          event.currentTarget.removeAttribute("data-open");
        }
      });
      badge.closest(".auth-method-option").addEventListener("pointermove", function(event) {
        if (event.pointerType !== "mouse") return;
        event.currentTarget.removeAttribute("data-dismissed");
        event.currentTarget.setAttribute("data-hover", "");
      });
      badge.closest(".auth-method-option").addEventListener("pointerleave", function(event) { event.currentTarget.removeAttribute("data-hover"); });
      badge.closest(".auth-method-option").addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
          badge.focus();
          event.currentTarget.removeAttribute("data-open");
          event.currentTarget.setAttribute("data-dismissed", "");
        }
      });
    });
    window.addEventListener("pageshow", function() {
      hintKeyboardNavigation = false;
      renderRememberedHint();
    });
    window.addEventListener("storage", function(event) {
      if (event.key === null || event.key.startsWith("nibomo-auth-hint-")) renderRememberedHint();
    });
  }

  async function acceptEntrySignIn(result, continueSignIn) {
    entrySessionAccepted = true;
    document.querySelectorAll("#step-email input, #step-email button, #step-otp input, #step-otp button").forEach(function(control) { control.disabled = true; });
    if (await browserHints.acceptOptional(result)) { continueSignIn(); return; }
    hintContinue.hidden = false;
    hintContinue.onclick = continueSignIn;
  }
`;
