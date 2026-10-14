import { JwtVerifier } from "aws-jwt-verify";
import { getGoogleSignInConfig, loadGoogleSignInSecret, type GoogleSignInConfig } from "./config.js";
import {
  assertProviderCallback, parseProviderObject, postProviderForm, providerJwksCache, readProviderEmail,
  rejectProviderProof, SocialProofError, validateProofInput, validateProviderClaims,
  type SocialClient, type VerifiedProviderIdentity,
} from "./providers.js";

function createGoogleVerifier(config: GoogleSignInConfig) {
  return JwtVerifier.create(["https://accounts.google.com", "accounts.google.com"].map((issuer) => ({
    issuer, audience: config.serverClientId, jwksUri: "https://www.googleapis.com/oauth2/v3/certs", graceSeconds: 0,
    customJwtCheck: ({ header }: { header: { alg?: string } }) => {
      if (header.alg !== "RS256") throw new SocialProofError("PROVIDER_PROOF_INVALID");
    },
  })), { jwksCache: providerJwksCache });
}
const verifiers = new Map<string, ReturnType<typeof createGoogleVerifier>>();

function googlePresenters(config: GoogleSignInConfig, client: SocialClient): ReadonlyArray<string> {
  switch (client) {
    case "web": return [config.serverClientId];
    case "android": return config.androidClientIds;
    case "ios": case "macos": return [config.iosClientId];
    case "ios-development": case "macos-development": return [config.iosDevelopmentClientId];
  }
}

/** Caller supplies the client and nonce from its one-use server attempt, never from proof fields. */
export async function verifyGoogleIdentityToken(
  token: string, rawNonce: string, client: SocialClient,
): Promise<VerifiedProviderIdentity> {
  const config = getGoogleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  validateProofInput(token, rawNonce);
  let verifier = verifiers.get(config.serverClientId);
  if (verifier === undefined) {
    verifier = createGoogleVerifier(config);
    verifiers.set(config.serverClientId, verifier);
  }
  try {
    const payload = await verifier.verify(token);
    const subject = validateProviderClaims(payload, rawNonce, config.serverClientId);
    const presenters = googlePresenters(config, client);
    // Google documents azp as optional. Hybrid native proofs must identify their native presenter.
    if ((client !== "web" || payload.azp !== undefined)
      && (typeof payload.azp !== "string" || !presenters.includes(payload.azp))) {
      throw new SocialProofError("PROVIDER_PROOF_INVALID");
    }
    if (payload.email_verified !== undefined && typeof payload.email_verified !== "boolean") {
      throw new SocialProofError("PROVIDER_PROOF_INVALID");
    }
    if (payload.hd !== undefined && (typeof payload.hd !== "string" || !/^[A-Za-z0-9.-]+$/.test(payload.hd))) {
      throw new SocialProofError("PROVIDER_PROOF_INVALID");
    }
    const address = readProviderEmail(payload.email);
    const authoritative = payload.email_verified === true && address !== null
      && (address.endsWith("@gmail.com") || typeof payload.hd === "string");
    return { provider: "google", subject, clientId: config.serverClientId,
      email: address === null ? null : { address, authority: authoritative ? "provider" : "otp_required", privateRelay: false } };
  } catch (error) {
    rejectProviderProof(error);
  }
}

export async function exchangeGoogleAuthorizationCode(
  code: string, rawNonce: string, redirectUri: string, codeVerifier: string,
): Promise<VerifiedProviderIdentity> {
  const config = getGoogleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  assertProviderCallback("google", redirectUri);
  if (code.length < 1 || code.length > 4_096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  const secret = await loadGoogleSignInSecret(config);
  const json = await postProviderForm("google", "https://oauth2.googleapis.com/token", new URLSearchParams({
    client_id: secret.clientId, client_secret: secret.clientSecret, code, code_verifier: codeVerifier,
    grant_type: "authorization_code", redirect_uri: redirectUri,
  }));
  const payload = parseProviderObject(json, "PROVIDER_PROOF_INVALID");
  if (typeof payload.id_token !== "string") throw new SocialProofError("PROVIDER_PROOF_INVALID");
  return verifyGoogleIdentityToken(payload.id_token, rawNonce, "web");
}
