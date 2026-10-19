import * as Sentry from "@sentry/aws-serverless";
import type { Context } from "hono";
import { type AuthAppEnv, type AuthPublicErrorCode, getRequestId } from "../apiErrors.js";
import type { CognitoOperation, CognitoTypedError } from "./cognitoErrors.js";

export type CognitoOutageLogFields = Readonly<{
  operation: CognitoOperation;
  cognitoType: string;
  providerStatusCode: number;
}>;

export function getCognitoOutageLogFields(error: CognitoTypedError): CognitoOutageLogFields {
  return {
    operation: error.operation,
    cognitoType: error.cognitoType,
    providerStatusCode: error.providerStatusCode,
  };
}

export function reportCognitoProviderOutage(
  c: Context<AuthAppEnv>,
  error: CognitoTypedError,
  code: AuthPublicErrorCode,
): void {
  // A warning under its own fingerprint: Sentry groups by stack trace regardless of level,
  // so without it a Cognito outage would join the unhandled-error issue.
  Sentry.captureException(error, {
    level: "warning",
    fingerprint: ["auth-cognito-provider-outage"],
    tags: { service: "auth", route: c.req.path, code },
    extra: { requestId: getRequestId(c), ...getCognitoOutageLogFields(error) },
  });
}
