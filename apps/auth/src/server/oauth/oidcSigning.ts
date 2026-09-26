import { createHash, createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { logWarning } from "../logger.js";

const kms = new KMSClient({ maxAttempts: 3 });
const signingAlgorithm = "RSASSA_PKCS1_V1_5_SHA_256";

export type OidcClaims = Readonly<{
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
}>;

type OidcPublicKey = Readonly<{
  kty: "RSA";
  n: string;
  e: string;
  kid: string;
  use: "sig";
  alg: "RS256";
}>;

let cachedPublicKey: OidcPublicKey | undefined;

function getSigningKeyArn(): string {
  const keyArn = process.env.OIDC_SIGNING_KEY_ARN;
  if (keyArn === undefined || keyArn === "") {
    throw new Error("OIDC_SIGNING_KEY_ARN is not configured");
  }
  return keyArn;
}

kms.middlewareStack.add((next, context) => async (args) => {
  try {
    return await next(args);
  } catch (error) {
    logWarning({
      domain: "auth", action: "error", code: "OIDC_KMS_REQUEST_FAILED",
      route: context.commandName,
      errorClass: error instanceof Error ? error.name : "UnknownKmsFailure",
    });
    throw error;
  }
}, { step: "finalizeRequest", priority: "low", name: "oidcKmsAttemptLogger" });

export async function getOidcPublicKey(): Promise<OidcPublicKey> {
  if (cachedPublicKey !== undefined) {
    return cachedPublicKey;
  }
  const keyArn = getSigningKeyArn();
  const response = await kms.send(new GetPublicKeyCommand({ KeyId: keyArn }));
  if (response.PublicKey === undefined || response.KeyUsage !== "SIGN_VERIFY"
      || !response.SigningAlgorithms?.includes(signingAlgorithm)) {
    throw new Error("OIDC KMS key must expose an RSA signing public key supporting RS256");
  }
  const jwk = createPublicKey({ key: Buffer.from(response.PublicKey), format: "der", type: "spki" }).export({ format: "jwk" });
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new Error("OIDC KMS public key is not an RSA JWK");
  }
  cachedPublicKey = { kty: "RSA", n: jwk.n, e: jwk.e, kid: keyArn, use: "sig", alg: "RS256" };
  return cachedPublicKey;
}

export async function signOidcIdToken(claims: OidcClaims): Promise<string> {
  const keyArn = getSigningKeyArn();
  // KMS signs remotely; only JWS serialization and hashing happen in the Lambda.
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyArn })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const response = await kms.send(new SignCommand({
    KeyId: keyArn,
    SigningAlgorithm: signingAlgorithm,
    MessageType: "DIGEST",
    Message: createHash("sha256").update(signingInput).digest(),
  }));
  if (response.Signature === undefined || response.SigningAlgorithm !== signingAlgorithm) {
    throw new Error("OIDC KMS signing returned no RS256 signature");
  }
  return `${signingInput}.${Buffer.from(response.Signature).toString("base64url")}`;
}
