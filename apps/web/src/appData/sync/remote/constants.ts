export const syncIncrementalPageSize = 500;
export const syncBootstrapPageSize = 1000;
// Multi-page hot-state restores are normal when users have thousands of cards.
// Warnings should represent abnormal duration after accounting for restored volume.
export const slowHotBootstrapMinimumWarningThresholdMs = 8000;
export const slowHotBootstrapBaseWarningBudgetMs = 2000;
export const slowHotBootstrapPerPageWarningBudgetMs = 1500;
export const slowHotBootstrapPerEntryWarningBudgetMs = 1.5;
// Floor for the tolerated-slow breadcrumb: non-empty hot-state restores above this
// duration emit silent context when they stay below the volume-aware warning threshold.
export const slowHotBootstrapBreadcrumbThresholdMs = 2000;
