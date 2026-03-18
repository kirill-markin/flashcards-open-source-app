/**
 * Password sign-in endpoint for native clients. Keeps OTP as the primary path,
 * but allows a secondary email + password sign-in route for provisioned users.
 */
import { Hono } from "hono";
import { type AuthAppEnv, getRequestId, jsonAuthError } from "../server/apiErrors.js";
import { setBrowserSessionCookies } from "../server/browserSession.js";
import { log } from "../server/logger.js";
import { signInWithPassword, type TokenResult } from "../server/cognitoAuth.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignInPasswordDependencies = Readonly<{
  signInWithPassword: (email: string, password: string) => Promise<TokenResult>;
  setBrowserSessionCookies: (context: Parameters<typeof setBrowserSessionCookies>[0], sessionToken: string, refreshToken: string) => void;
}>;

function isRejectedPasswordSignIn(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const cognitoType = error instanceof Error && "cognitoType" in error && typeof error.cognitoType === "string"
    ? error.cognitoType.toLowerCase()
    : "";

  return (
    cognitoType.includes("notauthorizedexception")
    || cognitoType.includes("usernotfoundexception")
    || cognitoType.includes("userdisabledexception")
    || cognitoType.includes("passwordresetrequiredexception")
    || message.includes("incorrect username or password")
    || message.includes("user does not exist")
    || message.includes("password reset required")
    || message.includes("user is disabled")
  );
}

export function createSignInPasswordApp(dependencies: SignInPasswordDependencies): Hono<AuthAppEnv> {
  const app = new Hono<AuthAppEnv>();

  app.post("/api/sign-in-password", async (c) => {
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json<{ email?: string; password?: string }>();
    } catch {
      return jsonAuthError(c, 400, "INVALID_REQUEST", "Invalid request.");
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 256) {
      return jsonAuthError(c, 400, "INVALID_EMAIL", "Enter a valid email address.");
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (password.trim() === "") {
      return jsonAuthError(c, 400, "PASSWORD_REQUIRED", "Enter your password.");
    }

    const requestId = getRequestId(c);
    try {
      const tokens = await dependencies.signInWithPassword(email, password);
      dependencies.setBrowserSessionCookies(c, tokens.idToken, tokens.refreshToken);
      return c.json({
        ok: true,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      });
    } catch (error) {
      if (isRejectedPasswordSignIn(error)) {
        return jsonAuthError(c, 401, "PASSWORD_SIGN_IN_FAILED", "Email or password is incorrect.");
      }

      log({
        domain: "auth",
        action: "sign_in_password_error",
        requestId,
        route: c.req.path,
        statusCode: 500,
        code: "PASSWORD_SIGN_IN_FAILED",
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonAuthError(c, 500, "PASSWORD_SIGN_IN_FAILED", "Password sign-in failed. Try again.");
    }
  });

  return app;
}

const app = createSignInPasswordApp({
  signInWithPassword,
  setBrowserSessionCookies,
});

export default app;
