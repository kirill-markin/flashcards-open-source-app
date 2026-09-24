import { splitWorkspaceRoutePath } from "../../../routes";
import type { WorkspaceSummary } from "../../../types";

export const defaultWorkspaceName: string = "Personal";

/**
 * The workspace the browser arrived naming, read off the pathname this document was opened on while
 * this module evaluates — before React mounts anything, so nothing the app itself navigates to can
 * reach it. Reading `window.location` any later reads the app's own output: `AppDataProvider` starts
 * at `sessionLoadState === "ready"` whenever a warm-start snapshot exists, so the shell renders and
 * `LegacyFlatPathRedirect` rewrites a flat path into `/w/<active workspace>/…` well before
 * `initialize()` resolves, and activation would be handed back the answer it is supposed to decide.
 * `vite.config.ts` runs the web tests under `jsdom`, so `window` answers on every import path.
 *
 * Lowercased by `splitWorkspaceRoutePath`, while `buildWorkspaceRoute` and the server both keep the
 * case they were given, so every comparison against a stored id goes through `findEntryWorkspace`.
 */
const entryWorkspaceId: string | null = splitWorkspaceRoutePath(window.location.pathname).workspaceId;

export function readEntryWorkspaceId(): string | null {
  return entryWorkspaceId;
}

/**
 * The workspace the entry address names, out of a list that holds it under whatever case the server
 * sent. `warmStart.ts` matches its snapshot through this same function, so aligning the snapshot and
 * resolving the initial workspace can never disagree about which workspace was asked for.
 */
export function findEntryWorkspace(workspaces: ReadonlyArray<WorkspaceSummary>): WorkspaceSummary | null {
  if (entryWorkspaceId === null) {
    return null;
  }

  return workspaces.find((workspace) => workspace.workspaceId.toLowerCase() === entryWorkspaceId) ?? null;
}

/**
 * What the entry address did with its one chance to decide the workspace — the single model this
 * whole feature is expressed in, rather than a consumed boolean each caller re-derives. The address
 * is authoritative for the first activation of the document and for nothing else, and every rule
 * about it is a state here rather than a guard of its own:
 *
 * - `unused`: nothing has consulted the address yet. Only from here does it steer an activation.
 * - `activating`: the run that arrived first is awaiting the activation, and its promise is held so
 *   an overlapping run joins that one instead of firing a second activation of the same workspace.
 *   React 19 `StrictMode` double-invokes the mount effect that calls `initialize()`, so overlapping
 *   runs are every `npm run dev` session rather than an edge case.
 * - `activated`: the address put this account in the workspace it names. A second
 *   `resolveInitialWorkspace` — the `sessionLoadState === "error"` retry, `AccountDeletionRecovery-
 *   Gate`, a non-overlapping `StrictMode` remount — resolves to that same workspace again, so it
 *   republishes the session state it exists to publish without relocating anybody.
 * - `unavailable`: the address named a workspace the account's list does not hold. This is the only
 *   thing the gate in `App.tsx` reads, and it is recorded against the list the server answered with,
 *   never against the warm-start snapshot, so a stale snapshot cannot raise the panel.
 * - `retired`: the address has stopped being authoritative. A stored selection puts it here from
 *   wherever the address was, `unavailable` included — `chooseWorkspace`, `createWorkspace` and
 *   `deleteWorkspace` in `useWorkspaceActions.ts`, and the first default `resolveInitialWorkspace`
 *   persists for the workspace the address just activated — each of which moves the server-side
 *   default the address was competing with: that change is the newer answer, and without this the
 *   workspace picker would be answered with the unavailable panel, the address would never realign
 *   to the picked workspace, and a second `resolveInitialWorkspace` would relocate the account off
 *   the workspace it just created or raise the panel over a deletion it just performed. One call
 *   site is the exception: the first default `resolveInitialWorkspace` persists for the account's
 *   single workspace when the address named a different one deliberately does not retire, because
 *   retiring there would flip `isEntryWorkspaceUnavailable()` back to `false`, suppress the panel in
 *   `App.tsx`, and drop the user silently into their own workspace instead of telling them the
 *   address names one they cannot open. A user-driven selection retires from `unavailable` too, for
 *   the reason the picker gives above.
 *
 * A rejected activation returns to `unused` and records nothing, so the retry button resolves to the
 * workspace the link named rather than dropping the user on the account default.
 *
 * `activating` and `activated` carry whether the workspace the address named was the account's own
 * server-side default anyway, because only an activation that moved off that default is one
 * `storeWarmStartSnapshot` must refuse: that activation leaves the stored default where it was, so
 * persisting it would paint the link's workspace on the next open at an address with no `/w/`
 * segment — where nothing repoints it — until `initialize()` resolves the account default and it
 * visibly snaps back. An address naming the default is the ordinary shape of every reload once the
 * app has rewritten its own path, and refusing those too would freeze the snapshot for good.
 *
 * A first default that fails to persist leaves `activated` with `overridesAccountDefault: true`
 * although the server then holds no competing default at all, so that document refuses every
 * snapshot write. Accepted residual: the cost is one document's cold first paint, and the next open
 * resolves the default and writes again.
 *
 * An account switch retires the address wherever it is noticed, because the user id it was used for
 * is part of this record: `revalidateActiveSession` resolves the initial workspace again for the
 * account that just arrived, and that account is not the one the address was written for. Keyed here
 * rather than checked at that call site, so the rule holds for any future caller too.
 *
 * Module state rather than React state, because the three readers are not one component:
 * `warmStart.ts` runs outside React entirely, the gate reads the outcome from `App.tsx`, and
 * activation writes it from the session layer. It only ever changes alongside a session state update
 * that re-renders, so a reader in render sees it settled.
 */
