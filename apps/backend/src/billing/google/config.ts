import { AwsClient } from "google-auth-library";
import { GoogleBillingError } from "./contracts";
import { readGoogleBillingConfig } from "../../googleCloudConfig";

let cachedAuthClient: Readonly<{ identity: string; client: AwsClient }> | undefined;

export async function loadGoogleAuthClient(): Promise<AwsClient> {
  for (const field of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"]) {
    if (process.env[field] === undefined || process.env[field]?.trim() === "") {
      throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null,
        `Google billing requires Lambda temporary AWS credentials and region: ${field} is missing.`);
    }
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(process.env.AWS_REGION!)) {
    throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null, "Google billing requires a valid AWS_REGION.");
  }
  const config = await readGoogleBillingConfig();
  const identity = JSON.stringify([config.workloadIdentityProvider, config.serviceAccountEmail]);
  if (cachedAuthClient?.identity === identity) return cachedAuthClient.client;
  const client = new AwsClient({
    type: "external_account",
    audience: `//iam.googleapis.com/${config.workloadIdentityProvider}`,
    subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    credential_source: {
      environment_id: "aws1",
      regional_cred_verification_url: "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
    },
    // Bounds Publisher and impersonation requests only: the library's STS exchange keeps its default
    // transport inside the enclosing Lambda deadline. Accepted; do not patch the SDK internals.
    transporterOptions: {
      // gaxios defaults to node-fetch, whose timeout abort carries no TimeoutError code and is never retried.
      fetchImplementation: fetch,
      timeout: 5_000,
      retry: true,
      redirect: "error",
      retryConfig: {
        retry: 2,
        noResponseRetries: 2,
        httpMethodsToRetry: ["GET", "POST"],
        statusCodesToRetry: [[408, 408], [409, 409], [429, 429], [500, 599]],
        totalTimeout: 15_000,
        maxRetryDelay: 500,
        onRetryAttempt: (error): void => {
          console.warn(JSON.stringify({ event: "google_billing_provider_retry",
            attempt: error.config.retryConfig?.currentRetryAttempt, httpStatus: error.response?.status ?? null }));
        },
      },
    },
  });
  cachedAuthClient = { identity, client };
  return client;
}
