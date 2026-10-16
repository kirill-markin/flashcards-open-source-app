import { sign } from "node:crypto";
import { getAppleSignInConfig, loadAppleSigningSecret, type AppleSignInConfig, type AppleSigningSecret } from "./config.js";
import { decryptAppleCredential, encryptAppleCredential, type EncryptedAppleCredential } from "./appleCredential.js";
import {
  appleRequestNonce, assertProviderCallback, createProviderVerifier, parseProviderObject, postProviderForm, readProviderBoolean,
  readProviderEmail, rejectProviderProof, SocialProofError, validateProofInput, validateProviderClaims,
  type SocialClient, type VerifiedProviderIdentity,
} from "./providers.js";

function appleClientId(config: AppleSignInConfig, client: SocialClient): string {
  switch (client) {
    case "web": case "android": return config.serviceId;
    case "ios": case "macos": return config.iosClientId;
    case "ios-development": case "macos-development": return config.iosDevelopmentClientId;
  }
}
const verifiers = new Map<string, ReturnType<typeof createProviderVerifier>>();

export async function verifyAppleIdentityToken(
  token: string, rawNonce: string, client: SocialClient,
): Promise<VerifiedProviderIdentity & Readonly<{ issuedAt: number }>> {
  const config = getAppleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  validateProofInput(token, rawNonce);
  const clientId = appleClientId(config, client);
  let verifier = verifiers.get(clientId);
  if (verifier === undefined) {
    verifier = createProviderVerifier("https://appleid.apple.com", clientId, "https://appleid.apple.com/auth/keys");
    verifiers.set(clientId, verifier);
  }
  try {
    const payload = await verifier.verify(token);
    const subject = validateProviderClaims(payload, appleRequestNonce(rawNonce), clientId);
    const address = readProviderEmail(payload.email);
    const verified = readProviderBoolean(payload.email_verified);
    const privateRelay = readProviderBoolean(payload.is_private_email);
    const relayDomain = address?.endsWith("@privaterelay.appleid.com") === true || address?.endsWith("@private.icloud.com") === true;
    return { provider: "apple", subject, clientId, issuedAt: payload.iat as number,
      email: address === null ? null : { address, authority: verified ? "provider" : "otp_required", privateRelay: privateRelay || relayDomain } };
  } catch (error) {
    rejectProviderProof(error);
  }
}

function appleClientSecret(secret: AppleSigningSecret, clientId: string): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: secret.keyId })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: secret.teamId, sub: clientId, aud: "https://appleid.apple.com", iat: now, exp: now + 300 })).toString("base64url");
  const input = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(input), { key: secret.privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

export type AppleAuthorizationProof = Readonly<{
  client: SocialClient;
  identityToken: string | null;
  authorizationCode: string;
  rawNonce: string;
  redirectUri: string | null;
}>;

export async function exchangeAppleAuthorizationCode(proof: AppleAuthorizationProof): Promise<Readonly<{
  identity: VerifiedProviderIdentity & Readonly<{ issuedAt: number }>; credential: EncryptedAppleCredential;
}>> {
  const config = getAppleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  const clientId = appleClientId(config, proof.client);
  if (proof.authorizationCode.length < 1 || proof.authorizationCode.length > 4_096) throw new SocialProofError("PROVIDER_PROOF_INVALID");
  const form = new URLSearchParams({ client_id: clientId, code: proof.authorizationCode, grant_type: "authorization_code" });
  if (proof.client === "web" || proof.client === "android") {
    if (proof.redirectUri === null) throw new SocialProofError("PROVIDER_PROOF_INVALID");
    assertProviderCallback("apple", proof.redirectUri);
    form.set("redirect_uri", proof.redirectUri);
  } else if (proof.redirectUri !== null || proof.identityToken === null) {
    throw new SocialProofError("PROVIDER_PROOF_INVALID");
  }
  appleRequestNonce(proof.rawNonce);
  const suppliedIdentity = proof.identityToken === null ? null : await verifyAppleIdentityToken(proof.identityToken, proof.rawNonce, proof.client);
  const secret = await loadAppleSigningSecret(config);
  form.set("client_secret", appleClientSecret(secret, clientId));
  const payload = parseProviderObject(await postProviderForm("apple", "https://appleid.apple.com/auth/token", form), "PROVIDER_PROOF_INVALID");
  if (typeof payload.id_token !== "string" || typeof payload.refresh_token !== "string") throw new SocialProofError("PROVIDER_PROOF_INVALID");
  const identity = await verifyAppleIdentityToken(payload.id_token, proof.rawNonce, proof.client);
  if (suppliedIdentity !== null && suppliedIdentity.subject !== identity.subject) throw new SocialProofError("PROVIDER_PROOF_INVALID");
  return { identity, credential: encryptAppleCredential(identity.subject, clientId, payload.refresh_token) };
}

export async function revokeAppleCredential(credential: EncryptedAppleCredential): Promise<void> {
  const config = getAppleSignInConfig();
  if (config === null) throw new SocialProofError("PROVIDER_UNAVAILABLE");
  if (![config.serviceId, config.iosClientId, config.iosDevelopmentClientId].includes(credential.clientId)) {
    throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  }
  const secret = await loadAppleSigningSecret(config);
  await postProviderForm("apple", "https://appleid.apple.com/auth/revoke", new URLSearchParams({
    client_id: credential.clientId, client_secret: appleClientSecret(secret, credential.clientId),
    token: decryptAppleCredential(credential), token_type_hint: "refresh_token",
  }));
}
