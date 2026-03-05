/**
 * Structured logger for auth service.
 */
type AuthEvent =
  | Readonly<{ domain: "auth"; action: "send_code"; maskedEmail: string }>
  | Readonly<{ domain: "auth"; action: "send_code_error"; error: string }>
  | Readonly<{ domain: "auth"; action: "verify_code"; maskedEmail: string }>
  | Readonly<{ domain: "auth"; action: "verify_code_error"; error: string }>
  | Readonly<{ domain: "auth"; action: "refresh_token" }>
  | Readonly<{ domain: "auth"; action: "refresh_token_error"; error: string }>
  | Readonly<{ domain: "auth"; action: "revoke_token" }>
  | Readonly<{ domain: "auth"; action: "revoke_token_error"; error: string }>
  | Readonly<{ domain: "auth"; action: "error"; error: string }>;

type LogEvent = AuthEvent;

export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
};

export const log = (event: LogEvent): void => {
  console.log(JSON.stringify(event));
};
