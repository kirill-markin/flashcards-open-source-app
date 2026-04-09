import type { BrowserContext, Page } from "@playwright/test";

import type { LiveSmokeDiagnostics } from "../live-smoke.diagnostics";

export type LiveSmokeScenario = Readonly<{
  workspaceName: string;
  manualFrontText: string;
  manualBackText: string;
}>;

export type CompletedSqlToolCall = Readonly<{
  summary: string;
  request: string | null;
  response: string | null;
}>;

export type AiTransportObservation = Readonly<{
  liveRequestCount: number;
  snapshotPollRequestCount: number;
  sessionlessChatSnapshotRequestCount: number;
  sessionlessChatRunRequestCount: number;
  sessionlessTranscriptionRequestCount: number;
}>;

export type AiCreateAttemptResolution = Readonly<{
  completionState: "idle" | "inserted";
  matchedInsertToolCall: CompletedSqlToolCall | null;
}>;

export type AiTransportObserver = Readonly<{
  start: () => void;
  stop: () => AiTransportObservation;
  dispose: () => void;
}>;

export type LiveSmokeSession = {
  context: BrowserContext;
  page: Page;
  diagnostics: LiveSmokeDiagnostics;
  scenario: LiveSmokeScenario;
  baseUrl: string;
  reviewEmail: string;
  cleanupRequested: boolean;
};
