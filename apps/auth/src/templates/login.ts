const AUTH_FAVICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%20viewBox=%220%200%20512%20512%22%3E%3Crect%20width=%22512%22%20height=%22512%22%20rx=%2296%22%20fill=%22%23232323%22/%3E%3Crect%20x=%22104%22%20y=%2292%22%20width=%22184%22%20height=%22264%22%20rx=%2232%22%20fill=%22%23f8f3ec%22/%3E%3Crect%20x=%22212%22%20y=%22156%22%20width=%22196%22%20height=%22272%22%20rx=%2232%22%20fill=%22%23c44b2d%22/%3E%3C/svg%3E";

/**
 * Login page HTML template. Vanilla HTML + CSS + JS — no React, no bundler.
 * English only. On successful verification, auth service sets session cookies
 * and client JS redirects to redirect_uri.
 */

export const renderLoginPage = (redirectUri: string, websiteHomeUrl: string): string => {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="${AUTH_FAVICON_URL}">
  <title>Sign in</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050505;
      --surface: linear-gradient(180deg, rgba(24, 24, 30, 0.94), rgba(17, 17, 22, 0.98));
      --surface-elevated: linear-gradient(180deg, rgba(30, 30, 36, 0.96), rgba(18, 18, 22, 0.98));
      --surface-muted: rgba(255, 255, 255, 0.04);
      --text: #f6f6f8;
      --text-secondary: rgba(235, 235, 245, 0.66);
      --accent: #c44b2d;
      --accent-strong: #d65a38;
      --border: rgba(255, 255, 255, 0.1);
      --border-strong: rgba(255, 255, 255, 0.16);
      --danger: #ff4d57;
      --shadow-soft: 0 12px 30px rgba(0, 0, 0, 0.26);
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-xl: 24px;
      --radius-pill: 999px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
    }

    html {
      background:
        radial-gradient(circle at top, rgba(196, 75, 45, 0.12), transparent 34%),
        radial-gradient(circle at bottom left, rgba(255, 255, 255, 0.05), transparent 26%),
        var(--bg);
    }

    body {
      background: transparent;
      color: var(--text);
      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "SF Pro Display",
        "SF Pro Text",
        system-ui,
        sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    ::selection {
      background: rgba(196, 75, 45, 0.34);
      color: var(--text);
    }

    .login-page {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 24px 16px;
      width: 100%;
    }

    .login-back-link {
      position: absolute;
      top: 18px;
      inset-inline-start: 18px;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding-inline: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 560;
      letter-spacing: -0.01em;
      text-decoration: none;
      transition:
        background 140ms ease,
        border-color 140ms ease,
        color 140ms ease,
        transform 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .login-back-link:hover {
        border-color: var(--border-strong);
        background: rgba(255, 255, 255, 0.08);
        color: var(--text);
        transform: translateY(-1px);
      }
    }

    .login-back-link:focus-visible {
      outline: 2px solid rgba(196, 75, 45, 0.72);
      outline-offset: 3px;
    }

    .login-card {
      width: 100%;
      max-width: 420px;
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      padding: 30px;
      background: var(--surface);
      box-shadow: var(--shadow-soft);
    }

    .login-title {
      margin: 0 0 24px;
      font-size: clamp(2rem, 4vw, 2.4rem);
      font-weight: 760;
      line-height: 0.96;
      letter-spacing: -0.055em;
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
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-muted);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      transition:
        border-color 140ms ease,
        background 140ms ease,
        box-shadow 140ms ease;
    }

    .login-input::placeholder {
      color: rgba(235, 235, 245, 0.45);
    }

    .login-input:focus-visible {
      outline: none;
      border-color: var(--border-strong);
      background: rgba(255, 255, 255, 0.06);
      box-shadow: 0 0 0 3px rgba(196, 75, 45, 0.18);
    }

    .login-btn {
      display: block;
      width: 100%;
      min-height: 44px;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: var(--radius-pill);
      background: var(--accent);
      color: #fff5f2;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
      transition:
        transform 140ms ease,
        background 140ms ease,
        opacity 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .login-btn:hover {
        background: var(--accent-strong);
        transform: translateY(-1px);
      }
    }

    .login-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .login-error {
      color: var(--danger);
      font-size: 13px;
      margin-bottom: 12px;
    }

    .login-hint {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0 0 16px;
    }

    .login-status {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;
    }

    .hidden { display: none; }

    @media (max-width: 768px) {
      .login-page {
        padding: 18px 14px;
      }

      .login-back-link {
        top: 14px;
        inset-inline-start: 14px;
      }

      .login-card {
        max-width: 100%;
        border-radius: var(--radius-md);
        padding: 24px 18px;
      }
    }
  </style>
