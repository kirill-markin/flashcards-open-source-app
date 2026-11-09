/** Explicit rendering, loaded only when the backend asks this browser for the guest check. */
const turnstileScriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const turnstileScriptLoadTimeoutMs = 20 * 1000;
/** The backend verifies the token against this action (`POST /guest-auth/browser/session`). */
export const guestSessionTurnstileAction = "guest_session";

type TurnstileRenderParameters = Readonly<{
  sitekey: string;
  action: string;
  retry: "never";
  callback: (token: string) => void;
  "error-callback": (errorCode: string) => boolean;
}>;

export type TurnstileApi = Readonly<{
  render: (container: HTMLElement, parameters: TurnstileRenderParameters) => string | null | undefined;
  remove: (widgetId: string) => void;
}>;

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileLoad: Promise<TurnstileApi> | null = null;

function appendTurnstileScript(): Promise<TurnstileApi> {
  const script = document.createElement("script");
  script.src = turnstileScriptUrl;
  script.async = true;
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`Cloudflare Turnstile did not load from ${turnstileScriptUrl} within ${turnstileScriptLoadTimeoutMs} ms.`));
    }, turnstileScriptLoadTimeoutMs);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      if (window.turnstile === undefined) reject(new Error(`Cloudflare Turnstile loaded from ${turnstileScriptUrl} without defining window.turnstile.`));
      else resolve(window.turnstile);
    });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error(`Cloudflare Turnstile could not load from ${turnstileScriptUrl}.`));
    });
  });
  document.head.append(script);
  // A failed load leaves nothing cached, so a retry appends a fresh script.
  loading.catch(() => {
    script.remove();
    if (turnstileLoad === loading) turnstileLoad = null;
  });
  return loading;
}

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);
  if (turnstileLoad === null) turnstileLoad = appendTurnstileScript();
  return turnstileLoad;
}
