import { getLoginPageLocaleDirection, type LoginPageLocale } from "../routes/loginPageLocale.js";

const AUTH_FAVICON_URL =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22512%22%20height=%22512%22%20viewBox=%220%200%20512%20512%22%3E%3Crect%20width=%22512%22%20height=%22512%22%20rx=%2296%22%20fill=%22%23232323%22/%3E%3Crect%20x=%22104%22%20y=%2292%22%20width=%22184%22%20height=%22264%22%20rx=%2232%22%20fill=%22%23f8f3ec%22/%3E%3Crect%20x=%22212%22%20y=%22156%22%20width=%22196%22%20height=%22272%22%20rx=%2232%22%20fill=%22%23c44b2d%22/%3E%3C/svg%3E";

type LoginPageCopy = Readonly<{
  pageTitle: string;
  backToWebsite: string;
  signInTitle: string;
  checkingSession: string;
  emailLabel: string;
  sendCode: string;
  sendingCode: string;
  checkEmailForCode: string;
  verificationCodeLabel: string;
  verify: string;
  verifying: string;
  technicalDetails: string;
  genericErrorPrefix: string;
  sendCodeTransportErrorMessage: string;
  verifyCodeTransportErrorMessage: string;
}>;

const LOGIN_PAGE_COPY: Readonly<Record<LoginPageLocale, LoginPageCopy>> = {
  en: {
    pageTitle: "Sign in",
    backToWebsite: "Back to website",
    signInTitle: "Sign in",
    checkingSession: "Checking session...",
    emailLabel: "Email",
    sendCode: "Send code",
    sendingCode: "Sending...",
    checkEmailForCode: "Check your email for an 8-digit code",
    verificationCodeLabel: "Verification code",
    verify: "Verify",
    verifying: "Verifying...",
    technicalDetails: "Technical details",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "We couldn't confirm whether the code request finished. Check your email for a code, then try again if needed.",
    verifyCodeTransportErrorMessage:
      "We couldn't confirm whether sign-in finished. Try the code again, or refresh the page to check whether you're already signed in.",
  },
  ar: {
    pageTitle: "تسجيل الدخول",
    backToWebsite: "العودة إلى الموقع",
    signInTitle: "تسجيل الدخول",
    checkingSession: "جارٍ التحقق من الجلسة...",
    emailLabel: "البريد الإلكتروني",
    sendCode: "إرسال الرمز",
    sendingCode: "جارٍ الإرسال...",
    checkEmailForCode: "تحقق من بريدك الإلكتروني للحصول على رمز مكوّن من 8 أرقام",
    verificationCodeLabel: "رمز التحقق",
    verify: "تحقق",
    verifying: "جارٍ التحقق...",
    technicalDetails: "التفاصيل التقنية",
    genericErrorPrefix: "خطأ",
    sendCodeTransportErrorMessage:
      "لم نتمكن من تأكيد اكتمال طلب الرمز. تحقق من بريدك الإلكتروني بحثًا عن الرمز، ثم حاول مرة أخرى إذا لزم الأمر.",
    verifyCodeTransportErrorMessage:
      "لم نتمكن من تأكيد اكتمال تسجيل الدخول. حاول إدخال الرمز مرة أخرى أو أعد تحميل الصفحة للتحقق مما إذا كنت قد سجلت الدخول بالفعل.",
  },
  "zh-Hans": {
    pageTitle: "登录",
    backToWebsite: "返回网站",
    signInTitle: "登录",
    checkingSession: "正在检查会话...",
    emailLabel: "电子邮件",
    sendCode: "发送验证码",
    sendingCode: "发送中...",
    checkEmailForCode: "请查看电子邮件中的 8 位验证码",
    verificationCodeLabel: "验证码",
    verify: "验证",
    verifying: "验证中...",
    technicalDetails: "技术详情",
    genericErrorPrefix: "错误",
    sendCodeTransportErrorMessage:
      "我们无法确认验证码请求是否已完成。请检查电子邮件中的验证码，如有需要请重试。",
    verifyCodeTransportErrorMessage:
      "我们无法确认登录是否已完成。请再次输入验证码，或刷新页面检查你是否已经登录。",
  },
  de: {
    pageTitle: "Anmelden",
    backToWebsite: "Zur Website zurück",
    signInTitle: "Anmelden",
    checkingSession: "Sitzung wird geprüft...",
    emailLabel: "E-Mail",
    sendCode: "Code senden",
    sendingCode: "Wird gesendet...",
    checkEmailForCode: "Prüfe deine E-Mail auf einen 8-stelligen Code",
    verificationCodeLabel: "Bestätigungscode",
    verify: "Bestätigen",
    verifying: "Wird bestätigt...",
    technicalDetails: "Technische Details",
    genericErrorPrefix: "Fehler",
    sendCodeTransportErrorMessage:
      "Wir konnten nicht bestätigen, ob die Code-Anfrage abgeschlossen wurde. Prüfe deine E-Mails auf einen Code und versuche es bei Bedarf erneut.",
    verifyCodeTransportErrorMessage:
      "Wir konnten nicht bestätigen, ob die Anmeldung abgeschlossen wurde. Versuche den Code erneut oder lade die Seite neu, um zu prüfen, ob du bereits angemeldet bist.",
  },
  hi: {
    pageTitle: "साइन इन",
    backToWebsite: "वेबसाइट पर वापस जाएं",
    signInTitle: "साइन इन",
    checkingSession: "सेशन जांचा जा रहा है...",
    emailLabel: "ईमेल",
    sendCode: "कोड भेजें",
    sendingCode: "भेजा जा रहा है...",
    checkEmailForCode: "8 अंकों का कोड पाने के लिए अपना ईमेल देखें",
    verificationCodeLabel: "सत्यापन कोड",
    verify: "सत्यापित करें",
    verifying: "सत्यापित किया जा रहा है...",
    technicalDetails: "तकनीकी विवरण",
    genericErrorPrefix: "त्रुटि",
    sendCodeTransportErrorMessage:
      "हम पुष्टि नहीं कर सके कि कोड अनुरोध पूरा हुआ या नहीं। कोड के लिए अपना ईमेल देखें, फिर जरूरत हो तो दोबारा कोशिश करें।",
    verifyCodeTransportErrorMessage:
      "हम पुष्टि नहीं कर सके कि साइन-इन पूरा हुआ या नहीं। कोड फिर से आजमाएं, या यह देखने के लिए पेज रीफ्रेश करें कि क्या आप पहले से साइन इन हैं।",
  },
  ja: {
    pageTitle: "サインイン",
    backToWebsite: "Webサイトに戻る",
    signInTitle: "サインイン",
    checkingSession: "セッションを確認しています...",
    emailLabel: "メールアドレス",
    sendCode: "コードを送信",
    sendingCode: "送信中...",
    checkEmailForCode: "メールで 8 桁のコードを確認してください",
    verificationCodeLabel: "確認コード",
    verify: "確認",
    verifying: "確認中...",
    technicalDetails: "技術的な詳細",
    genericErrorPrefix: "エラー",
    sendCodeTransportErrorMessage:
      "コード送信リクエストが完了したか確認できませんでした。メールでコードを確認し、必要に応じてもう一度お試しください。",
    verifyCodeTransportErrorMessage:
      "サインインが完了したか確認できませんでした。コードをもう一度試すか、ページを再読み込みして、すでにサインイン済みか確認してください。",
  },
  ru: {
    pageTitle: "Войти",
    backToWebsite: "Вернуться на сайт",
    signInTitle: "Войти",
    checkingSession: "Проверяем сеанс...",
    emailLabel: "Электронная почта",
    sendCode: "Отправить код",
    sendingCode: "Отправка...",
    checkEmailForCode: "Проверьте почту: там есть 8-значный код",
    verificationCodeLabel: "Код подтверждения",
    verify: "Подтвердить",
    verifying: "Проверка...",
    technicalDetails: "Технические детали",
    genericErrorPrefix: "Ошибка",
    sendCodeTransportErrorMessage:
      "Мы не смогли подтвердить, завершился ли запрос кода. Проверьте почту на наличие кода и при необходимости попробуйте еще раз.",
    verifyCodeTransportErrorMessage:
      "Мы не смогли подтвердить, завершился ли вход. Попробуйте ввести код еще раз или обновите страницу, чтобы проверить, вошли ли вы уже в систему.",
  },
  "es-MX": {
    pageTitle: "Iniciar sesión",
    backToWebsite: "Volver al sitio web",
    signInTitle: "Iniciar sesión",
    checkingSession: "Comprobando sesión...",
    emailLabel: "Correo electrónico",
    sendCode: "Enviar código",
    sendingCode: "Enviando...",
    checkEmailForCode: "Revisa tu correo para encontrar un código de 8 dígitos",
    verificationCodeLabel: "Código de verificación",
    verify: "Verificar",
    verifying: "Verificando...",
    technicalDetails: "Detalles técnicos",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "No pudimos confirmar si la solicitud del código terminó. Revisa tu correo para encontrar un código y vuelve a intentarlo si hace falta.",
    verifyCodeTransportErrorMessage:
      "No pudimos confirmar si el inicio de sesión terminó. Intenta usar el código otra vez o recarga la página para comprobar si ya iniciaste sesión.",
  },
  "es-ES": {
    pageTitle: "Iniciar sesión",
    backToWebsite: "Volver al sitio web",
    signInTitle: "Iniciar sesión",
    checkingSession: "Comprobando la sesión...",
    emailLabel: "Correo electrónico",
    sendCode: "Enviar código",
    sendingCode: "Enviando...",
    checkEmailForCode: "Revisa tu correo para encontrar un código de 8 dígitos",
    verificationCodeLabel: "Código de verificación",
    verify: "Verificar",
    verifying: "Verificando...",
    technicalDetails: "Detalles técnicos",
    genericErrorPrefix: "Error",
    sendCodeTransportErrorMessage:
      "No pudimos confirmar si la solicitud del código terminó. Revisa tu correo para encontrar un código y vuelve a intentarlo si hace falta.",
    verifyCodeTransportErrorMessage:
      "No pudimos confirmar si el inicio de sesión terminó. Intenta usar el código otra vez o recarga la página para comprobar si ya has iniciado sesión.",
  },
};

