import { test } from "@playwright/test";

import type { LiveSmokeSession } from "./types";

export async function runLiveSmokeStep(
  session: LiveSmokeSession,
  stepName: string,
  body: () => Promise<void>,
): Promise<void> {
  session.diagnostics.startStep(stepName);
  await test.step(stepName, async () => {
    await body();
  });
  session.diagnostics.completeStep(stepName);
}
