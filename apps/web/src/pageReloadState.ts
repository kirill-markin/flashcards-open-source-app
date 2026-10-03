// Leaf module: importing observability or reload code here would close an
// import cycle through `observability/instrument.ts`.
let staleBundleReloadScheduled = false;

export function markStaleBundleReloadScheduled(): void {
  staleBundleReloadScheduled = true;
}

export function isStaleBundleReloadScheduled(): boolean {
  return staleBundleReloadScheduled;
}
