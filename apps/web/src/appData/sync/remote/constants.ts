export const syncIncrementalPageSize = 500;
export const syncBootstrapPageSize = 1000;
// Normal cold-start fresh single-page bootstraps run ~6.5s (server/network latency), which is expected; multi-page bootstraps still warn via pageCount > 1.
export const slowHotBootstrapWarningThresholdMs = 8000;
// Floor for the tolerated-slow breadcrumb: single-page bootstraps in the 2–8s band emit a silent breadcrumb (no Sentry issue) for debugging context, staying below the 8000ms warning threshold.
export const slowHotBootstrapBreadcrumbThresholdMs = 2000;
