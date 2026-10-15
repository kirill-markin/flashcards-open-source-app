import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { transaction } from "../../db.js";
import { AuthAttemptError } from "./attemptContract.js";
import { SocialProofError } from "./providers.js";

export type SocialPublicAction = "capabilities" | "start" | "callback" | "complete" | "mailbox_send" | "mailbox_verify" | "redeem" | "manage";
const limits: Readonly<Record<SocialPublicAction, number>> = {
  capabilities: 120, start: 20, callback: 30, complete: 30, mailbox_send: 10, mailbox_verify: 20, redeem: 30, manage: 20,
};

function rateBucket(key: string, value: string): string {
  const hex = process.env.SESSION_ENCRYPTION_KEY;
  if (hex === undefined || !/^[0-9a-f]{64}$/i.test(hex)) throw new SocialProofError("PROVIDER_CONFIGURATION_INVALID");
  return createHmac("sha256", Buffer.from(hex, "hex")).update(JSON.stringify(["social-rate-v1", key, value])).digest("hex");
}

/** Call before external work, using the existing gateway-derived client IP; mailbox sends also use OTP anti-spam limits. */
export async function requireSocialRateLimit(action: SocialPublicAction, trustedIp: string): Promise<void> {
  if (isIP(trustedIp) === 0 || !Object.hasOwn(limits, action)) throw new AuthAttemptError("AUTH_ATTEMPT_INVALID");
  const allowed = await transaction(async (executor) => {
    const global = await executor.query<Readonly<{ allowed: boolean }>>(
      "SELECT auth.consume_social_rate_bucket($1,$2) AS allowed", [rateBucket("all", trustedIp), 200],
    );
    const specific = await executor.query<Readonly<{ allowed: boolean }>>(
      "SELECT auth.consume_social_rate_bucket($1,$2) AS allowed", [rateBucket(action, trustedIp), limits[action]],
    );
    return global.rows[0]?.allowed === true && specific.rows[0]?.allowed === true;
  });
  // Throw after commit so blocked calls cannot roll back their quota consumption.
  if (!allowed) throw new AuthAttemptError("AUTH_RATE_LIMITED");
}
