/**
 * Structured logger for auth service.
 */
import type { AuthTraceId } from "./sentry.js";

type AuthAction =
  | "send_code"
  | "send_code_error"
  | "send_code_demo_sign_in"
  | "send_code_demo_sign_in_error"
  | "agent_send_code_blocked_ip_limit"
  | "agent_send_code_error"
  | "verify_code"
  | "verify_code_error"
  | "verify_code_locked"
  | "sign_in_password"
  | "sign_in_password_error"
  | "agent_verify_code_error"
  | "agent_verify_code_locked"
  | "refresh_token"
  | "refresh_token_error"
  | "refresh_session"
  | "refresh_session_error"
  | "refresh_session_missing_cookie"
  | "revoke_token"
  | "revoke_token_error"
  | "database_pool_error"
  | "request_error"
  | "error";

export type AuthLogEvent = Readonly<{
  domain: "auth";
  action: AuthAction;
  requestId?: string;
  traceId?: AuthTraceId | null;
  route?: string;
  statusCode?: number;
  code?: string;
  poolName?: string;
  sqlState?: string | null;
  errorCode?: string | null;
  errorClass?: string;
  errorMessage?: string;
  reasonCategory?: string;
  maskedEmail?: string;
  ipAddress?: string;
  error?: string;
}>;

export type AuthLogger = (event: AuthLogEvent) => void;

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
};

export const log: AuthLogger = (event) => {
  console.log(JSON.stringify(event));
};

export const logWarning: AuthLogger = (event) => {
  console.warn(JSON.stringify(event));
};
