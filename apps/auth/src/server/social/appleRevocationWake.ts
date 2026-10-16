import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { log, logWarning } from "../logger.js";
import type { AppleRevocationWakeEvent } from "./appleRevocationEvent.js";

const client = new LambdaClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000, throwOnRequestTimeout: true },
});
client.middlewareStack.add((next) => async (args) => {
  try {
    return await next(args);
  } catch (error) {
    logWarning({ domain: "auth", action: "apple_revocation_wake", code: "APPLE_REVOCATION_WAKE_ATTEMPT_FAILED" });
    throw error;
  }
}, { step: "finalizeRequest", priority: "low", name: "appleRevocationWakeAttemptLogger" });

/** Caller must await the durable staging commit before invoking this accelerator. */
export async function wakeAppleRevocations(): Promise<void> {
  try {
    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (functionName === undefined || functionName === "") throw new Error("Auth Lambda function name is missing");
    const event: AppleRevocationWakeEvent = { source: "nibomo.auth", action: "drain-apple-revocations", version: 1 };
    const response = await client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(event)),
    }), { abortSignal: AbortSignal.timeout(8_000) });
    if (response.StatusCode !== 202) throw new Error(`Auth cleanup wake returned status ${response.StatusCode}`);
    log({ domain: "auth", action: "apple_revocation_wake", statusCode: response.StatusCode });
  } catch (error) {
    logWarning({ domain: "auth", action: "apple_revocation_wake", code: "APPLE_REVOCATION_WAKE_FAILED" });
    throw new Error("Apple cleanup wake failed after durable staging; the scheduled drain will retry", { cause: error });
  }
}
