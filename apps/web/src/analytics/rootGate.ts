import { isAuthenticatedAppPath } from "../routes";
import type { AnalyticsSurface } from "./events";

/**
 * What is on display in place of the route's own screen, for the one reader that has to know:
 * the route-driven `screen_viewed` in `AnalyticsLifecycle`.
 *
 * - `undecided`: nothing has answered yet whether a gate will replace the route, so the route's
 *   screen may never render. Nothing is reported from here, because `analytics.product_events` is
 *   append-only and has no repair path for a screen view that never happened.
 * - `open`: no gate stands, so the route's own screen is what is rendering and reports itself.
 * - `gated`: a gate replaced the app root, and `surface` is what that gate reports. `null` is a gate
 *   no value in the closed cross-client `screen` enum names: it reports nothing and leaves no
 *   surface standing for the events tracked underneath it.
 * - `gated_keeping_route_stamp`: the same gate, except that the route's own surface is the standing
 *   stamp, re-asserted on arrival here so a take-down by the gate before it cannot outlive that
 *   gate. A gate that is the route's own loading or error state belongs here,
 *   because the catalog keeps those on the surface of the route they belong to: the events tracked
 *   while one stands — a `warm` `app_opened` on a tab return, queue maintenance — carry that route
 *   rather than no screen. It reports no view all the same, the route's screen having not rendered.
 *
 * `App.tsx` is the only publisher and `resolveRootGateReport` there is the only decision, so a gate
 * added to that shell cannot report by omission the way one taking the route's surface down after
 * the fact could.
 */
export type AnalyticsRootGate =
  | Readonly<{ status: "undecided" }>
  | Readonly<{ status: "open" }>
  | Readonly<{ status: "gated"; surface: AnalyticsSurface | null }>
  | Readonly<{ status: "gated_keeping_route_stamp" }>;

/**
 * What the document knows it owes an answer about before it has rendered anything: whether a shell
 * will mount on this address at all and gate it. `AuthenticatedApp` is the only element that mounts
 * one, it serves every path `isAuthenticatedAppPath` accepts, and on a cold load with no warm
 * snapshot the only thing it renders is the full-screen loading panel — so on `/`, on the legacy
 * flat paths, under `/w/<workspace>` and under a `/w/<segment>` this build does not recognise alike,
 * a report sent before that shell has answered names a screen that may never render.
 *
 * Every other address starts decided and reports on the first commit exactly as it did before this
 * signal existed: the public routes, where no shell ever mounts to publish anything, so an address
 * started undecided there would never report at all.
 *
 * Read while this module evaluates, before React mounts anything, so nothing the app itself
 * navigates to afterwards can reach it. `vite.config.ts` runs the web tests under `jsdom`, so
 * `window` answers on every import path.
 *
 * Latched once, which makes it right only while no public route reaches an authenticated address by
 * client-side navigation. None does today, and it was checked: the catalog success panel hands out
 * an absolute `webHref` built from `getAppConfig().appBaseUrl`, `FriendInviteScreen` uses an
 * `<a href>`, and `CatalogImportAuthenticatedFlow` mounts its own `AppDataProvider` without
 * `AppShell`, so the document is replaced rather than navigated. A `<Link to>` or `navigate()` added
 * from `/catalog/import/:id`, `/invite/:token` or `/share` into `/w/<id>/…` would carry this `open`
 * across the authenticated mount and have the destination route report itself on the first commit
 * while the shell's gate is still up — exactly the phantom view this signal exists to prevent.
 * Resetting the latch on a mount or an unmount is not the remedy; that was weighed and rejected for
 * the dev-only StrictMode interleaving it introduces.
 */
let currentRootGate: AnalyticsRootGate = isAuthenticatedAppPath(window.location.pathname)
  ? { status: "undecided" }
  : { status: "open" };

const rootGateListeners = new Set<() => void>();

function isSameRootGate(left: AnalyticsRootGate, right: AnalyticsRootGate): boolean {
  if (left.status === "gated" && right.status === "gated") {
    return left.surface === right.surface;
  }

  return left.status === right.status;
}

/**
 * The one writer. Publishing the value already held changes nothing and notifies nobody, so the
 * publisher can call this on every render of a shell that re-renders for its own reasons.
 */
export function publishAnalyticsRootGate(gate: AnalyticsRootGate): void {
  if (isSameRootGate(currentRootGate, gate)) {
    return;
  }

  currentRootGate = gate;
  for (const listener of rootGateListeners) {
    listener();
  }
}

export function subscribeToAnalyticsRootGate(listener: () => void): () => void {
  rootGateListeners.add(listener);
  return function unsubscribeFromAnalyticsRootGate(): void {
    rootGateListeners.delete(listener);
  };
}

/** Held rather than rebuilt per call, which is what `useSyncExternalStore` requires of a snapshot. */
export function readAnalyticsRootGate(): AnalyticsRootGate {
  return currentRootGate;
}
