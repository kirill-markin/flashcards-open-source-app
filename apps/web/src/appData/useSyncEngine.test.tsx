// @vitest-environment jsdom

import { act, useState, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudSettings,
  SessionInfo,
  SyncBootstrapEntry,
  SyncPullResult,
  SyncReviewHistoryPullResult,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";
import { useSyncEngine } from "./useSyncEngine";

const {
  applyHotSyncPageMock,
  applyReviewHistorySyncPageMock,
  bootstrapPullSyncStateMock,
  deleteOutboxRecordMock,
  hasHydratedHotStateMock,
  hasHydratedReviewHistoryMock,
  listOutboxRecordsMock,
  loadCardByIdMock,
  loadCloudSettingsMock,
  loadDeckByIdMock,
  loadLastAppliedHotChangeIdMock,
  loadLastAppliedReviewSequenceIdMock,
  loadWorkspaceSettingsMock,
  pullReviewHistorySyncMock,
  pullSyncChangesMock,
  pushSyncOperationsMock,
  putCardMock,
  putDeckMock,
  putOutboxRecordMock,
  putReviewEventMock,
  putWorkspaceSettingsMock,
  setHotStateHydratedMock,
  setLastAppliedHotChangeIdMock,
  setLastAppliedReviewSequenceIdMock,
  setReviewHistoryHydratedMock,
} = vi.hoisted(() => ({
  applyHotSyncPageMock: vi.fn(),
  applyReviewHistorySyncPageMock: vi.fn(),
  bootstrapPullSyncStateMock: vi.fn(),
  deleteOutboxRecordMock: vi.fn(),
  hasHydratedHotStateMock: vi.fn(),
  hasHydratedReviewHistoryMock: vi.fn(),
  listOutboxRecordsMock: vi.fn(),
  loadCardByIdMock: vi.fn(),
  loadCloudSettingsMock: vi.fn(),
  loadDeckByIdMock: vi.fn(),
  loadLastAppliedHotChangeIdMock: vi.fn(),
  loadLastAppliedReviewSequenceIdMock: vi.fn(),
  loadWorkspaceSettingsMock: vi.fn(),
  pullReviewHistorySyncMock: vi.fn(),
  pullSyncChangesMock: vi.fn(),
  pushSyncOperationsMock: vi.fn(),
  putCardMock: vi.fn(),
  putDeckMock: vi.fn(),
  putOutboxRecordMock: vi.fn(),
  putReviewEventMock: vi.fn(),
  putWorkspaceSettingsMock: vi.fn(),
  setHotStateHydratedMock: vi.fn(),
  setLastAppliedHotChangeIdMock: vi.fn(),
  setLastAppliedReviewSequenceIdMock: vi.fn(),
  setReviewHistoryHydratedMock: vi.fn(),
}));

vi.mock("../api", () => ({
  bootstrapPullSyncState: bootstrapPullSyncStateMock,
  isAuthRedirectError: () => false,
  pullReviewHistorySync: pullReviewHistorySyncMock,
  pullSyncChanges: pullSyncChangesMock,
  pushSyncOperations: pushSyncOperationsMock,
}));

vi.mock("../localDb/cards", () => ({
  loadCardById: loadCardByIdMock,
  putCard: putCardMock,
}));

vi.mock("../localDb/cloudSettings", () => ({
  loadCloudSettings: loadCloudSettingsMock,
}));

vi.mock("../localDb/decks", () => ({
  loadDeckById: loadDeckByIdMock,
  putDeck: putDeckMock,
}));

vi.mock("../localDb/outbox", () => ({
  deleteOutboxRecord: deleteOutboxRecordMock,
  listOutboxRecords: listOutboxRecordsMock,
  putOutboxRecord: putOutboxRecordMock,
}));

vi.mock("../localDb/reviews", () => ({
  putReviewEvent: putReviewEventMock,
}));

vi.mock("../localDb/workspace", () => ({
  applyHotSyncPage: applyHotSyncPageMock,
  applyReviewHistorySyncPage: applyReviewHistorySyncPageMock,
  hasHydratedHotState: hasHydratedHotStateMock,
  hasHydratedReviewHistory: hasHydratedReviewHistoryMock,
  loadLastAppliedHotChangeId: loadLastAppliedHotChangeIdMock,
  loadLastAppliedReviewSequenceId: loadLastAppliedReviewSequenceIdMock,
  loadWorkspaceSettings: loadWorkspaceSettingsMock,
  putWorkspaceSettings: putWorkspaceSettingsMock,
  setHotStateHydrated: setHotStateHydratedMock,
  setLastAppliedHotChangeId: setLastAppliedHotChangeIdMock,
  setLastAppliedReviewSequenceId: setLastAppliedReviewSequenceIdMock,
  setReviewHistoryHydrated: setReviewHistoryHydratedMock,
}));

vi.mock("../clientIdentity", () => ({
  webAppVersion: "test-web-version",
}));

const sessionFixture: SessionInfo = {
  userId: "user-1",
  selectedWorkspaceId: "workspace-1",
  authTransport: "cookie",
  csrfToken: "csrf-token",
  profile: {
    email: "test@example.com",
    locale: "en",
    createdAt: "2026-03-18T09:00:00.000Z",
  },
};

const workspaceFixture: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace One",
  createdAt: "2026-03-18T09:00:00.000Z",
  isSelected: true,
};

