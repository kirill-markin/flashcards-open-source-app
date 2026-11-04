import { createHash } from "node:crypto";
import { z } from "zod";
import { loadGoogleBillingSecretJson } from "./aws/secrets";
import { GoogleBillingError } from "./billing/google/contracts";

const federationFields = {
  workloadIdentityProvider: z.string().regex(/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/),
  serviceAccountEmail: z.email().endsWith(".iam.gserviceaccount.com"),
};

const billingSchema = z.object({
  ...federationFields,
  pushAudience: z.url().startsWith("https://"),
  pushServiceAccountEmail: z.email().endsWith(".iam.gserviceaccount.com"),
  pushServiceAccountSubject: z.string().regex(/^\d+$/),
  pushSubscription: z.string().regex(/^projects\/[^/]+\/subscriptions\/[^/]+$/),
});

const reportsSchema = z.object({
  ...federationFields,
  reportsBucket: z.string().min(1),
});

function parseConfiguration<Schema extends z.ZodType>(name: string, value: string, schema: Schema): z.output<Schema> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${name} must contain a JSON object.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${name} is invalid: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return result.data;
}

type GoogleBillingConfig = z.infer<typeof billingSchema>;
let resolvedBillingConfig: Readonly<{ source: string; config: GoogleBillingConfig }> | undefined;

export async function readGoogleBillingConfig(): Promise<GoogleBillingConfig> {
  const json = process.env.GOOGLE_PLAY_BILLING_CONFIG;
  const secretArn = process.env.GOOGLE_PLAY_BILLING_SECRET_ARN;
  if ((json === undefined && secretArn === undefined) || (json !== undefined && secretArn !== undefined)) {
    throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null,
      "Configure exactly one Google billing source: GOOGLE_PLAY_BILLING_CONFIG JSON for a local process or GOOGLE_PLAY_BILLING_SECRET_ARN for the deployed backend.");
  }
  const revision = process.env.GOOGLE_PLAY_BILLING_CONFIG_REVISION;
  if (secretArn !== undefined && (revision === undefined || !/^[a-f0-9]{16}$/.test(revision))) {
    throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null,
      "GOOGLE_PLAY_BILLING_CONFIG_REVISION must contain the 16-character SHA-256 revision emitted by CDK for the deployed Google billing secret.");
  }
  const source = JSON.stringify([json, secretArn, revision]);
  if (resolvedBillingConfig?.source === source) return resolvedBillingConfig.config;
  const value = secretArn === undefined ? json! : await loadGoogleBillingSecretJson(secretArn);
  if (secretArn !== undefined && createHash("sha256").update(value).digest("hex").slice(0, 16) !== revision) {
    throw new GoogleBillingError("GOOGLE_BILLING_UNAVAILABLE", true, null,
      "Google billing secret does not match GOOGLE_PLAY_BILLING_CONFIG_REVISION. Wait for the CI deployment or rollback to finish, then retry.");
  }
  const name = secretArn === undefined ? "GOOGLE_PLAY_BILLING_CONFIG" : "Google billing secret SecretString";
  let config: GoogleBillingConfig;
  try {
    config = parseConfiguration(name, value, billingSchema);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null, error.message);
  }
  resolvedBillingConfig = { source, config };
  return config;
}

export function readGoogleReportsConfig(): z.infer<typeof reportsSchema> {
  const value = process.env.GOOGLE_PLAY_REPORTS_CONFIG;
  if (value === undefined || value.trim() === "") throw new Error("GOOGLE_PLAY_REPORTS_CONFIG is required for Google Play access.");
  return parseConfiguration("GOOGLE_PLAY_REPORTS_CONFIG", value, reportsSchema);
}
