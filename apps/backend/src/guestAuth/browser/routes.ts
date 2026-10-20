import { Hono } from "hono";
import { authenticateRequest } from "../../auth";
import {
  enforceAllowedBrowserOrigin,
  enforceGuestCookieCsrfProtection,
  enforceSessionCsrfProtection,
  extractRequestAuthInputs,
  getSessionCsrfToken,
  type RequestAuthInputs,
} from "../../auth/requestSecurity";
import { isSelfDeclaredCrawlerUserAgent } from "../../productAnalytics/automatedClient";
import type { AppEnv } from "../../server/app";
import { expectBoolean, expectRecord, parseJsonBody } from "../../server/requestParsing";
import { HttpError } from "../../shared/errors";
import { parseGuestSessionIdempotencyKeyValue } from "../session/idempotencyKey";
import { clearBrowserGuestCookie, writeBrowserGuestCookie } from "./cookie";
import { createBrowserGuestUpgradeRoutes } from "./upgrade";
import {
  createBrowserGuestSession,
  forgetBrowserGuestSession,
  loadBrowserGuestSession,
  type BrowserGuestSession,
} from "./session";

type BrowserGuestRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  sessionCreationPath: string;
}>;

async function probeRegisteredSession(inputs: RequestAuthInputs): Promise<Readonly<{
  present: boolean;
  csrfToken: string | null;
}>> {
  if (inputs.authorizationHeader !== undefined) {
    throw new HttpError(400, "Browser guest lifecycle requests require cookies.", "BROWSER_AUTH_COOKIE_REQUIRED");
  }
  if (inputs.sessionToken === undefined) {
    return { present: false, csrfToken: null };
  }
  const auth = await authenticateRequest({
    authorizationHeader: undefined,
    sessionToken: inputs.sessionToken,
  });
  if (auth.transport !== "session") {
    throw new HttpError(401, "Sign in again to validate the registered browser session.", "BROWSER_SESSION_REQUIRED");
  }
  return { present: true, csrfToken: await getSessionCsrfToken(inputs.sessionToken) };
}

async function createGuestEnvelope(
  session: BrowserGuestSession,
  guestToken: string | undefined,
  cookieRoundTripVerified: boolean,
): Promise<BrowserGuestSession & Readonly<{
  csrfToken: string | null;
  cookieRoundTripVerified: boolean;
}>> {
  return {
    ...session,
    csrfToken: guestToken === undefined ? null : await getSessionCsrfToken(guestToken),
    cookieRoundTripVerified,
  };
}

