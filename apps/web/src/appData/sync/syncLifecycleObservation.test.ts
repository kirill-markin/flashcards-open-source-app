import { describe, expect, it, vi } from "vitest";
import { observeSlowHotBootstrap } from "./syncLifecycleObservation";

const observabilityMocks = vi.hoisted(() => ({
  captureWebWarningMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  captureWebWarning: observabilityMocks.captureWebWarningMock,
}));

describe("sync lifecycle observation", () => {
  it("includes page size and local bootstrap state in slow restore warnings", () => {
    observeSlowHotBootstrap({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      durationMs: 3000,
      pageSize: 500,
      pageCount: 5,
      entriesCount: 2026,
      localCardCountBefore: 0,
      localCardCountAfter: 1963,
      localBootstrapState: "no_sync_state_no_cards",
      lastAppliedHotChangeIdBefore: null,
      nextHotChangeId: 30147,
      remoteIsEmpty: false,
    });

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_restore_slow",
      details: expect.objectContaining({
        pageSize: 500,
        localBootstrapState: "no_sync_state_no_cards",
      }),
    }));
  });
});