type EntryWorkspaceActivation =
  | Readonly<{ status: "unused" }>
  | Readonly<{ status: "activating"; userId: string; activation: Promise<void>; overridesAccountDefault: boolean }>
  | Readonly<{ status: "activated"; userId: string; overridesAccountDefault: boolean }>
  | Readonly<{ status: "unavailable"; userId: string }>
  | Readonly<{ status: "retired" }>;

let entryWorkspaceActivation: EntryWorkspaceActivation = { status: "unused" };

/** Exhaustive over the union so a state added later has to answer whose account it belongs to. */
function readActivationUserId(activation: EntryWorkspaceActivation): string | null {
  switch (activation.status) {
    case "activating":
    case "activated":
    case "unavailable":
      return activation.userId;
    case "unused":
    case "retired":
      return null;
  }
}

/** Whether the entry address named a workspace the account that resolved it cannot open. */
export function isEntryWorkspaceUnavailable(): boolean {
  return entryWorkspaceActivation.status === "unavailable";
}

/**
 * Whether what is published right now is a workspace the entry address put the account in over its
 * own server-side default. `activating` counts: the activation publishes its workspace before the
 * promise settles, so a reader can observe that state while this still holds. `unavailable` does
 * not: there the account default was resolved the usual way.
 */
export function didEntryAddressOverrideAccountDefault(): boolean {
  switch (entryWorkspaceActivation.status) {
    case "activating":
    case "activated":
      return entryWorkspaceActivation.overridesAccountDefault;
    case "unused":
    case "unavailable":
    case "retired":
      return false;
  }
}

export function retireEntryWorkspaceAddress(): void {
  entryWorkspaceActivation = { status: "retired" };
}

/**
 * Activates the workspace the entry address names when this account can open it, and reports whether
 * it did — `false` leaves the caller to resolve the workspace the way it does without a link.
 *
 * Activation moves the account's server-side selection only when the account had none:
 * `POST /workspaces/:id/select` is not called over an existing default, because that selection is
 * the account default iOS and Android read too and following somebody's link is not the explicit
 * choice it records. The one account it is called for is the one whose single workspace was never
 * selected, which would otherwise keep answering `selectedWorkspaceId: null` to those clients
 * forever; the caller does that write and retires the address with it, so from then on the address
 * and the default name the same workspace.
 *
 * `workspaces` must be the list the server just answered with, before `publishSelectedWorkspace`
 * re-marks it: `isSelected` on that list is the only place the account's server-side default is
 * read from. A list taken from React state is already re-marked to whatever is active, so it would
 * report `overridesAccountDefault: false` for a workspace the address activated over the account
 * default, and `storeWarmStartSnapshot` would persist somebody else's link for the next open.
 */
export async function activateEntryWorkspace(
  userId: string,
  workspaces: ReadonlyArray<WorkspaceSummary>,
  activate: (workspace: WorkspaceSummary) => Promise<void>,
): Promise<boolean> {
  if (entryWorkspaceId === null || entryWorkspaceActivation.status === "retired") {
    return false;
  }

  const activationUserId = readActivationUserId(entryWorkspaceActivation);
  if (activationUserId !== null && activationUserId !== userId) {
    retireEntryWorkspaceAddress();
    return false;
  }

  if (entryWorkspaceActivation.status === "activating") {
    await entryWorkspaceActivation.activation;
    return true;
  }

  const entryWorkspace = findEntryWorkspace(workspaces);
  if (entryWorkspace === null) {
    entryWorkspaceActivation = { status: "unavailable", userId };
    return false;
  }

  // The server's own mark on the list this run fetched, read before `publishSelectedWorkspace`
  // re-marks it locally: `false` means this activation moves the account off the workspace it would
  // have resolved to without the address, which is the whole of what must not be persisted.
  const overridesAccountDefault = entryWorkspace.isSelected === false;

  // Published before the first await, which is what an overlapping run joins instead of activating
  // the same workspace a second time.
  const activation = activate(entryWorkspace);
  entryWorkspaceActivation = { status: "activating", userId, activation, overridesAccountDefault };
  try {
    await activation;
  } catch (error) {
    entryWorkspaceActivation = { status: "unused" };
    throw error;
  }

  entryWorkspaceActivation = { status: "activated", userId, overridesAccountDefault };
  return true;
}