/**
 * Login page HTML template. Vanilla HTML + CSS + JS — no React, no bundler.
 * On successful verification, auth service sets session cookies
 * and client JS redirects to redirect_uri.
 */

export const renderLoginPage = (redirectUri: string, websiteHomeUrl: string, locale: LoginPageLocale): string => {
  const copy = LOGIN_PAGE_COPY[locale];
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

    .login-error-message {
      margin: 0;
    }

    .login-error-details {
      margin-top: 8px;
    }

    .login-error-summary {
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      user-select: none;
    }

    .login-error-detail-text {
      margin: 8px 0 0;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-secondary);
      font-family:
        ui-monospace,
        "SFMono-Regular",
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        "Liberation Mono",
        "Courier New",
        monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
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
    <a class="login-back-link" href="${websiteHomeUrl}">${copy.backToWebsite}</a>
    <div class="login-card">
      <h1 class="login-title">${copy.signInTitle}</h1>

      <div id="step-checking">
        <p class="login-status">${copy.checkingSession}</p>
      </div>

      <div id="step-email" class="hidden">
        <label class="login-label" for="login-email">${copy.emailLabel}</label>
        <input id="login-email" class="login-input" type="email" autocomplete="email" autofocus>
        <div id="email-error" class="login-error hidden"></div>
        <button id="send-btn" class="login-btn" type="button">${copy.sendCode}</button>
      </div>

      <div id="step-otp" class="hidden">
        <p class="login-hint">${copy.checkEmailForCode}</p>
        <label class="login-label" for="login-otp">${copy.verificationCodeLabel}</label>
        <input id="login-otp" class="login-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8">
        <div id="otp-error" class="login-error hidden"></div>
        <button id="verify-btn" class="login-btn" type="button">${copy.verify}</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      var redirectUri = ${JSON.stringify(redirectUri)};
      var copy = ${JSON.stringify(copy)};

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
        el.textContent = "";
        el.textContent = msg;
        el.classList.remove("hidden");
      }

      function showErrorWithDetails(el, msg, detailsText) {
        var message = document.createElement("p");
        message.className = "login-error-message";
        message.textContent = msg;

        var details = document.createElement("details");
        details.className = "login-error-details";

        var summary = document.createElement("summary");
        summary.className = "login-error-summary";
        summary.textContent = copy.technicalDetails;

        var technicalText = document.createElement("pre");
        technicalText.className = "login-error-detail-text";
        technicalText.textContent = detailsText;

        details.appendChild(summary);
        details.appendChild(technicalText);

        el.textContent = "";
        el.appendChild(message);
        el.appendChild(details);
        el.classList.remove("hidden");
      }

      function getTechnicalErrorDetails(err) {
        if (err && typeof err === "object") {
          var errorName = typeof err.name === "string" ? err.name : "";
          var errorMessage = typeof err.message === "string" ? err.message : "";

          if (errorName !== "" && errorMessage !== "") {
            return errorName + ": " + errorMessage;
          }

          if (errorMessage !== "") {
            return errorMessage;
          }
        }

        return String(err);
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
        sendBtn.textContent = copy.sendingCode;

        fetch("api/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email: email }),
        })
          .then(function(res) {
            return res.json().then(function(data) {
              if (!res.ok) {
                showError(emailError, data.error || copy.genericErrorPrefix + ": " + res.status);
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
            showErrorWithDetails(
              emailError,
              copy.sendCodeTransportErrorMessage,
              getTechnicalErrorDetails(err),
            );
          })
          .finally(function() {
            sendBtn.disabled = false;
            sendBtn.textContent = copy.sendCode;
          });
      });

      verifyBtn.addEventListener("click", function() {
        var code = otpInput.value.trim();
        if (code.length !== 8) return;

        hideError(otpError);
        verifyBtn.disabled = true;
        verifyBtn.textContent = copy.verifying;

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
                showError(otpError, data.error || copy.genericErrorPrefix + ": " + res.status);
                return;
              }
              // Cookies set by server response — redirect to app
              window.location.href = redirectUri;
            });
          })
          .catch(function(err) {
            showErrorWithDetails(
              otpError,
              copy.verifyCodeTransportErrorMessage,
              getTechnicalErrorDetails(err),
            );
          })
          .finally(function() {
            verifyBtn.disabled = false;
            verifyBtn.textContent = copy.verify;
          });
      });

      void tryRefreshSession();
    })();
  </script>
</body>
</html>`;
};
