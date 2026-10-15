import type { LoginPageLocale } from "../routes/browser/loginPageLocale.js";
import { BROWSER_HINT_COPY } from "./browserHintCopy.js";
import { BROWSER_CONTINUATION_COPY } from "./browserContinuationCopy.js";

export function renderBrowserHintControls(locale: LoginPageLocale): string {
  const copy = BROWSER_HINT_COPY[locale];
  return `<div class="auth-hint-controls">
    <label><input id="remember-signin" type="checkbox"> ${copy.remember}</label>
    <button id="forget-signin" type="button">${copy.forget}</button>
  </div>`;
}

export function renderBrowserHintFeedback(locale: LoginPageLocale): string {
  return `<div id="signin-hint-feedback" class="auth-hint-feedback" role="status" hidden>
    <p>${BROWSER_HINT_COPY[locale].error}</p>
    <details><summary>${BROWSER_HINT_COPY[locale].details}</summary><p id="signin-hint-error"></p></details>
    <button id="signin-hint-continue" type="button" hidden>${BROWSER_CONTINUATION_COPY[locale].continue}</button>
  </div>`;
}

export const browserHintControlsStyles = `
  .auth-method-option { position: relative; }
  .auth-method-option.has-hint .auth-method { padding-top: 20px; }
  .auth-last-used { position: absolute; top: 2px; right: 12px; width: auto; min-height: 24px;
    padding: 1px 6px; border: 0; border-radius: 8px; background: #3a3a3c; color: #fff;
    font: 500 10px/1.2 system-ui, sans-serif; cursor: pointer; }
  .auth-hint-popover { display: none; position: absolute; top: calc(100% - 2px); right: 0; z-index: 2;
    max-width: 100%; padding: 12px; border: 1px solid #8e8e93; border-radius: 12px;
    background: #1c1c1e; color: #f6f6f8; font-size: 12px; overflow-wrap: anywhere; }
  .has-hint:focus-within .auth-hint-popover, .has-hint[data-open] .auth-hint-popover { display: block; }
  @media (hover: hover) { .has-hint:hover .auth-hint-popover { display: block; } }
  .auth-hint-popover:empty, .has-hint[data-dismissed] .auth-hint-popover { display: none !important; }
  .auth-hint-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 12px; color: var(--text-secondary); }
  .auth-hint-controls label { display: flex; align-items: center; gap: 6px; }
  .auth-hint-controls input { width: auto; margin: 0; }
  .auth-hint-controls button, .auth-hint-popover button, .auth-hint-feedback button { width: auto; min-height: 32px;
    padding: 4px 8px; border: 1px solid #8e8e93; border-radius: 8px; background: #2c2c2e; color: #f6f6f8; font: inherit; cursor: pointer; }
  .auth-hint-controls :focus-visible, .auth-last-used:focus-visible, .auth-hint-popover :focus-visible { outline: 2px solid #8e8e93; outline-offset: 2px; }
  .auth-hint-feedback { font-size: 12px; color: #ff858b; overflow-wrap: anywhere; }
  .auth-hint-feedback[hidden], .auth-last-used[hidden], .auth-hint-popover button[hidden] { display: none; }
`;

