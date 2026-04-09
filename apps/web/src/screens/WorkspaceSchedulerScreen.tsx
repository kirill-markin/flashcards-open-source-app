import type { ReactElement } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { SettingsShell } from "./SettingsShared";

function formatStepList(
  steps: ReadonlyArray<number>,
  formatNumber: (value: number) => string,
): string {
  return steps.map((step) => formatNumber(step)).join(", ");
}

export function WorkspaceSchedulerScreen(): ReactElement {
  const { workspaceSettings } = useAppData();
  const { t, formatDateTime, formatNumber } = useI18n();

  return (
    <SettingsShell
      title={t("workspaceScheduler.title")}
      subtitle={t("workspaceScheduler.subtitle")}
      activeTab="workspace"
    >
      {workspaceSettings === null ? (
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("workspaceScheduler.schedulerLabel")}</span>
          <strong className="panel-subtitle">{t("common.unavailable")}</strong>
        </article>
      ) : (
        <div className="settings-detail-grid">
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.algorithm")}</span>
            <strong className="panel-subtitle">{workspaceSettings.algorithm.toUpperCase()}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.desiredRetention")}</span>
            <strong className="panel-subtitle">{formatNumber(workspaceSettings.desiredRetention)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.learningSteps")}</span>
            <strong className="panel-subtitle">{formatStepList(workspaceSettings.learningStepsMinutes, formatNumber)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.relearningSteps")}</span>
            <strong className="panel-subtitle">{formatStepList(workspaceSettings.relearningStepsMinutes, formatNumber)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.maximumInterval")}</span>
            <strong className="panel-subtitle">
              {t("workspaceScheduler.maximumIntervalDays", {
                count: formatNumber(workspaceSettings.maximumIntervalDays),
              })}
            </strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.enableFuzz")}</span>
            <strong className="panel-subtitle">{workspaceSettings.enableFuzz ? t("common.enabled") : t("common.disabled")}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.updated")}</span>
            <strong className="panel-subtitle txn-cell-mono">{formatDateTime(workspaceSettings.updatedAt)}</strong>
          </article>
          <article className="content-card content-card-muted settings-summary-card">
            <span className="cell-secondary">{t("workspaceScheduler.labels.note")}</span>
            <p className="subtitle">{t("workspaceScheduler.note")}</p>
          </article>
        </div>
      )}
    </SettingsShell>
  );
}
