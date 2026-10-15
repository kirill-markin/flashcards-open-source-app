import { getLoginPageLocaleDirection, type LoginPageLocale } from "../routes/browser/loginPageLocale.js";
import type { BrowserLoginCompletion } from "../routes/social/browserCompletion.js";
import { BROWSER_CONTINUATION_COPY } from "./browserContinuationCopy.js";
import { getLoginPageCopy } from "./login.js";
import { browserHintStorageScript } from "./browserHints.js";

export function browserScriptJson(value: object): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function browserHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Both provider callback documents and mailbox JSON responses enter this consumer after acceptance.
export const browserCompletionConsumerScript = `
  ${browserHintStorageScript}
  async function consumeBrowserCompletion(result) {
    if (result === null || typeof result !== "object" || result.ok !== true
      || typeof result.redirectUri !== "string") throw new Error("AUTH_COMPLETION_INVALID");
    if (result.purpose === undefined) {
      if (result.signInHint === null || typeof result.signInHint !== "object"
        || (result.signInHint.method !== "apple" && result.signInHint.method !== "google")
        || typeof result.signInHint.recoveryEmail !== "string") throw new Error("AUTH_COMPLETION_INVALID");
    } else if (result.purpose !== "link" && result.purpose !== "reauth") {
      throw new Error("AUTH_COMPLETION_INVALID");
    }
    if (result.purpose === undefined) await browserHints.acceptOptional(result);
    window.location.replace(result.redirectUri);
  }
`;

export function renderBrowserDocument(
  locale: LoginPageLocale, nonce: string, title: string, body: string, script: string,
): string {
  return `<!doctype html><html lang="${locale}" dir="${getLoginPageLocaleDirection(locale)}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow"><title>${browserHtml(title)}</title>
    <style nonce="${nonce}">
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #000; color: #f6f6f8; line-height: 1.6; }
      main { display: grid; place-items: center; min-height: 100vh; padding: 24px 16px; }
      article { width: 100%; max-width: 420px; padding: 30px; border-radius: 24px; background: #1c1c1e; }
      h1 { line-height: 1.1; font-size: 2rem; margin: 0 0 24px; }
      p { margin: 0 0 16px; }
      label { display: block; margin-bottom: 6px; }
      input, button, .continue { font: inherit; min-height: 44px; width: 100%; border-radius: 10px; padding: 10px 12px; }
      input { margin-bottom: 16px; border: 1px solid #8e8e93; color: inherit; background: #2c2c2e; }
      button, .continue { display: block; border: 0; border-radius: 999px; background: #c44b2d; color: #fff5f2; cursor: pointer; text-align: center; }
      button:disabled { opacity: .5; cursor: default; }
      a { color: #f6f6f8; overflow-wrap: anywhere; }
      :focus-visible { outline: 2px solid #8e8e93; outline-offset: 3px; }
      .hint { color: #b9b9c1; font-size: .875rem; }
      .error { color: #ff858b; overflow-wrap: anywhere; }
      [hidden] { display: none !important; }
    </style></head><body><main><article>${body}</article></main>
    <script nonce="${nonce}">${script}</script></body></html>`;
}

export function renderBrowserCompletion(
  completion: BrowserLoginCompletion, locale: LoginPageLocale, nonce: string,
): string {
  const copy = BROWSER_CONTINUATION_COPY[locale];
  const loginCopy = getLoginPageCopy(locale);
  return renderBrowserDocument(locale, nonce, loginCopy.pageTitle,
    `<h1>${browserHtml(copy.completed)}</h1><a id="auth-continue" class="continue" href="${browserHtml(completion.redirectUri)}">${browserHtml(copy.continue)}</a>`,
    `${browserCompletionConsumerScript}
    const completion = ${browserScriptJson(completion)};
    void consumeBrowserCompletion(completion);`);
}
