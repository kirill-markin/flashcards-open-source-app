import type { LoginPageLocale } from "../routes/browser/loginPageLocale.js";
import { BROWSER_CONTINUATION_COPY } from "./browserContinuationCopy.js";
import { browserCompletionConsumerScript, browserHtml, browserScriptJson, renderBrowserDocument } from "./browserCompletion.js";
import { getLoginPageCopy } from "./login.js";

type BrowserMailboxView = Readonly<{
  csrfToken: string;
  providerEmail: string | null;
  expiresAt: number;
  restartUri: string;
}>;

export function renderBrowserMailboxContinuation(
  view: BrowserMailboxView, locale: LoginPageLocale, nonce: string,
): string {
  const copy = BROWSER_CONTINUATION_COPY[locale];
  const loginCopy = getLoginPageCopy(locale);
  const body = `<h1>${browserHtml(loginCopy.verificationCodeLabel)}</h1>
    <p>${browserHtml(copy.mailboxRequired)}</p>
    <form id="mailbox-email-form">
      <label for="mailbox-email">${browserHtml(loginCopy.emailLabel)}</label>
      <input id="mailbox-email" type="email" autocomplete="email" maxlength="254" required value="${browserHtml(view.providerEmail ?? "")}">
      <button id="mailbox-send" type="submit">${browserHtml(loginCopy.sendCode)}</button>
    </form>
    <form id="mailbox-code-form" hidden>
      <p class="hint">${browserHtml(copy.codeSent)}</p>
      <label for="mailbox-code">${browserHtml(loginCopy.verificationCodeLabel)}</label>
      <input id="mailbox-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required>
      <button id="mailbox-verify" type="submit">${browserHtml(loginCopy.verify)}</button>
      <p class="hint">${browserHtml(copy.requestNewCode)}</p>
    </form>
    <p id="mailbox-error" class="error" role="alert" hidden></p>
    <p id="mailbox-status" role="status" aria-live="polite"></p>
    <p><a id="mailbox-restart" href="${browserHtml(view.restartUri)}">${browserHtml(copy.restart)}</a></p>`;
  return renderBrowserDocument(locale, nonce, loginCopy.pageTitle, body, `
    ${browserCompletionConsumerScript}
    const view = ${browserScriptJson(view)};
    const copy = ${browserScriptJson(copy)};
    const loginCopy = ${browserScriptJson(loginCopy)};
    const emailForm = document.getElementById("mailbox-email-form");
    const codeForm = document.getElementById("mailbox-code-form");
    const emailInput = document.getElementById("mailbox-email");
    const codeInput = document.getElementById("mailbox-code");
    const sendButton = document.getElementById("mailbox-send");
    const verifyButton = document.getElementById("mailbox-verify");
    const errorElement = document.getElementById("mailbox-error");
    const statusElement = document.getElementById("mailbox-status");
    let busy = false;
    let stopped = false;
    let completed = false;

    function showError(message) {
      errorElement.textContent = message;
      errorElement.hidden = false;
    }

    function stop(message) {
      stopped = true;
      sendButton.disabled = true;
      verifyButton.disabled = true;
      emailInput.disabled = true;
      codeInput.disabled = true;
      showError(message);
    }

    function checkExpiry() {
      if (!completed && Date.now() >= view.expiresAt) stop(copy.expired);
      return stopped;
    }

    function setBusy(value) {
      busy = value;
      emailForm.setAttribute("aria-busy", String(value));
      codeForm.setAttribute("aria-busy", String(value));
      sendButton.disabled = value || stopped || completed;
      verifyButton.disabled = value || stopped || completed;
      emailInput.disabled = value || stopped || completed;
      codeInput.disabled = value || stopped || completed;
      sendButton.textContent = value ? loginCopy.sendingCode : loginCopy.sendCode;
      verifyButton.textContent = value ? loginCopy.verifying : loginCopy.verify;
    }

    function showCode() {
      emailForm.hidden = true;
      codeForm.hidden = false;
      codeInput.focus();
    }

    async function submit(fields, transportMessage) {
      let response;
      let result;
      try {
        response = await fetch("/api/social/browser/complete", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fields, csrfToken: view.csrfToken }),
        });
        result = await response.json();
      } catch {
        showError(transportMessage);
        return { kind: "transport_error" };
      }
      if (!response.ok) {
        const code = result && typeof result.code === "string" ? result.code : "HTTP_" + response.status;
        showError(loginCopy.genericErrorPrefix + ": " + code);
        if (code !== "ENROLLMENT_EMAIL_INVALID") stop(loginCopy.genericErrorPrefix + ": " + code + ". " + copy.restart);
        return { kind: "rejected" };
      }
      return { kind: "accepted", result };
    }

    emailForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (busy || completed || checkExpiry() || !emailForm.reportValidity()) return;
      errorElement.hidden = true;
      setBusy(true);
      let sent = false;
      try {
        const submission = await submit({ action: "mailbox_send", email: emailInput.value.trim() }, loginCopy.sendCodeTransportErrorMessage);
        if (submission.kind !== "accepted") {
          if (submission.kind === "transport_error" && !stopped) sent = true;
          return;
        }
        const result = submission.result;
        if (result === null || typeof result !== "object" || result.status !== "mailbox_code_sent") {
          stop(loginCopy.genericErrorPrefix + ": AUTH_COMPLETION_INVALID. " + copy.restart);
          return;
        }
        sent = true;
      } finally {
        setBusy(false);
        if (sent && !checkExpiry()) showCode();
      }
    });

    codeInput.addEventListener("input", function() {
      codeInput.value = codeInput.value.replace(/\\D/g, "").slice(0, 8);
    });

    codeForm.addEventListener("submit", async function(event) {
      event.preventDefault();
      if (busy || completed || checkExpiry() || !codeForm.reportValidity()) return;
      errorElement.hidden = true;
      setBusy(true);
      try {
        const submission = await submit({ action: "mailbox_verify", code: codeInput.value }, loginCopy.verifyCodeTransportErrorMessage);
        if (submission.kind !== "accepted") return;
        try {
          completed = true;
          statusElement.textContent = copy.continue;
          consumeBrowserCompletion(submission.result);
        } catch {
          completed = false;
          stop(loginCopy.genericErrorPrefix + ": AUTH_COMPLETION_INVALID. " + copy.restart);
        }
      } finally {
        setBusy(false);
      }
    });

    if (!checkExpiry()) emailInput.focus();
    window.setInterval(checkExpiry, 1000);
    window.addEventListener("pageshow", checkExpiry);
  `);
}
