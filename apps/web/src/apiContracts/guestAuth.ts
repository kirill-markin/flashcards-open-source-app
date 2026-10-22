import { parseWorkspaceEnvelopeResponse } from "./account";
import { ApiContractError, parseBoolean, parseEnum, parseLiteral, parseNullableString, parseObject, parseRequiredField, parseString, parseStringArray } from "./core";
import type { WorkspaceSummary } from "../types";

export type WebGuestSessionEnvelope = Readonly<{ guestToken: string; userId: string }>;

type GuestCookieMetadata = Readonly<{ csrfToken: string | null; cookieRoundTripVerified: boolean }>;
export type BrowserGuestSession = GuestCookieMetadata & (
  | Readonly<{ status: "absent" | "invalid" | "revoked" }>
  | Readonly<{ status: "active"; sessionId: string; userId: string; workspaceId: string; purpose: "browser_product"; platform: "web" }>
  | Readonly<{ status: "pending_upgrade"; sessionId: string; userId: string; workspaceId: null }> & (
    | Readonly<{ purpose: "browser_product"; platform: "web"; replayOnly?: false }>
    | Readonly<{ purpose: null; platform: null; replayOnly: true }>
  )
);
export type BrowserGuestProbe = Readonly<{
  registeredSession: Readonly<{ present: boolean; csrfToken: string | null }>;
  guestSession: BrowserGuestSession;
}>;
export type BrowserGuestUpgradePreparation = Readonly<{ mode: "bound" | "merge_required"; demoOnlyDestinationWorkspaceId?: string }>;
export type GuestUpgradeSelection = Readonly<{ type: "existing"; workspaceId: string; discardDemoOnly?: boolean }> | Readonly<{ type: "create_new"; name?: string }>;
export type BrowserGuestUpgradeResult = Readonly<{
  workspace: WorkspaceSummary;
  droppedEntities?: Readonly<{ cardIds: ReadonlyArray<string>; deckIds: ReadonlyArray<string>; reviewEventIds: ReadonlyArray<string>; mediaAssetIds?: ReadonlyArray<string> }>;
}>;

export function parseBrowserGuestProbe(value: unknown, endpoint: string): BrowserGuestProbe {
  const root = parseObject(value, endpoint, "");
  const registered = parseObject(root.registeredSession, endpoint, "registeredSession");
  const guest = parseObject(root.guestSession, endpoint, "guestSession");
  const status = parseEnum(guest.status, endpoint, "guestSession.status", ["absent", "invalid", "revoked", "active", "pending_upgrade"] as const);
  const metadata = {
    csrfToken: parseRequiredField(guest, "csrfToken", endpoint, "guestSession", parseNullableString),
    cookieRoundTripVerified: parseRequiredField(guest, "cookieRoundTripVerified", endpoint, "guestSession", parseBoolean),
  };
  const registeredSession = {
    present: parseRequiredField(registered, "present", endpoint, "registeredSession", parseBoolean),
    csrfToken: parseRequiredField(registered, "csrfToken", endpoint, "registeredSession", parseNullableString),
  };
  if (status === "absent" || status === "invalid" || status === "revoked") {
    return { registeredSession, guestSession: { ...metadata, status } };
  }
  const identity = {
    sessionId: parseRequiredField(guest, "sessionId", endpoint, "guestSession", parseString),
    userId: parseRequiredField(guest, "userId", endpoint, "guestSession", parseString),
  };
  if (status === "pending_upgrade" && guest.replayOnly === true) {
    if (guest.purpose !== null || guest.platform !== null || guest.workspaceId !== null) {
      throw new ApiContractError(endpoint, "guestSession", "history-only pending guest with null provenance");
    }
    return { registeredSession, guestSession: { ...metadata, ...identity, status, purpose: null, platform: null, workspaceId: null, replayOnly: true } };
  }
  const provenance = {
    purpose: parseLiteral(guest.purpose, endpoint, "guestSession.purpose", "browser_product"),
    platform: parseLiteral(guest.platform, endpoint, "guestSession.platform", "web"),
  };
  if (status === "pending_upgrade") {
    parseLiteral(guest.workspaceId, endpoint, "guestSession.workspaceId", null);
    return { registeredSession, guestSession: { ...metadata, ...identity, ...provenance, status, workspaceId: null } };
  }
  return { registeredSession, guestSession: { ...metadata, ...identity, ...provenance, status, workspaceId: parseString(guest.workspaceId, endpoint, "guestSession.workspaceId") } };
}

export function parseBrowserGuestPrepare(value: unknown, endpoint: string): BrowserGuestUpgradePreparation {
  const object = parseObject(value, endpoint, "");
  const mode = parseEnum(object.mode, endpoint, "mode", ["bound", "merge_required"] as const);
  if (object.demoOnlyDestinationWorkspaceId === undefined) return { mode };
  const workspaceId = parseString(object.demoOnlyDestinationWorkspaceId, endpoint, "demoOnlyDestinationWorkspaceId");
  if (mode !== "merge_required" || workspaceId.trim() === "") {
    throw new ApiContractError(endpoint, "demoOnlyDestinationWorkspaceId", "non-empty workspace ID in merge_required mode");
  }
  return { mode, demoOnlyDestinationWorkspaceId: workspaceId };
}

export function parseBrowserGuestUpgradeResult(value: unknown, endpoint: string): BrowserGuestUpgradeResult {
  const object = parseObject(value, endpoint, "");
  const workspace = parseWorkspaceEnvelopeResponse(value, endpoint).workspace;
  if (object.droppedEntities === undefined) return { workspace };
  const drops = parseObject(object.droppedEntities, endpoint, "droppedEntities");
  return { workspace, droppedEntities: {
    cardIds: parseRequiredField(drops, "cardIds", endpoint, "droppedEntities", parseStringArray),
    deckIds: parseRequiredField(drops, "deckIds", endpoint, "droppedEntities", parseStringArray),
    reviewEventIds: parseRequiredField(drops, "reviewEventIds", endpoint, "droppedEntities", parseStringArray),
    ...(drops.mediaAssetIds === undefined ? {} : { mediaAssetIds: parseStringArray(drops.mediaAssetIds, endpoint, "droppedEntities.mediaAssetIds") }),
  } };
}
