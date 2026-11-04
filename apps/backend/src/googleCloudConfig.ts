import { z } from "zod";

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

function readConfiguration<Schema extends z.ZodType>(name: string, schema: Schema): z.output<Schema> {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required for Google Play access.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${name} must contain a JSON object.`, { cause: error });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${name} is invalid: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return result.data;
}

export function readGoogleBillingConfig(): z.infer<typeof billingSchema> {
  return readConfiguration("GOOGLE_PLAY_BILLING_CONFIG", billingSchema);
}

export function readGoogleReportsConfig(): z.infer<typeof reportsSchema> {
  return readConfiguration("GOOGLE_PLAY_REPORTS_CONFIG", reportsSchema);
}
