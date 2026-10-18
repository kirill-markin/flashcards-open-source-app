import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

export const browserGuestCookieName = "__Host-nibomo_guest";
export const browserGuestCookieMaxAgeSeconds = 180 * 24 * 60 * 60;

export function writeBrowserGuestCookie(context: Context, guestToken: string): void {
  setCookie(context, browserGuestCookieName, guestToken, {
    secure: true,
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: browserGuestCookieMaxAgeSeconds,
  });
}

export function clearBrowserGuestCookie(context: Context): void {
  deleteCookie(context, browserGuestCookieName, {
    secure: true,
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
  });
}