export function createBrowserGuestAuthRoutes(options: BrowserGuestRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("/guest-auth/browser/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("Pragma", "no-cache");
    await next();
  });

  app.route("/", createBrowserGuestUpgradeRoutes(options.allowedOrigins));

  app.get("/guest-auth/browser/session", async (context) => {
    const inputs = extractRequestAuthInputs(context.req.raw);
    enforceAllowedBrowserOrigin(inputs, options.allowedOrigins, "Origin is not allowed for browser guest probe");
    const registeredSession = await probeRegisteredSession(inputs);
    const guestSession = await loadBrowserGuestSession(inputs.guestSessionToken);
    if (inputs.guestSessionToken !== undefined
        && (guestSession.status === "active" || guestSession.status === "pending_upgrade")) {
      writeBrowserGuestCookie(context, inputs.guestSessionToken);
    }
    return context.json({
      registeredSession,
      guestSession: await createGuestEnvelope(guestSession, inputs.guestSessionToken,
        guestSession.status === "active" || guestSession.status === "pending_upgrade"),
    });
  });

  app.post("/guest-auth/browser/session", async (context) => {
    // Only the adapter's event identifies the throttled Gateway method, regardless of URL prefixes.
    const gatewayEvent = context.env?.event;
    const allowedCreationIngress = gatewayEvent === undefined
      ? new URL(context.req.url).pathname === options.sessionCreationPath
      : "resource" in gatewayEvent
        && gatewayEvent.resource === "/guest-auth/browser/session"
        && gatewayEvent.httpMethod === "POST"
        && gatewayEvent.requestContext.resourcePath === "/guest-auth/browser/session"
        && gatewayEvent.requestContext.httpMethod === "POST";
    if (!allowedCreationIngress) {
      throw new HttpError(404, "Not found");
    }
    const inputs = extractRequestAuthInputs(context.req.raw);
    enforceAllowedBrowserOrigin(inputs, options.allowedOrigins, "Origin is not allowed for browser guest creation");
    const registeredSession = await probeRegisteredSession(inputs);
    if (inputs.guestSessionToken !== undefined) {
      await enforceGuestCookieCsrfProtection(context.req.method, inputs, options.allowedOrigins);
    } else if (registeredSession.present) {
      await enforceSessionCsrfProtection(context.req.method, inputs, options.allowedOrigins);
    }
    const guestSession = await loadBrowserGuestSession(inputs.guestSessionToken);
    if (guestSession.status === "invalid" || guestSession.status === "revoked") {
      throw new HttpError(409, "The browser guest credential cannot be resumed. Recover local ownership before explicitly forgetting it.", "GUEST_BROWSER_RECOVERY_REQUIRED");
    }
    if (registeredSession.present || guestSession.status === "pending_upgrade") {
      throw new HttpError(409, "Finish browser guest conversion with the signed-in account before creating a guest.", "GUEST_BROWSER_UPGRADE_REQUIRED");
    }
    if (guestSession.status === "active" && inputs.guestSessionToken !== undefined) {
      writeBrowserGuestCookie(context, inputs.guestSessionToken);
      return context.json({
        registeredSession,
        guestSession: await createGuestEnvelope(guestSession, inputs.guestSessionToken, true),
      });
    }

    if (isSelfDeclaredCrawlerUserAgent(context.req.header("user-agent") ?? null)) {
      throw new HttpError(403, "Crawlers cannot create browser guest accounts. Open the app in a regular browser, or use the agent API for automated access.", "GUEST_BROWSER_CRAWLER_REFUSED");
    }
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const hasLocalOwnership = expectBoolean(body.hasLocalOwnership, "hasLocalOwnership");
    if (hasLocalOwnership) {
      throw new HttpError(409, "The guest cookie is missing while this browser owns local data. Recover that credential before continuing.", "GUEST_BROWSER_RECOVERY_REQUIRED");
    }
    const idempotencyKey = parseGuestSessionIdempotencyKeyValue(body.idempotencyKey);
    if (idempotencyKey === null) {
      throw new HttpError(400, "A random per-attempt idempotencyKey is required.", "GUEST_SESSION_IDEMPOTENCY_KEY_INVALID");
    }
    const created = await createBrowserGuestSession(idempotencyKey);
    const createdSession = await loadBrowserGuestSession(created.guestToken);
    if (createdSession.status !== "active") {
      throw new HttpError(409, "The created guest session cannot be resumed.", "GUEST_BROWSER_RECOVERY_REQUIRED");
    }
    writeBrowserGuestCookie(context, created.guestToken);
    return context.json({
      registeredSession,
      guestSession: await createGuestEnvelope(createdSession, created.guestToken, false),
    });
  });

  app.post("/guest-auth/browser/session/forget", async (context) => {
    const inputs = extractRequestAuthInputs(context.req.raw);
    enforceAllowedBrowserOrigin(inputs, options.allowedOrigins, "Origin is not allowed for browser guest retirement");
    const registeredSession = await probeRegisteredSession(inputs);
    if (inputs.guestSessionToken !== undefined) {
      await enforceGuestCookieCsrfProtection(context.req.method, inputs, options.allowedOrigins);
    } else if (registeredSession.present) {
      await enforceSessionCsrfProtection(context.req.method, inputs, options.allowedOrigins);
    }
    await forgetBrowserGuestSession(inputs.guestSessionToken);
    clearBrowserGuestCookie(context);
    return context.json({ ok: true });
  });

  return app;
}
