/**
 * Structured logger for auth service.
 */
type AuthAction =
  | "send_code"
  | "send_code_error"
  | "agent_send_code_blocked_ip_limit"
  | "agent_send_code_error"
  | "verify_code"
  | "verify_code_error"
  | "agent_verify_code_error"
  | "refresh_token"
  | "refresh_token_error"
  | "revoke_token"
  | "revoke_token_error"
  | "request_error"
  | "error";

type LogEvent = Readonly<{
  domain: "auth";
  action: AuthAction;
  requestId?: string;
  route?: string;
  statusCode?: number;
  code?: string;
  reasonCategory?: string;
  maskedEmail?: string;
  ipAddress?: string;
  error?: string;
}>;

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
};

export const log = (event: LogEvent): void => {
  console.log(JSON.stringify(event));
};
