import { setTimeout as delay } from "node:timers/promises";
import { createTransport } from "nodemailer";
import { logWarning } from "../logger.js";
import { getLocalIdentityConfig } from "./localConfig.js";

const maxSendAttempts = 3;
const retryDelayMs = 2_000;

let transporter: ReturnType<typeof createTransport> | undefined;

function getTransporter(): ReturnType<typeof createTransport> {
  if (transporter === undefined) {
    transporter = createTransport({
      url: getLocalIdentityConfig().smtpUrl,
      // smtp:// must upgrade with STARTTLS, because the message carries a sign-in code. Options in
      // SMTP_URL win over these, so a trusted local test mailbox can say `?requireTLS=false`.
      requireTLS: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

/** Delivers the sign-in code; the code never reaches a log. */
export async function sendLocalSignInCode(email: string, code: string): Promise<void> {
  const { smtpFrom } = getLocalIdentityConfig();
  for (let attempt = 1; ; attempt += 1) {
    try {
      await getTransporter().sendMail({
        from: smtpFrom,
        to: email,
        subject: `Your Nibomo sign-in code: ${code}`,
        text: `Your Nibomo sign-in code is ${code}\n\nIt expires in 3 minutes. If you did not request it, ignore this email.\n`,
      });
      return;
    } catch (error) {
      if (attempt >= maxSendAttempts) throw error;
      logWarning({ domain: "auth", action: "send_code_error", reasonCategory: "local_smtp_send_retry", email,
        error: error instanceof Error ? error.message : String(error) });
      await delay(retryDelayMs);
    }
  }
}
