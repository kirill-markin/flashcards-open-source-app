import { sign } from "node:crypto";
import { readRsaSigningKeyFile, type RsaSigningKey } from "../rsaKeyFile.js";
import type { OidcClaims, OidcPublicKey } from "./oidcSigning.js";

/**
 * Standalone signer for MCP OAuth id_tokens: the RSA private key PEM at OIDC_SIGNING_KEY_FILE.
 * Rotating it invalidates outstanding id_tokens, since JWKS publishes only the current key.
 */
let material: RsaSigningKey | undefined;

function loadMaterial(): RsaSigningKey {
  if (material === undefined) {
    material = readRsaSigningKeyFile("OIDC_SIGNING_KEY_FILE");
  }
  return material;
}

export function getFileOidcPublicKey(): OidcPublicKey {
  return loadMaterial().publicJwk;
}

export function signFileOidcIdToken(claims: OidcClaims): string {
  const { privateKey, publicJwk: publicKey } = loadMaterial();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: publicKey.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url")}`;
}
