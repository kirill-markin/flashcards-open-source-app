import type { ReactElement } from "react";
import { useAppData } from "../appData";
import { SettingsShell } from "./SettingsShared";

function formatStepList(steps: ReadonlyArray<number>): string {
  return steps.join(", ");
}

export function WorkspaceSchedulerScreen(): ReactElement {
  const { workspaceSettings } = useAppData();

  return (
    <SettingsShell
      title="Scheduler"
      subtitle="Review the scheduler configuration used for future reviews."
      activeTab="workspace"
    >
      {workspaceSettings === null ? (
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Scheduler</span>
          <strong className="panel-subtitle">Unavailable</strong>
        </article>
      ) : (
        <div className="settings-detail-grid">
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Algorithm</span>
            <strong className="panel-subtitle">{workspaceSettings.algorithm.toUpperCase()}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Desired retention</span>
            <strong className="panel-subtitle">{workspaceSettings.desiredRetention}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Learning steps</span>
            <strong className="panel-subtitle">{formatStepList(workspaceSettings.learningStepsMinutes)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Relearning steps</span>
            <strong className="panel-subtitle">{formatStepList(workspaceSettings.relearningStepsMinutes)}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Maximum interval</span>
            <strong className="panel-subtitle">{workspaceSettings.maximumIntervalDays} days</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Enable fuzz</span>
            <strong className="panel-subtitle">{workspaceSettings.enableFuzz ? "Enabled" : "Disabled"}</strong>
          </article>
          <article className="content-card settings-summary-card">
            <span className="cell-secondary">Updated</span>
            <strong className="panel-subtitle txn-cell-mono">{workspaceSettings.updatedAt}</strong>
          </article>
          <article className="content-card content-card-muted settings-summary-card">
            <span className="cell-secondary">Note</span>
            <p className="subtitle">These settings affect future scheduling only. Existing card state remains authoritative.</p>
          </article>
        </div>
      )}
    </SettingsShell>
  );
}
