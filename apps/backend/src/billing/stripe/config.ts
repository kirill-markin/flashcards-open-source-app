import { z } from "zod";
import { loadStripeBillingSecretJson } from "../../aws/secrets";
import { StripeBillingError, type StripeBillingSecret, type StripeEnvironment, type StripeEnvironmentSecret } from "./contracts";

// Restricted runtime keys only; an operator/admin secret key must never enter this schema.
const secretSchema = z.object({
  sandbox: z.object({ apiKey: z.string().regex(/^rk_test_[A-Za-z0-9]+$/),
    webhookSigningSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/) }).optional(),
  production: z.object({ apiKey: z.string().regex(/^rk_live_[A-Za-z0-9]+$/),
    webhookSigningSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/) }).optional(),
});

export function parseStripeBillingSecret(json: string): StripeBillingSecret {
  try {
    return secretSchema.parse(JSON.parse(json));
  } catch {
    throw new StripeBillingError("STRIPE_CONFIGURATION_INVALID", false,
      "Stripe secret must contain sandbox and/or production objects with a restricted API key and webhookSigningSecret.");
  }
}

// No eager secret access or purchase gate: HTTP routes own demo eligibility and live activation.
export async function loadStripeEnvironmentSecret(environment: StripeEnvironment): Promise<StripeEnvironmentSecret> {
  const arn = process.env.STRIPE_BILLING_SECRET_ARN?.trim();
  if (arn === undefined || arn === "") {
    throw new StripeBillingError("STRIPE_BILLING_UNAVAILABLE", true,
      "Stripe billing is unavailable: configure STRIPE_BILLING_SECRET_ARN on the HTTP backend.");
  }
  const secret = parseStripeBillingSecret(await loadStripeBillingSecretJson(arn))[environment];
  if (secret === undefined) {
    throw new StripeBillingError("STRIPE_BILLING_UNAVAILABLE", true,
      `Stripe ${environment} is unavailable: provision its restricted key and endpoint signing secret.`);
  }
  return secret;
}
