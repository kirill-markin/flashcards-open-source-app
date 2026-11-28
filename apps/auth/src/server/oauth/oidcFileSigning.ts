import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { readStandaloneSecretFile } from "../deployment.js";
import type { OidcClaims, OidcPublicKey } from "./oidcSigning.js";

/**
 * Standalone signer for MCP OAuth id_tokens: the RSA private key PEM at OIDC_SIGNING_KEY_FILE.
 * Rotating it invalidates outstanding id_tokens, since JWKS publishes only the current key.
 */
type FileSigningMaterial = Readonly<{
  privateKey: KeyObject;
  publicKey: OidcPublicKey;
}>;

let material: FileSigningMaterial | undefined;

function loadMaterial(): FileSigningMaterial {
  if (material !== undefined) {
    return material;
  }
  const privateKey = createPrivateKey(readStandaloneSecretFile("OIDC_SIGNING_KEY_FILE"));
  if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("OIDC_SIGNING_KEY_FILE must hold an RSA private key of at least 2048 bits");
  }
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new Error("OIDC_SIGNING_KEY_FILE public key is not an RSA JWK");
  }
  // RFC 7638 thumbprint: the required members in lexicographic order, without whitespace.
  const kid = createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
  material = { privateKey, publicKey: { kty: "RSA", n: jwk.n, e: jwk.e, kid, use: "sig", alg: "RS256" } };
  return material;
}

export function getFileOidcPublicKey(): OidcPublicKey {
  return loadMaterial().publicKey;
}

export function signFileOidcIdToken(claims: OidcClaims): string {
  const { privateKey, publicKey } = loadMaterial();
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: publicKey.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url")}`;
}
