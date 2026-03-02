import cron from "node-cron";
import { handler } from "./lambda";

const timezone = process.env.WORKER_TIMEZONE ?? "UTC";

async function runOnce(): Promise<void> {
  const result = await handler();
  console.log("worker run result", result.body);
}

cron.schedule("*/15 * * * *", () => {
  runOnce().catch((error: unknown) => {
    console.error("worker scheduled run failed", error);
  });
}, { timezone });

console.log(`Worker scheduler started. Running every 15 minutes (${timezone}).`);

runOnce().catch((error: unknown) => {
  console.error("worker initial run failed", error);
  process.exit(1);
});
