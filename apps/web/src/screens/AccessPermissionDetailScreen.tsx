import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  browserPermissionSettingsGuidance,
  explainBrowserMediaPermissionError,
  formatBrowserPermissionState,
  queryBrowserPermissionState,
  requestBrowserMediaPermission,
  type BrowserMediaPermissionKind,
  type BrowserPermissionState,
} from "../access/browserAccess";
import { SettingsShell } from "./SettingsShared";

type AccessDetailKind = "camera" | "microphone" | "photos-and-files";

type AccessDetailContent = Readonly<{
  title: string;
  description: string;
  status: string;
  actionLabel: string | null;
}>;

function isBrowserMediaPermissionKind(kind: AccessDetailKind): kind is BrowserMediaPermissionKind {
  return kind === "camera" || kind === "microphone";
}

function parseAccessDetailKind(value: string | undefined): AccessDetailKind {
  if (value === "camera" || value === "microphone" || value === "photos-and-files") {
    return value;
  }

  throw new Error("Unknown access detail kind");
}

function buildAccessDetailContent(kind: AccessDetailKind, state: BrowserPermissionState): AccessDetailContent {
  if (kind === "photos-and-files") {
    return {
      title: "Photos and files",
      description: "Browsers do not grant persistent photo-library access here. You choose files each time from the picker.",
      status: "Per action",
      actionLabel: null,
    };
  }

  return {
    title: kind === "camera" ? "Camera" : "Microphone",
    description: browserPermissionSettingsGuidance(kind),
    status: formatBrowserPermissionState(state),
    actionLabel: state === "denied" ? null : "Request access",
  };
}

export function AccessPermissionDetailScreen(): ReactElement {
  const params = useParams();
  const kind = parseAccessDetailKind(params.accessKind);
  const [permissionState, setPermissionState] = useState<BrowserPermissionState>("unsupported");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (isBrowserMediaPermissionKind(kind) === false) {
      setPermissionState("unsupported");
      return;
    }

    const mediaKind: BrowserMediaPermissionKind = kind;
    let isCancelled = false;
    async function loadPermissionState(): Promise<void> {
      const nextState = await queryBrowserPermissionState(mediaKind);
      if (isCancelled) {
        return;
      }

      setPermissionState(nextState);
    }

    void loadPermissionState();
    return () => {
      isCancelled = true;
    };
  }, [kind]);

  const content = buildAccessDetailContent(kind, permissionState);

  async function handleRequestAccess(): Promise<void> {
    if (isBrowserMediaPermissionKind(kind) === false) {
      return;
    }

    const mediaKind: BrowserMediaPermissionKind = kind;
    try {
      await requestBrowserMediaPermission(mediaKind);
      setPermissionState(await queryBrowserPermissionState(mediaKind));
      setErrorMessage("");
    } catch (error) {
      const nextState = await queryBrowserPermissionState(mediaKind);
      setPermissionState(nextState);
      setErrorMessage(explainBrowserMediaPermissionError(mediaKind, error, nextState));
    }
  }

  return (
    <SettingsShell
      title={content.title}
      subtitle={content.description}
      activeTab="access"
    >
      {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}

      <article className="content-card settings-summary-card">
        <span className="cell-secondary">Status</span>
        <strong className="panel-subtitle">{content.status}</strong>
      </article>

      {content.actionLabel !== null ? (
        <div className="screen-actions">
          <button className="primary-btn" type="button" onClick={() => void handleRequestAccess()}>
            {content.actionLabel}
          </button>
        </div>
      ) : null}
    </SettingsShell>
  );
}
