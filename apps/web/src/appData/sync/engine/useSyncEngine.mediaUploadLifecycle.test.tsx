// @vitest-environment jsdom

import {
  act,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudSettings,
  SessionInfo,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../../../types";
import { useSyncEngine } from "./useSyncEngine";

const syncEngineMocks = vi.hoisted(() => ({
  processDueMediaUploadTransfersForWorkspace: vi.fn(),
}));

vi.mock("../../../localDb/sync/cloudSettings", () => ({
  loadCloudSettings: vi.fn(async (): Promise<CloudSettings> => ({
    installationId: "installation-1",
    cloudState: "linked",
    linkedUserId: "user-1",
    linkedWorkspaceId: "workspace-1",
    linkedEmail: "user@example.com",
    onboardingCompleted: true,
    updatedAt: "2026-03-10T09:00:00.000Z",
  })),
}));

vi.mock("../../../localDb/mediaTransfers", () => ({
  loadNextPendingMediaTransferAttemptAtByKind: vi.fn(async (): Promise<null> => null),
}));

vi.mock("../../../localDb/cards/workspace", () => ({
  loadWorkspaceSettings: vi.fn(async (): Promise<WorkspaceSchedulerSettings> => ({
    algorithm: "fsrs-6",
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36500,
    enableFuzz: true,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
  })),
}));

vi.mock("../remote/syncRemote", () => ({
  runWorkspaceRemoteSync: vi.fn(async () => ({
    didChangeProgressHistory: false,
    didChangeReviewSchedule: false,
  })),
}));

vi.mock("../mediaUploads/mediaUploadTransferRunner", () => ({
  processDueMediaUploadTransfersForWorkspace:
    syncEngineMocks.processDueMediaUploadTransfersForWorkspace,
}));

type SyncEngineApi = ReturnType<typeof useSyncEngine>;

const workspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace",
  createdAt: "2026-03-10T09:00:00.000Z",
  isSelected: true,
};

const session: SessionInfo = {
  userId: "user-1",
  selectedWorkspaceId: workspace.workspaceId,
  authTransport: "cookie",
  csrfToken: "csrf-token-1",
  preferences: {
    reviewReactionAnimationsEnabled: true,
  },
  profile: {
    email: "user@example.com",
    locale: "en",
    createdAt: "2026-03-10T09:00:00.000Z",
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderSyncEngineHarness(): Readonly<{
  getApi: () => SyncEngineApi;
}> {
  let latestApi: SyncEngineApi | null = null;

  function Harness(): null {
    const [, setWorkspaceSettings] = useState<WorkspaceSchedulerSettings | null>(null);
    const [, setCloudSettings] = useState<CloudSettings | null>(null);
    const [, setLocalReadVersion] = useState<number>(0);
    const [, setIsSyncing] = useState<boolean>(false);
    const [, setErrorMessage] = useState<string>("");
    const [, setTechnicalError] = useState<Error | null>(null);
    latestApi = useSyncEngine({
      sessionLoadState: "ready",
      sessionVerificationState: "verified",
      session,
      activeWorkspace: workspace,
      setWorkspaceSettings,
      setCloudSettings,
      setLocalReadVersion,
      setIsSyncing,
      setErrorMessage,
      setTechnicalError,
    });
    return null;
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness />);
  });

  return {
    getApi(): SyncEngineApi {
      if (latestApi === null) {
        throw new Error("Expected sync engine API to be available");
      }
      return latestApi;
    },
  };
}

async function waitForMediaUploadSignal(): Promise<AbortSignal> {
  for (let attemptCount = 0; attemptCount < 20; attemptCount += 1) {
    const signal = syncEngineMocks.processDueMediaUploadTransfersForWorkspace.mock.calls[0]?.[1];
    if (signal instanceof AbortSignal) {
      return signal;
    }
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error("Expected sync engine to start a media upload transfer");
}

beforeEach(() => {
  syncEngineMocks.processDueMediaUploadTransfersForWorkspace.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useSyncEngine media upload lifecycle", () => {
  it("aborts pending upload work before completing a full sync discard", async () => {
    syncEngineMocks.processDueMediaUploadTransfersForWorkspace.mockImplementation(
      async (_workspaceId: string, signal: AbortSignal): Promise<void> => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const harness = renderSyncEngineHarness();
    const signal = await waitForMediaUploadSignal();
    const runWhileDiscarding = vi.fn(async (): Promise<void> => {
      expect(signal.aborted).toBe(true);
    });

    await act(async () => {
      await harness.getApi().discardAllSyncWork(runWhileDiscarding);
    });

    expect(signal.aborted).toBe(true);
    expect(syncEngineMocks.processDueMediaUploadTransfersForWorkspace).toHaveBeenCalledTimes(1);
    expect(runWhileDiscarding).toHaveBeenCalledTimes(1);
  });
});
