import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import type { FunnelStage } from "../funnels/FunnelStepsChart";
import type { CatalogInstallFunnelReport } from "./query";

const funnelMainStepIds = ["install-click", "installed", "one-review"] as const;
type FunnelMainStepId = (typeof funnelMainStepIds)[number];

export const catalogInstallFunnelAnchor: FunnelAnchor<FunnelMainStepId> = {
  funnelId: "deck",
  stepIds: funnelMainStepIds,
};

export type CatalogInstallFunnelReportModel = Readonly<{
  mainStages: ReadonlyArray<FunnelStage<FunnelMainStepId>>;
  hasEntries: boolean;
}>;

export function buildCatalogInstallFunnelReportModel(
  report: CatalogInstallFunnelReport,
): CatalogInstallFunnelReportModel {
  return {
    mainStages: [
      { id: "install-click", label: "First-ever identified click", count: report.cohortClickerCount },
      { id: "installed", label: "Clicked deck installed ≤24h", count: report.attributedInstallerCount },
      { id: "one-review", label: "Then 1+ review ≤24h", count: report.activatedClickerCount },
    ],
    hasEntries: report.cohortClickerCount > 0,
  };
}
