import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readStandaloneSecretFile } from "./deployment.js";

export type RsaPublicJwk = Readonly<{ kty: "RSA"; n: string; e: string; kid: string; use: "sig"; alg: "RS256" }>;

export type RsaSigningKey = Readonly<{ privateKey: KeyObject; publicJwk: RsaPublicJwk }>;

const minimumModulusBits = 2048;

/** The standalone RS256 signing key at the path named by `variableName`. */
export function readRsaSigningKeyFile(variableName: string): RsaSigningKey {
  const path = process.env[variableName];
  const invalid = (reason: string): Error => new Error(
    `${variableName} names ${path}, which must hold an unencrypted RSA private key PEM of at least ${minimumModulusBits} bits: ${reason}`,
  );

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(readStandaloneSecretFile(variableName));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${variableName} `)) throw error;
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  if (privateKey.asymmetricKeyType !== "rsa") throw invalid(`got a ${privateKey.asymmetricKeyType} key`);
  const modulusBits = privateKey.asymmetricKeyDetails?.modulusLength ?? 0;
  if (modulusBits < minimumModulusBits) throw invalid(`got ${modulusBits} bits`);

  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") throw invalid("its public key did not export as an RSA JWK");
  // RFC 7638 thumbprint: the required members in lexicographic order, without whitespace.
  const kid = createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
  return { privateKey, publicJwk: { kty: "RSA", n: jwk.n, e: jwk.e, kid, use: "sig", alg: "RS256" } };
}
