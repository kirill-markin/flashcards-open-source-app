import { sign, verify } from "./crypto.js";

type AgentOtpPayload = Readonly<{
  s: string;
  e: string;
  t: number;
}>;

export const AGENT_OTP_TTL_MS = 180_000;

/**
 * Agent OTP tokens are terminal-only signed payloads. Unlike the browser flow,
 * they do not need a separate CSRF value because the signed token is never
 * replayed by the browser cookie stack.
 */
export function createAgentOtpSessionToken(session: string, email: string): string {
  return sign(JSON.stringify({
    s: session,
    e: email,
    t: Date.now(),
  } satisfies AgentOtpPayload));
}

export function parseAgentOtpSessionToken(token: string): AgentOtpPayload {
  const verifiedPayload = verify(token);
  return JSON.parse(verifiedPayload) as AgentOtpPayload;
}

export function isAgentOtpExpired(payload: AgentOtpPayload, nowMs: number): boolean {
  return nowMs - payload.t > AGENT_OTP_TTL_MS;
}
