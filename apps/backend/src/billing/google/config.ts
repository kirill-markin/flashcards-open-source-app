import { AwsClient } from "google-auth-library";
import { GoogleBillingError } from "./contracts";

const googleProviderAudience = "//iam.googleapis.com/projects/360001205059/locations/global/workloadIdentityPools/nibomo-aws-billing/providers/aws-backend";
const googleServiceAccount = "google-play-billing@flashcards-open-source-app.iam.gserviceaccount.com";
let authClient: AwsClient | undefined;

export function loadGoogleAuthClient(): AwsClient {
  for (const field of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"]) {
    if (process.env[field] === undefined || process.env[field]?.trim() === "") {
      throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null,
        `Google billing requires Lambda temporary AWS credentials and region: ${field} is missing.`);
    }
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(process.env.AWS_REGION!)) {
    throw new GoogleBillingError("GOOGLE_CONFIGURATION_INVALID", false, null, "Google billing requires a valid AWS_REGION.");
  }
  if (authClient !== undefined) return authClient;
  authClient = new AwsClient({
    type: "external_account",
    audience: googleProviderAudience,
    subject_token_type: "urn:ietf:params:aws:token-type:aws4_request",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${googleServiceAccount}:generateAccessToken`,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    credential_source: {
      environment_id: "aws1",
      regional_cred_verification_url: "https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15",
    },
    transporterOptions: {
      timeout: 5_000,
      retry: true,
      maxRedirects: 0,
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
  return authClient;
}