const cloudSettingsFixture: CloudSettings = {
  deviceId: "device-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "test@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-03-18T09:00:00.000Z",
};

const bootstrapCardEntry: SyncBootstrapEntry = {
  entityType: "card",
  entityId: "card-1",
  action: "upsert",
  payload: {
    cardId: "card-1",
    frontText: "Question",
    backText: "Answer",
    tags: ["grammar"],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2026-03-18T10:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-18T10:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "op-card-1",
    updatedAt: "2026-03-18T10:00:00.000Z",
    deletedAt: null,
  },
};

const bootstrapSettingsEntry: SyncBootstrapEntry = {
  entityType: "workspace_scheduler_settings",
  entityId: "workspace-1",
  action: "upsert",
  payload: {
    algorithm: "fsrs-6",
    desiredRetention: 0.91,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36500,
    enableFuzz: true,
    clientUpdatedAt: "2026-03-18T10:01:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "settings-bootstrap",
    updatedAt: "2026-03-18T10:01:00.000Z",
  },
};

let latestSyncEngine: ReturnType<typeof useSyncEngine> | null = null;

function SyncEngineHarness(): ReactElement {
  const [, setWorkspaceSettings] = useState<WorkspaceSchedulerSettings | null>(null);
  const [, setCloudSettings] = useState<CloudSettings | null>(null);
  const [, setLocalReadVersion] = useState<number>(0);
  const [, setIsSyncing] = useState<boolean>(false);
  const [, setErrorMessage] = useState<string>("");

  latestSyncEngine = useSyncEngine({
    sessionLoadState: "loading",
    session: sessionFixture,
    activeWorkspace: workspaceFixture,
    setWorkspaceSettings,
    setCloudSettings,
    setLocalReadVersion,
    setIsSyncing,
    setErrorMessage,
  });

  return <div data-testid="sync-engine-harness" />;
}

