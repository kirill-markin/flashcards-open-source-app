import { loadAppleSigningSecretJson } from "../../aws/secrets";
import { AppleBillingError, type AppleSigningSecret } from "./contracts";
import { parseAppleSigningSecret } from "./provider";

let resolvedSigningSecret: AppleSigningSecret | undefined;

export async function loadAppleSigningSecret(): Promise<AppleSigningSecret> {
  if (resolvedSigningSecret !== undefined) return resolvedSigningSecret;

  const secretArn = process.env.APPLE_IAP_SECRET_ARN?.trim();
  if (secretArn === undefined || secretArn === "") {
    throw new AppleBillingError("APPLE_BILLING_UNAVAILABLE", true,
      "Apple billing is unavailable: APPLE_IAP_SECRET_ARN is not configured.");
  }

  let json: string;
  try {
    json = await loadAppleSigningSecretJson(secretArn);
  } catch {
    // AWS errors must not expose secret material through the shared request logger.
    throw new AppleBillingError("APPLE_BILLING_UNAVAILABLE", true,
      "Apple signing secret could not be loaded. Check Secrets Manager access and retry.");
  }
  resolvedSigningSecret = parseAppleSigningSecret(json);
  return resolvedSigningSecret;
}
