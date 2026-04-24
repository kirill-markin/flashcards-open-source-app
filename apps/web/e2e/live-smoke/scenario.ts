import type { LiveSmokeScenario } from "./types";

export function runIdFromClock(): string {
  return `${Date.now()}`;
}

export function buildScenario(runId: string): LiveSmokeScenario {
  return {
    workspaceName: `E2E web ${runId}`,
    seededFrontText: `Seeded e2e web ${runId}`,
    seededBackText: `Seeded answer e2e web ${runId}`,
  };
}