export const browserHintControlsScript = `
  var rememberSignIn = document.getElementById("remember-signin");
  var forgetSignIn = document.getElementById("forget-signin");
  var hintFeedback = document.getElementById("signin-hint-feedback");
  var hintContinue = document.getElementById("signin-hint-continue");
  var hintBusy = false;
  var entrySessionAccepted = false;

  function hintError(error) {
    document.getElementById("signin-hint-error").textContent = error instanceof Error ? error.message : String(error);
    hintFeedback.hidden = false;
  }

  window.addEventListener("nibomo-auth-hint-error", function(event) { hintError(new Error(event.detail)); });

  function renderRememberedHint() {
    try {
      var hint = browserHints.readHint();
      rememberSignIn.checked = browserHints.isRemembering();
      stepMethods.querySelectorAll(".auth-method-option").forEach(function(option) {
        var button = option.querySelector(".auth-method");
        var badge = option.querySelector(".auth-last-used");
        var popover = option.querySelector(".auth-hint-popover");
        var active = hint !== null && button.id === "signin-" + hint.method;
        option.classList.toggle("has-hint", active);
        option.removeAttribute("data-open");
        option.removeAttribute("data-dismissed");
        badge.hidden = !active;
        button.removeAttribute("aria-describedby");
        popover.replaceChildren();
        if (!active) return;
        button.setAttribute("aria-describedby", popover.id);
        var email = hint.method === "email" ? hint.email : hint.providerEmail;
        if (email === null) return;
        var emailLabel = document.createElement("p");
        emailLabel.dir = "ltr";
        var masked = email.slice(0, 1) + "•••@" + email.split("@")[1];
        emailLabel.textContent = masked;
        var reveal = document.createElement("button");
        reveal.type = "button";
        reveal.textContent = hintCopy.reveal;
        reveal.setAttribute("aria-pressed", "false");
        reveal.addEventListener("click", function() {
          var shown = reveal.getAttribute("aria-pressed") !== "true";
          emailLabel.textContent = shown ? email : masked;
          reveal.textContent = shown ? hintCopy.hide : hintCopy.reveal;
          reveal.setAttribute("aria-pressed", String(shown));
        });
        var copyEmail = document.createElement("button");
        copyEmail.type = "button";
        copyEmail.textContent = hintCopy.copy;
        copyEmail.addEventListener("click", function() {
          Promise.resolve().then(function() { return navigator.clipboard.writeText(email); }).catch(hintError);
        });
        popover.append(emailLabel, reveal, copyEmail);
      });
    } catch (error) { hintError(error); }
  }

  async function updateRemembering(action) {
    if (hintBusy) return;
    hintBusy = true;
    rememberSignIn.disabled = true;
    forgetSignIn.disabled = true;
    methodButtons.forEach(function(button) { button.disabled = true; });
    try {
      await action();
      hintFeedback.hidden = true;
      renderRememberedHint();
    } catch (error) {
      hintError(error);
      // Keep the last confirmed preference when a clear or opt-in failed.
      try { rememberSignIn.checked = browserHints.isRemembering(); } catch (readError) { hintError(readError); }
    } finally {
      hintBusy = false;
      rememberSignIn.disabled = false;
      forgetSignIn.disabled = false;
      methodButtons.forEach(function(button) { button.disabled = false; });
    }
  }

  function configureBrowserHints() {
    renderRememberedHint();
    rememberSignIn.addEventListener("change", function() {
      void updateRemembering(rememberSignIn.checked ? browserHints.enableRemembering : browserHints.forget);
    });
    forgetSignIn.addEventListener("click", function() { void updateRemembering(browserHints.forget); });
    stepMethods.querySelectorAll(".auth-last-used").forEach(function(badge) {
      badge.addEventListener("click", function() {
        var option = badge.closest(".auth-method-option");
        option.removeAttribute("data-dismissed");
        option.toggleAttribute("data-open");
      });
      badge.closest(".auth-method-option").addEventListener("focusin", function(event) { event.currentTarget.removeAttribute("data-dismissed"); });
      badge.closest(".auth-method-option").addEventListener("pointerenter", function(event) { event.currentTarget.removeAttribute("data-dismissed"); });
      badge.closest(".auth-method-option").addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
          badge.focus();
          event.currentTarget.removeAttribute("data-open");
          event.currentTarget.setAttribute("data-dismissed", "");
        }
      });
    });
    window.addEventListener("storage", function(event) {
      if (event.key === null || event.key.startsWith("nibomo-auth-hint-")) renderRememberedHint();
    });
  }

  async function acceptEntrySignIn(result, continueSignIn) {
    entrySessionAccepted = true;
    document.querySelectorAll("#step-email input, #step-email button, #step-otp input, #step-otp button").forEach(function(control) { control.disabled = true; });
    if (await browserHints.acceptOptional(result)) { continueSignIn(); return; }
    // Session cookies are already accepted. The explicit continuation keeps the optional error readable.
    hintContinue.hidden = false;
    hintContinue.onclick = continueSignIn;
  }
`;
