import { getAppleSignInConfig, getGoogleSignInConfig } from "./config.js";
import { socialAuthOrigins, SocialProofError, type SocialClient } from "./providers.js";
import type { IdentityProvider } from "./identityStore.js";
import { androidAppleReturnUri } from "./browserState.js";

export type ProviderAvailability =
  | Readonly<{ available: false }>
  | Readonly<{ available: true; transport: "native"; audience: string; presenterClientIds: ReadonlyArray<string>; nonce: "raw" | "sha256-lowercase-hex" }>
  | Readonly<{ available: true; transport: "browser"; audience: string; start: string; callback: string;
    callbackMethod: "GET" | "POST"; nativeReturnUri: string | null; nonce: "raw" | "sha256-lowercase-hex" }>;
export type PublicAuthMethods = Readonly<{
  client: SocialClient;
  authOrigins: ReadonlyArray<string>;
  methods: Readonly<{
    email: Readonly<{ available: true; transport: "email_otp" }>;
    apple: ProviderAvailability;
    google: ProviderAvailability;
  }>;
  endpoints: Readonly<{ attempt: string; complete: string; browserComplete: string; sendCode: string; verifyCode: string }>;
  account: Readonly<{ methods: string; providerMethod: string; unlink: string; emailReauth: string;
    nativeAttempt: string; nativeComplete: string; freshProofSeconds: 120; emailRecovery: "read_only" }>;
  completion: Readonly<{ codeChallengeMethod: "S256"; tokenEnvelope: "TokenResult"; productAccountProvisioned: false }>;
}>;

export function getPublicAuthMethods(client: SocialClient): PublicAuthMethods {
  const apple = getAppleSignInConfig();
  const google = getGoogleSignInConfig();
  const nativeApple = apple !== null && client !== "web" && client !== "android";
  const appleClient = apple === null ? null
    : client === "ios-development" || client === "macos-development" ? apple.iosDevelopmentClientId : apple.iosClientId;
  const googlePresenters = google === null ? [] : client === "android" ? google.androidClientIds
    : client === "ios-development" || client === "macos-development" ? [google.iosDevelopmentClientId] : [google.iosClientId];
  return {
    client, authOrigins: socialAuthOrigins,
    methods: {
      email: { available: true, transport: "email_otp" },
      apple: nativeApple && appleClient !== null
        ? { available: true, transport: "native", audience: appleClient, presenterClientIds: [appleClient], nonce: "sha256-lowercase-hex" }
        : apple !== null ? { available: true, transport: "browser", audience: apple.serviceId,
          start: "/api/social/apple/start", callback: "/api/social/apple/callback", callbackMethod: "POST",
          nativeReturnUri: client === "android" ? androidAppleReturnUri : null, nonce: "sha256-lowercase-hex" } : { available: false },
      google: google !== null && client !== "web"
        ? { available: true, transport: "native", audience: google.serverClientId, presenterClientIds: googlePresenters, nonce: "raw" }
        : google !== null ? { available: true, transport: "browser", audience: google.serverClientId,
          start: "/api/social/google/start", callback: "/api/social/google/callback", callbackMethod: "GET",
          nativeReturnUri: null, nonce: "raw" } : { available: false },
    },
    endpoints: { attempt: "/api/social/attempt", complete: "/api/social/complete", browserComplete: "/api/social/browser/complete",
      sendCode: "/api/send-code", verifyCode: "/api/verify-code" },
    account: { methods: "/api/account/login-methods", providerMethod: "/api/account/provider-methods/link",
      unlink: "/api/account/provider-methods/unlink", emailReauth: "/api/account/reauth/email",
      nativeAttempt: "/api/social/attempt", nativeComplete: "/api/social/complete", freshProofSeconds: 120, emailRecovery: "read_only" },
    completion: { codeChallengeMethod: "S256", tokenEnvelope: "TokenResult", productAccountProvisioned: false },
  };
}

export function requireNativeProvider(provider: IdentityProvider, client: SocialClient): void {
  const method = getPublicAuthMethods(client).methods[provider];
  if (!method.available || method.transport !== "native") throw new SocialProofError("PROVIDER_UNAVAILABLE");
}

export function requireSignInProvider(provider: IdentityProvider, client: SocialClient): void {
  if (!getPublicAuthMethods(client).methods[provider].available) throw new SocialProofError("PROVIDER_UNAVAILABLE");
}