</head>
<body>
  <div class="login-page">
    <a class="login-back-link" href="${websiteHomeUrl}">Back to website</a>
    <div class="login-card">
      <h1 class="login-title">Sign in</h1>

      <div id="step-checking">
        <p class="login-status">Checking session...</p>
      </div>

      <div id="step-email" class="hidden">
        <label class="login-label" for="login-email">Email</label>
        <input id="login-email" class="login-input" type="email" autocomplete="email" autofocus>
        <div id="email-error" class="login-error hidden"></div>
        <button id="send-btn" class="login-btn" type="button">Send code</button>
      </div>

      <div id="step-otp" class="hidden">
        <p class="login-hint">Check your email for an 8-digit code</p>
        <label class="login-label" for="login-otp">Verification code</label>
        <input id="login-otp" class="login-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8">
        <div id="otp-error" class="login-error hidden"></div>
        <button id="verify-btn" class="login-btn" type="button">Verify</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var redirectUri = ${JSON.stringify(redirectUri)};

      var csrfToken = "";

      var emailInput = document.getElementById("login-email");
      var otpInput = document.getElementById("login-otp");
      var sendBtn = document.getElementById("send-btn");
      var verifyBtn = document.getElementById("verify-btn");
      var stepChecking = document.getElementById("step-checking");
      var stepEmail = document.getElementById("step-email");
      var stepOtp = document.getElementById("step-otp");
      var emailError = document.getElementById("email-error");
      var otpError = document.getElementById("otp-error");

      function showError(el, msg) {
        el.textContent = msg;
        el.classList.remove("hidden");
      }

      function hideError(el) {
        el.classList.add("hidden");
        el.textContent = "";
      }

      function showEmailStep() {
        stepChecking.classList.add("hidden");
        stepOtp.classList.add("hidden");
        stepEmail.classList.remove("hidden");
        emailInput.focus();
      }

      function tryRefreshSession() {
        return fetch("api/refresh-session", {
          method: "POST",
          credentials: "same-origin",
        }).then(function(res) {
          if (res.ok) {
            window.location.href = redirectUri;
            return;
          }

          showEmailStep();
        }).catch(function() {
          showEmailStep();
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

      sendBtn.addEventListener("click", function() {
        var email = emailInput.value.trim();
        if (!email) return;

        hideError(emailError);
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending\u2026";

        fetch("api/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email: email }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                showError(emailError, data.error || "Error: " + res.status);
                return;
              }
              if (
                typeof data.idToken === "string" && data.idToken !== ""
                && typeof data.refreshToken === "string" && data.refreshToken !== ""
              ) {
                // Review/demo emails can complete sign-in immediately.
                window.location.href = redirectUri;
                return;
              }
              csrfToken = data.csrfToken || "";
              stepEmail.classList.add("hidden");
              stepOtp.classList.remove("hidden");
              otpInput.focus();
            });
          })
          .catch(function(err) {
            showError(emailError, err.message || String(err));
          })
          .finally(function() {
            sendBtn.disabled = false;
            sendBtn.textContent = "Send code";
          });
      });

      verifyBtn.addEventListener("click", function() {
        var code = otpInput.value.trim();
        if (code.length !== 8) return;

        hideError(otpError);
        verifyBtn.disabled = true;
        verifyBtn.textContent = "Verifying\u2026";

        fetch("api/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            code: code,
            csrfToken: csrfToken,
          }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                showError(otpError, data.error || "Error: " + res.status);
                return;
              }
              // Cookies set by server response — redirect to app
              window.location.href = redirectUri;
            });
          })
          .catch(function(err) {
            showError(otpError, err.message || String(err));
          })
          .finally(function() {
            verifyBtn.disabled = false;
            verifyBtn.textContent = "Verify";
          });
      });

      void tryRefreshSession();
    })();
  </script>
</body>
</html>`;
};
