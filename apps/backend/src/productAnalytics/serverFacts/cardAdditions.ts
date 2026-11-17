import type { DatabaseExecutor } from "../../database";
import type { ProductAnalyticsClientReportablePlatform } from "../catalog";

export async function setCardAdditionWriterInExecutor(
  executor: DatabaseExecutor,
  writer: "save" | "import",
): Promise<void> {
  await executor.query("SELECT pg_catalog.set_config('app.card_addition_writer', $1, true)", [writer]);
}

export async function setCardAdditionChatPlatformInExecutor(
  executor: DatabaseExecutor,
  platform: ProductAnalyticsClientReportablePlatform | null,
): Promise<void> {
  if (platform !== null) {
    await executor.query("SELECT pg_catalog.set_config('app.card_addition_chat_platform', $1, true)", [platform]);
  }
}
