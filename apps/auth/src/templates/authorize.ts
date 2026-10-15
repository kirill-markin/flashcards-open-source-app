import { BROWSER_HINT_COPY } from "./browserHintCopy.js";
import { AUTH_ENTRY_COPY } from "./authEntryCopy.js";
import { authEntryScript, authEntryStyles, renderAuthMethods, renderOtherMethods } from "./authEntry.js";
import { hasOAuthScope } from "../server/oauth/scopes.js";
import {
  getLoginPageLocaleDirection,
  type LoginPageLocale,
} from "../routes/browser/loginPageLocale.js";
import {
  AUTHORIZE_CONSENT_COPY,
  type AuthorizeConsentCopy,
} from "../routes/oauth/authorizePageLocale.js";

const AUTH_FAVICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%20viewBox=%220%200%20512%20512%22%3E%3Crect%20width=%22512%22%20height=%22512%22%20rx=%2296%22%20fill=%22%23232323%22/%3E%3Crect%20x=%22104%22%20y=%2292%22%20width=%22184%22%20height=%22264%22%20rx=%2232%22%20fill=%22%23f8f3ec%22/%3E%3Crect%20x=%22212%22%20y=%22156%22%20width=%22196%22%20height=%22272%22%20rx=%2232%22%20fill=%22%23c44b2d%22/%3E%3C/svg%3E";

/**
 * The validated authorization request echoed into the page and posted back on
 * consent. Some fields (state, clientName) are attacker-influenced, so the JSON
 * is serialized with toScriptJson, which escapes the characters that could
 * terminate the inline <script> element or break the JS string literal.
 */
export type AuthorizeRequestView = Readonly<{
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string | null;
  resource: string;
  clientName: string;
  nonce: string | null;
  issuer: string;
}>;

/**
 * Serializes a value to JSON safe for embedding in an inline <script> body.
 * JSON.stringify does not escape `<`, `>`, `&`, U+2028, or U+2029, so a string
 * containing `</script>` (or a JS line separator) could break out of the script
 * element or the surrounding statement. Escaping them as \uXXXX keeps the JSON
 * valid while making breakout impossible.
 */
const toScriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export const renderAuthorizePage = (
  request: AuthorizeRequestView,
  locale: LoginPageLocale,
): string => {
  const copy: AuthorizeConsentCopy = AUTHORIZE_CONSENT_COPY[locale];
  const entryCopy = AUTH_ENTRY_COPY[locale];
  const direction = getLoginPageLocaleDirection(locale);

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="${AUTH_FAVICON_URL}">
  <title>${copy.pageTitle}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #000000;
      --surface: #1c1c1e;
      --surface-muted: #2c2c2e;
      --surface-muted-hover: #3a3a3c;
      --text: #f6f6f8;
      --text-secondary: rgba(235, 235, 245, 0.66);
      --accent: #c44b2d;
      --accent-strong: #d65a38;
      --border-strong: #8e8e93;
      --danger: #ff4d57;
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-xl: 24px;
      --radius-pill: 999px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }

    html {
      background: var(--bg);
    }

    body {
      background: transparent;
      color: var(--text);
      font-family:
        -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    ::selection { background: rgba(196, 75, 45, 0.34); color: var(--text); }

    .login-page {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px 16px;
      width: 100%;
    }

    .login-card {
      width: 100%;
      max-width: 420px;
      border-radius: var(--radius-xl);
      padding: 30px;
      background: var(--surface);
    }

    .login-title {
      margin: 0 0 16px;
      font-size: clamp(1.6rem, 3.4vw, 2rem);
      font-weight: 760;
      line-height: 1.04;
      letter-spacing: 0;
    }

    .login-label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .login-input {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      margin-bottom: 16px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: var(--surface-muted);
      color: var(--text);
      font-family: inherit;
      font-size: 16px;
      transition: background 140ms ease, outline-color 140ms ease;
    }

    .login-input::placeholder { color: rgba(235, 235, 245, 0.45); }

    .login-input:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 2px;
      background: var(--surface-muted-hover);
    }

    .login-btn {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 10px 14px;
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--accent);
      color: #fff5f2;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 140ms ease, opacity 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .login-btn:hover { background: var(--accent-strong); }
    }

    .login-btn:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 3px;
    }

    .login-btn:disabled { opacity: 0.5; cursor: default; }

    .login-btn-secondary {
      margin-top: 10px;
      background: var(--surface-muted);
      color: var(--text-secondary);
    }

    @media (hover: hover) and (pointer: fine) {
      .login-btn-secondary:hover { background: var(--surface-muted-hover); color: var(--text); }
    }

    .login-error { color: var(--danger); font-size: 13px; margin-bottom: 12px; }
    .login-hint { color: var(--text-secondary); font-size: 14px; margin: 0 0 16px; }
    .login-status { color: var(--text-secondary); font-size: 13px; margin: 0; }

    .consent-scope {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 0;
      border-radius: var(--radius-sm);
      background: var(--surface-muted);
      color: var(--text-secondary);
      font-size: 13px;
    }

    .consent-account { color: var(--text-secondary); font-size: 13px; margin: 0 0 16px; }
    .consent-account strong { color: var(--text); font-weight: 600; }

    ${authEntryStyles}
    .hidden { display: none; }

    @media (max-width: 768px) {
      .login-page { padding: 18px 14px; }
      .login-card { max-width: 100%; border-radius: var(--radius-md); padding: 24px 18px; }
    }
  </style>