describe("useSyncEngine", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    latestSyncEngine = null;

    applyHotSyncPageMock.mockReset();
    applyReviewHistorySyncPageMock.mockReset();
    bootstrapPullSyncStateMock.mockReset();
    deleteOutboxRecordMock.mockReset();
    hasHydratedHotStateMock.mockReset();
    hasHydratedReviewHistoryMock.mockReset();
    listOutboxRecordsMock.mockReset();
    loadCardByIdMock.mockReset();
    loadCloudSettingsMock.mockReset();
    loadDeckByIdMock.mockReset();
    loadLastAppliedHotChangeIdMock.mockReset();
    loadLastAppliedReviewSequenceIdMock.mockReset();
    loadWorkspaceSettingsMock.mockReset();
    pullReviewHistorySyncMock.mockReset();
    pullSyncChangesMock.mockReset();
    pushSyncOperationsMock.mockReset();
    putCardMock.mockReset();
    putDeckMock.mockReset();
    putOutboxRecordMock.mockReset();
    putReviewEventMock.mockReset();
    putWorkspaceSettingsMock.mockReset();
    setHotStateHydratedMock.mockReset();
    setLastAppliedHotChangeIdMock.mockReset();
    setLastAppliedReviewSequenceIdMock.mockReset();
    setReviewHistoryHydratedMock.mockReset();

    applyHotSyncPageMock.mockResolvedValue(undefined);
    applyReviewHistorySyncPageMock.mockResolvedValue(undefined);
    deleteOutboxRecordMock.mockResolvedValue(undefined);
    hasHydratedHotStateMock.mockResolvedValue(false);
    hasHydratedReviewHistoryMock.mockResolvedValue(false);
    listOutboxRecordsMock.mockResolvedValue([]);
    loadCardByIdMock.mockResolvedValue(null);
    loadCloudSettingsMock.mockResolvedValue(cloudSettingsFixture);
    loadDeckByIdMock.mockResolvedValue(null);
    loadLastAppliedHotChangeIdMock.mockResolvedValue(42);
    loadLastAppliedReviewSequenceIdMock.mockResolvedValue(0);
    loadWorkspaceSettingsMock.mockResolvedValue(null);
    pushSyncOperationsMock.mockResolvedValue({ operations: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("applies bootstrap, hot changes, and review history by page instead of per record", async () => {
    const hotPullResultPageOne: SyncPullResult = {
      changes: [{
        entityType: "deck",
        entityId: "deck-1",
        action: "upsert",
        changeId: 100,
        payload: {
          deckId: "deck-1",
          workspaceId: workspaceFixture.workspaceId,
          name: "Grammar",
          filterDefinition: {
            version: 2,
            effortLevels: ["fast"],
            tags: ["grammar"],
          },
          createdAt: "2026-03-18T10:02:00.000Z",
          clientUpdatedAt: "2026-03-18T10:02:00.000Z",
          lastModifiedByDeviceId: "device-1",
          lastOperationId: "op-deck-1",
          updatedAt: "2026-03-18T10:02:00.000Z",
          deletedAt: null,
        },
      }],
      nextHotChangeId: 101,
      hasMore: true,
    };
    const hotPullResultPageTwo: SyncPullResult = {
      changes: [{
        entityType: "workspace_scheduler_settings",
        entityId: "workspace-1",
        action: "upsert",
        changeId: 102,
        payload: {
          ...bootstrapSettingsEntry.payload,
          desiredRetention: 0.95,
          lastOperationId: "settings-hot",
        },
      }],
      nextHotChangeId: 103,
      hasMore: false,
    };
    const reviewPullPageOne: SyncReviewHistoryPullResult = {
      reviewEvents: [{
        reviewEventId: "review-1",
        workspaceId: workspaceFixture.workspaceId,
        cardId: "card-1",
        deviceId: "device-1",
        clientEventId: "event-1",
        rating: 3,
        reviewedAtClient: "2026-03-18T10:03:00.000Z",
        reviewedAtServer: "2026-03-18T10:03:01.000Z",
      }],
      nextReviewSequenceId: 7,
      hasMore: true,
    };
    const reviewPullPageTwo: SyncReviewHistoryPullResult = {
      reviewEvents: [],
      nextReviewSequenceId: 8,
      hasMore: false,
    };

    bootstrapPullSyncStateMock
      .mockResolvedValueOnce({
        mode: "pull",
        entries: [bootstrapCardEntry],
        nextCursor: "cursor-2",
        hasMore: true,
        bootstrapHotChangeId: 40,
        remoteIsEmpty: false,
      })
      .mockResolvedValueOnce({
        mode: "pull",
        entries: [bootstrapSettingsEntry],
        nextCursor: null,
        hasMore: false,
        bootstrapHotChangeId: 42,
        remoteIsEmpty: false,
      });
    pullSyncChangesMock
      .mockResolvedValueOnce(hotPullResultPageOne)
      .mockResolvedValueOnce(hotPullResultPageTwo);
    pullReviewHistorySyncMock
      .mockResolvedValueOnce(reviewPullPageOne)
      .mockResolvedValueOnce(reviewPullPageTwo);

    await act(async () => {
      root.render(<SyncEngineHarness />);
    });

    await act(async () => {
      await latestSyncEngine?.runSyncForWorkspace(workspaceFixture);
    });

    expect(applyHotSyncPageMock).toHaveBeenCalledTimes(4);
    expect(applyHotSyncPageMock).toHaveBeenNthCalledWith(
      1,
      workspaceFixture.workspaceId,
      [bootstrapCardEntry],
      null,
    );
    expect(applyHotSyncPageMock).toHaveBeenNthCalledWith(
      2,
      workspaceFixture.workspaceId,
      [bootstrapSettingsEntry],
      {
        lastAppliedHotChangeId: 42,
        markHotStateHydrated: true,
      },
    );
    expect(applyHotSyncPageMock).toHaveBeenNthCalledWith(
      3,
      workspaceFixture.workspaceId,
      hotPullResultPageOne.changes,
      {
        lastAppliedHotChangeId: 101,
        markHotStateHydrated: false,
      },
    );
    expect(applyHotSyncPageMock).toHaveBeenNthCalledWith(
      4,
      workspaceFixture.workspaceId,
      hotPullResultPageTwo.changes,
      {
        lastAppliedHotChangeId: 103,
        markHotStateHydrated: false,
      },
    );

    expect(applyReviewHistorySyncPageMock).toHaveBeenCalledTimes(2);
    expect(applyReviewHistorySyncPageMock).toHaveBeenNthCalledWith(
      1,
      workspaceFixture.workspaceId,
      reviewPullPageOne.reviewEvents,
      {
        lastAppliedReviewSequenceId: 7,
        markReviewHistoryHydrated: false,
      },
    );
    expect(applyReviewHistorySyncPageMock).toHaveBeenNthCalledWith(
      2,
      workspaceFixture.workspaceId,
      reviewPullPageTwo.reviewEvents,
      {
        lastAppliedReviewSequenceId: 8,
        markReviewHistoryHydrated: true,
      },
    );

    expect(putCardMock).not.toHaveBeenCalled();
    expect(putDeckMock).not.toHaveBeenCalled();
    expect(putReviewEventMock).not.toHaveBeenCalled();
    expect(putWorkspaceSettingsMock).not.toHaveBeenCalled();
    expect(setLastAppliedHotChangeIdMock).not.toHaveBeenCalled();
    expect(setHotStateHydratedMock).not.toHaveBeenCalled();
    expect(setLastAppliedReviewSequenceIdMock).not.toHaveBeenCalled();
    expect(setReviewHistoryHydratedMock).not.toHaveBeenCalled();
  });
});
