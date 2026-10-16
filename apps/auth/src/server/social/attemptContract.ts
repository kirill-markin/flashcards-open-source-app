import type { IdentityProvider } from "./identityStore.js";
import type { SocialClient } from "./providers.js";

export type AuthPurpose = "login" | "link" | "reauth";
export type AuthAttemptErrorCode = "AUTH_ATTEMPT_INVALID" | "AUTH_ATTEMPT_RESTART_REQUIRED"
  | "AUTH_COMPLETION_INVALID" | "AUTH_RATE_LIMITED";
export class AuthAttemptError extends Error {
  constructor(readonly code: AuthAttemptErrorCode) {
    super(code);
    this.name = "AuthAttemptError";
  }
}

export type AuthAttemptRequest = Readonly<{
  provider: IdentityProvider;
  client: SocialClient;
  purpose: AuthPurpose;
  codeChallenge: string | null;
}>;
export type EmailAuthAttemptRequest = Readonly<{
  method: "email";
  client: SocialClient;
  purpose: "reauth";
  codeChallenge: string | null;
}>;
export type EmailAuthAttemptResponse = Readonly<{ attempt: string; expiresAt: string; email: string }>;
export type AuthAttemptResponse = Readonly<{
  attempt: string;
  nonce: string;
  expiresAt: string;
  redirectUri: string | null;
  providerCodeChallenge: string;
}>;
export type AuthProviderSubmission =
  | Readonly<{ provider: "google"; identityToken: string; authorizationCode: null }>
  | Readonly<{ provider: "google"; identityToken: null; authorizationCode: string }>
  | Readonly<{ provider: "apple"; identityToken: string | null; authorizationCode: string }>;
export type AuthAttemptBinding =
  | Readonly<{ client: "web"; purpose: AuthPurpose; origin: string; browserSecret: string }>
  | Readonly<{ client: Exclude<SocialClient, "web">; purpose: AuthPurpose; codeVerifier: string }>;
export type AuthReauthenticationBinding = AuthAttemptBinding & Readonly<{ purpose: "reauth" }>;
export type AuthCurrentAccount =
  | Readonly<{ purpose: "login"; subject: null; account: null; reauthCompletion: null }>
  | Readonly<{ purpose: "reauth"; subject: string; account: string; reauthCompletion: null }>
  | Readonly<{ purpose: "link"; subject: string; account: string; reauthCompletion: string; reauthBinding: AuthReauthenticationBinding }>;
export type AuthCompletionResponse = Readonly<{ completion: string; expiresAt: string }>;
export type AuthCompletionResult = Readonly<{
  cognitoSubject: string;
  cognitoUsername: string;
  currentSubject: string | null;
  currentAccount: string | null;
  purpose: AuthPurpose;
}>;

export function requireAuthHandle(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
}
