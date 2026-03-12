import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  browserPermissionSettingsGuidance,
  formatBrowserPermissionState,
  queryBrowserPermissionState,
  type BrowserPermissionState,
} from "../access/browserAccess";
import { buildSettingsAccessDetailRoute } from "../routes";

type BrowserAccessSummaryCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  to: string;
}>;

type BrowserPermissionSnapshot = Readonly<{
  camera: BrowserPermissionState;
  microphone: BrowserPermissionState;
}>;

function BrowserAccessSummaryCard(props: BrowserAccessSummaryCardProps): ReactElement {
  const { title, description, value, to } = props;

  return (
    <Link className="settings-nav-card content-card" to={to}>
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
      <span className="badge">{value}</span>
    </Link>
  );
}

export function AccessSettingsScreen(): ReactElement {
  const [permissionSnapshot, setPermissionSnapshot] = useState<BrowserPermissionSnapshot>({
    camera: "unsupported",
    microphone: "unsupported",
  });

  useEffect(() => {
    let isCancelled = false;

    async function loadPermissions(): Promise<void> {
      const [camera, microphone] = await Promise.all([
        queryBrowserPermissionState("camera"),
        queryBrowserPermissionState("microphone"),
      ]);
      if (isCancelled) {
        return;
      }

      setPermissionSnapshot({ camera, microphone });
    }

    void loadPermissions();
    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <main className="container settings-page">
      <section className="panel settings-panel">
        <div className="screen-head">
          <div>
            <h1 className="panel-subtitle">Access</h1>
            <p className="subtitle">Review which browser permissions the chat and attachments can use on this device.</p>
          </div>
        </div>

        <div className="settings-nav-list">
          <BrowserAccessSummaryCard
            title="Photos and files"
            description="Browser file access is granted only when you choose files from the picker."
            value="Per action"
            to={buildSettingsAccessDetailRoute("photos-and-files")}
          />
          <BrowserAccessSummaryCard
            title="Camera"
            description={browserPermissionSettingsGuidance("camera")}
            value={formatBrowserPermissionState(permissionSnapshot.camera)}
            to={buildSettingsAccessDetailRoute("camera")}
          />
          <BrowserAccessSummaryCard
            title="Microphone"
            description={browserPermissionSettingsGuidance("microphone")}
            value={formatBrowserPermissionState(permissionSnapshot.microphone)}
            to={buildSettingsAccessDetailRoute("microphone")}
          />
        </div>
      </section>
    </main>
  );
}
