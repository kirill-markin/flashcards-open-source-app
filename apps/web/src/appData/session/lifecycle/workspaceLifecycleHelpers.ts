export const resumeRetryDelayMs: number = 750;
export const resumeRetryCount: number = 2;

const sessionAccountSwitchErrorName = "SessionAccountSwitchError";

export type SessionAccountSwitchError = Error & Readonly<{
  name: typeof sessionAccountSwitchErrorName;
}>;

export function consumeLoggedOutMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("logged_out") !== "1") {
    return false;
  }

  url.searchParams.delete("logged_out");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
  return true;
}

export function createSessionAccountSwitchError(errorMessage: string): SessionAccountSwitchError {
  const error = new Error(errorMessage);
  error.name = sessionAccountSwitchErrorName;
  return error as SessionAccountSwitchError;
}

export function isSessionAccountSwitchError(error: unknown): error is SessionAccountSwitchError {
  return error instanceof Error && error.name === sessionAccountSwitchErrorName;
}

export function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
