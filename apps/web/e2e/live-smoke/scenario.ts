import type { LiveSmokeScenario } from "./types";

export function runIdFromClock(): string {
  return `${Date.now()}`;
}

export function buildScenario(runId: string): LiveSmokeScenario {
  return {
    workspaceName: `E2E web ${runId}`,
    manualFrontText: `Manual e2e web ${runId}`,
    manualBackText: `Manual answer e2e web ${runId}`,
  };
}
