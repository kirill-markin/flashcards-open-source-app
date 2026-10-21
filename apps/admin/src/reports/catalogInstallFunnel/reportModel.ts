import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import type { FunnelStage } from "../funnels/FunnelStepsChart";
import { firstLaunchEngagedReviewThreshold } from "../firstLaunchFunnel/query";
import type { CatalogInstallFunnelReport } from "./query";

const funnelMainStepIds = [
  "deck-page-view",
  "install-click",
  "installed",
  "one-review",
  "two-reviews",
  "two-review-days",
  "engaged-returning",
] as const;

type FunnelMainStepId = (typeof funnelMainStepIds)[number];

export const catalogInstallFunnelAnchor: FunnelAnchor<FunnelMainStepId> = {
  funnelId: "deck",
  stepIds: funnelMainStepIds,
};

export type CatalogInstallFunnelReportModel = Readonly<{
  mainStages: ReadonlyArray<FunnelStage<FunnelMainStepId>>;
  hasEntries: boolean;
}>;

function buildMainStages(report: CatalogInstallFunnelReport): ReadonlyArray<FunnelStage<FunnelMainStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelMainStepIds`,
  // which is also where the URL codec reads its default, the first step.
  const steps: Readonly<Record<FunnelMainStepId, Readonly<{ label: string; count: number }>>> = {
    "deck-page-view": { label: "Viewed any deck page", count: report.deckPageViewerCount },
    "install-click": { label: "Install clicked", count: report.installClickerCount },
    installed: { label: "Installed (server)", count: report.installerCount },
    "one-review": { label: "1+ review", count: report.oneReviewInstallerCount },
    "two-reviews": { label: "2+ reviews", count: report.twoReviewsInstallerCount },
    "two-review-days": { label: "Reviews on 2+ days", count: report.twoReviewDaysInstallerCount },
    "engaged-returning": {
      label: `${firstLaunchEngagedReviewThreshold}+ reviews on 3+ days`,
      count: report.engagedReturningInstallerCount,
    },
  };

  return funnelMainStepIds.map((id) => ({ id, ...steps[id] }));
}

export function buildCatalogInstallFunnelReportModel(
  report: CatalogInstallFunnelReport,
): CatalogInstallFunnelReportModel {
  const mainStages = buildMainStages(report);
  return {
    mainStages,
    // The steps are counted independently, so any of them can hold people while the first is empty.
    hasEntries: mainStages.some((stage) => stage.count > 0),
  };
}
