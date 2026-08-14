// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";
import { createStorageMock } from "../../../api/ApiTestSupport";
import { I18nProvider } from "../../../i18n";
import type { Card } from "../../../types";

const mocks = vi.hoisted(() => ({
  deleteCardItemMock: vi.fn(),
  handoffCardToAiMock: vi.fn(),
  indexedDbOpenRecoveryState: {
    hasFailed: (): boolean => false,
    isFailed: false,
    markFailed: (): "not_recovery" => "not_recovery",
    signal: new AbortController().signal,
    throwIfFailed: (): void => {},
  },
  loadCardByIdMock: vi.fn(),
  loadMediaAssetRecordMock: vi.fn(),
  loadMediaBlobCacheRecordMock: vi.fn(),
  loadMediaUploadTransfersForWorkspaceMediaAssetsMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
  markMediaUploadTransferDueForRetryMock: vi.fn(),
  showCapturedTechnicalErrorMock: vi.fn(),
  updateCardItemMock: vi.fn(),
  useAppDataMock: vi.fn(),
  writeMediaBlobCacheRecordMock: vi.fn(),
}));

export { mocks };

vi.mock("../../../appData", () => ({
  useAppData: mocks.useAppDataMock,
}));

vi.mock("../../../appError/AppErrorContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../appError/AppErrorContext")>();
  return {
    ...actual,
    useAppErrorDialog: () => ({
      indexedDbOpenRecoveryState: mocks.indexedDbOpenRecoveryState,
      showCapturedTechnicalError: mocks.showCapturedTechnicalErrorMock,
    }),
  };
});

vi.mock("../../../chat/handoff/useAiCardHandoff", () => ({
  useAiCardHandoff: () => mocks.handoffCardToAiMock,
}));

vi.mock("../../../localDb/cards/cards", () => ({
  loadCardById: mocks.loadCardByIdMock,
}));

vi.mock("../../../localDb/cards/workspace", () => ({
  loadWorkspaceTagsSummary: mocks.loadWorkspaceTagsSummaryMock,
}));

vi.mock("../../../localDb/mediaAssets", () => ({
  loadMediaAssetRecord: mocks.loadMediaAssetRecordMock,
}));

vi.mock("../../../localDb/mediaTransfers", () => ({
  loadMediaBlobCacheRecord: mocks.loadMediaBlobCacheRecordMock,
  loadMediaUploadTransfersForWorkspaceMediaAssets: mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock,
  markMediaUploadTransferDueForRetry: mocks.markMediaUploadTransferDueForRetryMock,
  writeMediaBlobCacheRecord: mocks.writeMediaBlobCacheRecordMock,
}));

import { CardFormScreen } from "./CardFormScreen";

export type MutableCardFormScreenAppData = {
  activeWorkspace: Readonly<{
    workspaceId: string;
    name: string;
    createdAt: string;
    isSelected: boolean;
  }>;
  cloudSettings: null;
  createCardItem: ReturnType<typeof vi.fn>;
  deleteCardItem: ReturnType<typeof vi.fn>;
  localReadVersion: number;
  runMediaUploadTransfers: ReturnType<typeof vi.fn>;
  session: null;
  setErrorMessage: ReturnType<typeof vi.fn>;
  updateCardItem: ReturnType<typeof vi.fn>;
};

export function makeCard(frontText: string, backText: string, tags: ReadonlyArray<string>): Card {
  const timestamp = "2026-03-10T09:00:00.000Z";
  return {
    cardId: "card-media-lifecycle",
    frontText,
    backText,
    cardType: "basic",
    metadata: {
      version: 1,
      source: null,
    },
    tags,
    dueAt: null,
    createdAt: timestamp,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: timestamp,
    lastModifiedByReplicaId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function setTextFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = field instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export async function setTextFieldValueAsync(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    setTextFieldValue(field, value);
  });
}

export async function clickElementAsync(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export type DeferredPromise<Result> = Readonly<{
  promise: Promise<Result>;
  resolve: (value: Result) => void;
}>;

export function createDeferredPromise<Result>(): DeferredPromise<Result> {
  let resolvePromise: ((value: Result) => void) | null = null;
  const promise = new Promise<Result>((resolve) => {
    resolvePromise = (value: Result): void => {
      resolve(value);
    };
  });
  if (resolvePromise === null) {
    throw new Error("Deferred promise resolver was not initialized");
  }

  return {
    promise,
    resolve: resolvePromise,
  };
}

type CardFormScreenTestHarness = Readonly<{
  getAppData: () => MutableCardFormScreenAppData;
  getContainer: () => HTMLDivElement;
  renderScreenAt: (initialEntry: string, adjacentContent: ReactNode) => Promise<void>;
}>;

export function setupCardFormScreenTest(): CardFormScreenTestHarness {
  let appData: MutableCardFormScreenAppData;
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

    mocks.deleteCardItemMock.mockReset();
    mocks.handoffCardToAiMock.mockReset();
    mocks.loadCardByIdMock.mockReset();
    mocks.loadMediaAssetRecordMock.mockReset();
    mocks.loadMediaBlobCacheRecordMock.mockReset();
    mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock.mockReset();
    mocks.loadWorkspaceTagsSummaryMock.mockReset();
    mocks.markMediaUploadTransferDueForRetryMock.mockReset();
    mocks.showCapturedTechnicalErrorMock.mockReset();
    mocks.updateCardItemMock.mockReset();
    mocks.useAppDataMock.mockReset();
    mocks.writeMediaBlobCacheRecordMock.mockReset();
    mocks.loadMediaAssetRecordMock.mockResolvedValue(null);
    mocks.handoffCardToAiMock.mockResolvedValue(true);
    mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock.mockResolvedValue([]);
    mocks.loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [{ tag: "grammar", cardsCount: 1 }],
      totalCards: 1,
    });

    appData = {
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Workspace",
        createdAt: "2026-03-10T09:00:00.000Z",
        isSelected: true,
      },
      cloudSettings: null,
      createCardItem: vi.fn(),
      deleteCardItem: mocks.deleteCardItemMock,
      localReadVersion: 0,
      runMediaUploadTransfers: vi.fn(),
      session: null,
      setErrorMessage: vi.fn(),
      updateCardItem: mocks.updateCardItemMock,
    };
    mocks.useAppDataMock.mockImplementation(() => appData);

    container = document.createElement("div");
    document.body.append(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderScreenAt(
    initialEntry: string,
    adjacentContent: ReactNode,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            {adjacentContent}
            <Routes>
              <Route path="/cards/new" element={<CardFormScreen />} />
              <Route path="/cards/:cardId" element={<CardFormScreen />} />
              <Route path="/cards" element={<div />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  function getAppData(): MutableCardFormScreenAppData {
    return appData;
  }

  function getContainer(): HTMLDivElement {
    return container;
  }

  return {
    getAppData,
    getContainer,
    renderScreenAt,
  };
}
