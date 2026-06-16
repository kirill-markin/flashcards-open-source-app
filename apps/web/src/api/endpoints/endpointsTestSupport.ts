import "fake-indexeddb/auto";
import { afterEach, beforeEach, vi } from "vitest";
import { createStorageMock, setNavigatorLanguages } from "../ApiTestSupport";
import { resetApiClientStateForTests } from "../transport/transport";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
  captureWebExceptionMock: vi.fn(),
  captureWebWarningMock: vi.fn(),
  setWebObservabilityUserMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
  captureWebException: observabilityMocks.captureWebExceptionMock,
  captureWebWarning: observabilityMocks.captureWebWarningMock,
  normalizeCaughtError: (error: unknown): Error => error instanceof Error ? error : new Error(`Caught non-Error value of type ${typeof error}`),
  setWebObservabilityUser: observabilityMocks.setWebObservabilityUserMock,
}));

function resetObservabilityMocks(): void {
  observabilityMocks.addWebBreadcrumbMock.mockReset();
  observabilityMocks.captureWebExceptionMock.mockReset();
  observabilityMocks.captureWebWarningMock.mockReset();
  observabilityMocks.setWebObservabilityUserMock.mockReset();
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  resetApiClientStateForTests();
  resetObservabilityMocks();
});

afterEach(() => {
  window.localStorage.clear();
  setNavigatorLanguages([], "");
  resetApiClientStateForTests();
  vi.restoreAllMocks();
});