</head>
<body>
  <div class="login-page">
    <div class="login-card">
      <div id="step-checking">
        <p class="login-status">${copy.checkingSession}</p>
      </div>

      <div id="signin-heading" class="hidden"><h1 class="login-title">${entryCopy.title}</h1></div>
      ${renderAuthMethods(locale)}

      <div id="step-email" class="hidden">
        <label class="login-label" for="login-email">${copy.emailLabel}</label>
        <input id="login-email" class="login-input" type="email" autocomplete="email">
        <div id="email-error" class="login-error hidden"></div>
        <button id="send-btn" class="login-btn" type="button">${copy.sendCode}</button>
        ${renderOtherMethods(locale, "email-other-methods")}
      </div>

      <div id="step-otp" class="hidden">
        <p class="login-hint">${copy.checkEmailForCode}</p>
        <label class="login-label" for="login-otp">${copy.verificationCodeLabel}</label>
        <input id="login-otp" class="login-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8">
        <div id="otp-error" class="login-error hidden"></div>
        <button id="verify-btn" class="login-btn" type="button">${copy.verify}</button>
        <button id="resend-btn" class="auth-other-methods" type="button">${copy.sendCode}</button>
        ${renderOtherMethods(locale, "otp-other-methods")}
      </div>

      <div id="step-consent" class="hidden">
        <h1 class="login-title">${copy.consentTitle}</h1>
        <p class="login-hint" id="consent-lead"></p>
        ${request.scope === null || hasOAuthScope(request.scope, "flashcards") ? `<p class="consent-scope">${copy.consentScopeAccess}</p>` : ""}
        ${hasOAuthScope(request.scope, "openid") ? `<p class="consent-scope">${copy.consentIdentityAccess}</p>` : ""}
        ${hasOAuthScope(request.scope, "email") ? `<p class="consent-scope">${copy.consentEmailAccess}</p>` : ""}
        <p class="consent-account hidden" id="consent-account"></p>
        <div id="consent-error" class="login-error hidden"></div>
        <button id="approve-btn" class="login-btn" type="button">${copy.approve}</button>
        <button id="deny-btn" class="login-btn login-btn-secondary" type="button">${copy.deny}</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var request = ${toScriptJson(request)};
      var copy = ${toScriptJson(copy)};
      var hintCopy = ${JSON.stringify(BROWSER_HINT_COPY[locale])};
      var entryCopy = ${toScriptJson(entryCopy)};
      var uiLocale = ${toScriptJson(locale)};
      var collectionDisabled = new URLSearchParams(window.location.search).get("analytics_collection") === "off";
      ${authEntryScript}

      var csrfToken = "";
      var resendingCode = false;

      var emailInput = document.getElementById("login-email");
      var otpInput = document.getElementById("login-otp");
      var sendBtn = document.getElementById("send-btn");
      var verifyBtn = document.getElementById("verify-btn");
      var approveBtn = document.getElementById("approve-btn");
      var denyBtn = document.getElementById("deny-btn");
      var signInHeading = document.getElementById("signin-heading");
      var stepChecking = document.getElementById("step-checking");
      var stepEmail = document.getElementById("step-email");
      var stepOtp = document.getElementById("step-otp");
      var stepConsent = document.getElementById("step-consent");
      var emailError = document.getElementById("email-error");
      var otpError = document.getElementById("otp-error");
      var consentError = document.getElementById("consent-error");
      var consentLead = document.getElementById("consent-lead");
      var consentAccount = document.getElementById("consent-account");

      function showError(el, msg) {
        el.textContent = msg;
        el.classList.remove("hidden");
      }

      function hideError(el) {
        el.classList.add("hidden");
        el.textContent = "";
      }

      function hideAllSteps() {
        stepMethods.classList.add("hidden");
        signInHeading.classList.add("hidden");
        stepChecking.classList.add("hidden");
        stepEmail.classList.add("hidden");
        stepOtp.classList.add("hidden");
        stepConsent.classList.add("hidden");
      }

      function showMethodsStep() {
        hideAllSteps();
        signInHeading.classList.remove("hidden");
        stepMethods.classList.remove("hidden");
        methodButtons[0].focus();
      }

      function showEmailStep() {
        hideAllSteps();
        signInHeading.classList.remove("hidden");
        stepEmail.classList.remove("hidden");
        emailInput.focus();
      }

      function showConsentStep(email) {
        hideAllSteps();
        consentLead.textContent = copy.consentLead.replace("{client}", request.clientName);
        if (email) {
          consentAccount.textContent = copy.consentSignedInAs + " " + email;
          consentAccount.classList.remove("hidden");
        }
        stepConsent.classList.remove("hidden");
        approveBtn.focus();
      }

      function tryRefreshSession() {
        return fetch("api/refresh-session?ui_locale=" + encodeURIComponent(uiLocale), {
          method: "POST",
          headers: collectionDisabled ? { "X-Product-Analytics-Enabled": "0" } : {},
          credentials: "same-origin",
        }).then(function(res) {
          if (res.ok) {
            showConsentStep("");
            return;
          }
          showMethodsStep();
        }).catch(function() {
          showMethodsStep();
        });
      }

      otpInput.addEventListener("input", function() {
        otpInput.value = otpInput.value.replace(/\\D/g, "").slice(0, 8);
      });

      emailInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") sendBtn.click();
      });

      otpInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") verifyBtn.click();
      });

      document.getElementById("resend-btn").addEventListener("click", function() {
        resendingCode = true;
        authFact("auth_code_resend_requested", "email");
        sendBtn.click();
      });

      sendBtn.addEventListener("click", function() {
        var email = emailInput.value.trim();
        if (!email || sendBtn.disabled || entrySessionAccepted) return;
        var codeAction = resendingCode ? "resend" : "initial";
        resendingCode = false;
        document.getElementById("resend-btn").disabled = true;

        var requestError = codeAction === "resend" ? otpError : emailError;
        hideError(requestError);
        verifyBtn.disabled = true;
        document.getElementById("otp-other-methods").disabled = true;
        sendBtn.disabled = true;
        document.getElementById("email-other-methods").disabled = true;
        sendBtn.textContent = copy.sendingCode;

        browserHints.beginOptional("email");

        fetch("api/send-code?screen=signin&ui_locale=" + encodeURIComponent(uiLocale) + "&action=" + codeAction, {
          method: "POST",
          headers: collectionDisabled
            ? { "Content-Type": "application/json", "X-Product-Analytics-Enabled": "0" }
            : { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email: email }),
        })
          .then(function(res) {
            return res.json().then(async function(data) {
              if (!res.ok) {
                showError(requestError, data.error || copy.genericErrorPrefix + ": " + res.status);
                return;
              }
              if (
                typeof data.idToken === "string" && data.idToken !== ""
                && typeof data.refreshToken === "string" && data.refreshToken !== ""
              ) {
                await acceptEntrySignIn(data, function() { showConsentStep(email); });
                return;
              }
              csrfToken = data.csrfToken || "";
              if (stepOtp.classList.contains("hidden")) authFact("auth_code_form_shown", "email");
              otpInput.value = "";
              hideAllSteps();
              signInHeading.classList.remove("hidden");
              stepOtp.classList.remove("hidden");
              otpInput.focus();
            });
          })
          .catch(function() {
            showError(requestError, copy.genericErrorPrefix);
          })
          .finally(function() {
            if (entrySessionAccepted) return;
            verifyBtn.disabled = false;
            document.getElementById("otp-other-methods").disabled = false;
            sendBtn.disabled = false;
            document.getElementById("resend-btn").disabled = false;
            document.getElementById("email-other-methods").disabled = false;
            sendBtn.textContent = copy.sendCode;
          });
      });

      verifyBtn.addEventListener("click", function() {
        var code = otpInput.value.trim();
        if (code.length !== 8 || verifyBtn.disabled || sendBtn.disabled || entrySessionAccepted) return;

        hideError(otpError);
        authFact("auth_code_submitted", "email");
        document.getElementById("resend-btn").disabled = true;
        verifyBtn.disabled = true;
        document.getElementById("otp-other-methods").disabled = true;
        verifyBtn.textContent = copy.verifying;

        fetch("api/verify-code?screen=signin&ui_locale=" + encodeURIComponent(uiLocale), {
          method: "POST",
          headers: collectionDisabled
            ? { "Content-Type": "application/json", "X-Product-Analytics-Enabled": "0" }
            : { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ code: code, csrfToken: csrfToken }),
        })
          .then(function(res) {
            return res.json().then(async function(data) {
              if (!res.ok) {
                showError(otpError, data.error || copy.genericErrorPrefix + ": " + res.status);
                return;
              }
              await acceptEntrySignIn(data, function() { showConsentStep(""); });
            });
          })
          .catch(function() {
            showError(otpError, copy.genericErrorPrefix);
          })
          .finally(function() {
            if (entrySessionAccepted) return;
            verifyBtn.disabled = false;
            document.getElementById("resend-btn").disabled = false;
            document.getElementById("otp-other-methods").disabled = false;
            verifyBtn.textContent = copy.verify;
          });
      });

      denyBtn.addEventListener("click", function() {
        // RFC 6749 4.1.2.1: report access_denied to the client's redirect_uri.
        var url = new URL(request.redirectUri);
        url.searchParams.set("error", "access_denied");
        url.searchParams.set("iss", request.issuer);
        if (request.state) url.searchParams.set("state", request.state);
        window.location.href = url.toString();
      });

      approveBtn.addEventListener("click", function() {
        hideError(consentError);
        approveBtn.disabled = true;
        denyBtn.disabled = true;
        approveBtn.textContent = copy.approving;

        fetch("authorize/consent", {
          method: "POST",
          headers: collectionDisabled
            ? { "Content-Type": "application/json", "X-Product-Analytics-Enabled": "0" }
            : { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            client_id: request.clientId,
            redirect_uri: request.redirectUri,
            state: request.state,
            code_challenge: request.codeChallenge,
            scope: request.scope,
            resource: request.resource,
            nonce: request.nonce,
          }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                if (res.status === 401) {
                  entrySessionAccepted = false;
                  hintContinue.hidden = true;
                  document.querySelectorAll("#step-email input, #step-email button, #step-otp input, #step-otp button").forEach(function(control) { control.disabled = false; });
                  showMethodsStep();
                  return;
                }
                showError(consentError, data.error_description || data.error || copy.genericErrorPrefix + ": " + res.status);
                approveBtn.disabled = false;
                denyBtn.disabled = false;
                approveBtn.textContent = copy.approve;
                return;
              }
              approveBtn.textContent = copy.redirecting;
              window.location.href = data.redirect_to;
            });
          })
          .catch(function() {
            showError(consentError, copy.genericErrorPrefix);
            approveBtn.disabled = false;
            denyBtn.disabled = false;
            approveBtn.textContent = copy.approve;
          });
      });

      var returnUri = new URL(window.location.href);
      returnUri.searchParams.set("locale", uiLocale);
      configureAuthMethods(returnUri.toString(), "signin");
      void tryRefreshSession();
    })();
  </script>
</body>
</html>`;
};
