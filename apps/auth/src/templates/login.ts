const AUTH_FAVICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%20viewBox=%220%200%20512%20512%22%3E%3Crect%20width=%22512%22%20height=%22512%22%20rx=%2296%22%20fill=%22%23232323%22/%3E%3Crect%20x=%22104%22%20y=%2292%22%20width=%22184%22%20height=%22264%22%20rx=%2232%22%20fill=%22%23f8f3ec%22/%3E%3Crect%20x=%22212%22%20y=%22156%22%20width=%22196%22%20height=%22272%22%20rx=%2232%22%20fill=%22%23c44b2d%22/%3E%3C/svg%3E";

/**
 * Login page HTML template. Vanilla HTML + CSS + JS — no React, no bundler.
 * English only. On successful verification, auth service sets session cookies
 * and client JS redirects to redirect_uri.
 */

export const renderLoginPage = (redirectUri: string): string => {
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
      --bg: #ffffff;
      --panel: #ffffff;
      --panel-border: #232323;
      --text: #000000;
      --muted: #898989;
      --accent: #232323;
    }

    * { box-sizing: border-box; }
    *:focus { outline: none; }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
      width: 100%;
    }

    .login-card {
      width: 100%;
      max-width: 360px;
      border: 1px solid var(--panel-border);
      padding: 32px 28px;
      background: var(--panel);
    }

    .login-title {
      margin: 0 0 24px;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: 0.2px;
    }

    .login-label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--muted);
    }

    .login-input {
      display: block;
      width: 100%;
      padding: 8px 10px;
      margin-bottom: 16px;
      border: 1px solid var(--panel-border);
      background: var(--bg);
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
    }

    .login-input:focus {
      border-color: var(--text);
    }

    .login-btn {
      display: block;
      width: 100%;
      padding: 10px;
      border: 1px solid var(--panel-border);
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .login-btn:hover {
      opacity: 0.85;
    }

    .login-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .login-error {
      color: #c0392b;
      font-size: 13px;
      margin-bottom: 12px;
    }

    .login-hint {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 16px;
    }

    .hidden { display: none; }

    @media (max-width: 768px) {
      .login-page { padding: 0; }
      .login-card {
        border: none;
        max-width: none;
        padding: 32px 16px;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">Sign in</h1>

      <div id="step-email">
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
    })();
  </script>
</body>
</html>`;
};
