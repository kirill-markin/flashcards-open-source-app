import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  explainBrowserMediaPermissionError,
  isExpectedBrowserMediaPermissionError,
  queryBrowserPermissionState,
  requestBrowserMediaPermission,
  type BrowserMediaPermissionKind,
  type BrowserPermissionState,
} from "../../../access/browserAccess";
import { useAppData } from "../../../appData";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { type TranslationKey, useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

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

function permissionStateKey(state: BrowserPermissionState): TranslationKey {
  if (state === "granted") {
    return "accessSettings.permission.statusGranted";
  }

  if (state === "prompt") {
    return "accessSettings.permission.statusPrompt";
  }

  if (state === "denied") {
    return "accessSettings.permission.statusDenied";
  }

  return "accessSettings.permission.statusUnsupported";
}

function buildAccessDetailContent(
  kind: AccessDetailKind,
  state: BrowserPermissionState,
  t: (key: TranslationKey) => string,
): AccessDetailContent {
  if (kind === "photos-and-files") {
    return {
      title: t("accessSettings.photosAndFiles.title"),
      description: t("accessSettings.photosAndFiles.description"),
      status: t("common.perAction"),
      actionLabel: null,
    };
  }

  return {
    title: kind === "camera" ? t("accessSettings.permission.titleCamera") : t("accessSettings.permission.titleMicrophone"),
    description: kind === "camera"
      ? t("accessSettings.permission.guidanceCamera")
      : t("accessSettings.permission.guidanceMicrophone"),
    status: t(permissionStateKey(state)),
    actionLabel: state === "denied" ? null : t("accessSettings.permission.requestAccess"),
  };
}

function formatExpectedPermissionError(
  kind: BrowserMediaPermissionKind,
  error: unknown,
  permissionState: BrowserPermissionState,
  t: (key: TranslationKey) => string,
): string | null {
  if (isExpectedBrowserMediaPermissionError(error)) {
    return explainBrowserMediaPermissionError(kind, error, permissionState, t);
  }

  return null;
}

export function AccessPermissionDetailScreen(): ReactElement {
  const params = useParams();
  const kind = parseAccessDetailKind(params.accessKind);
  const { activeWorkspace, cloudSettings, session } = useAppData();
  const { showTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [permissionState, setPermissionState] = useState<BrowserPermissionState>("unsupported");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");

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

  const content = buildAccessDetailContent(kind, permissionState, t);

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
      const expectedErrorMessage = formatExpectedPermissionError(mediaKind, error, nextState, t);
      if (expectedErrorMessage !== null) {
        setErrorMessage(expectedErrorMessage);
        return;
      }

      const wasCaptured = showTechnicalError(error, {
        feature: "settings",
        operation: "access_permission_request",
        userId: session?.userId ?? null,
        workspaceId: activeWorkspace?.workspaceId ?? null,
        installationId: cloudSettings?.installationId ?? null,
        entityId: mediaKind,
      });
      setErrorMessage(wasCaptured ? technicalErrorMessage : error instanceof Error ? error.message : String(error));
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
        <span className="cell-secondary">{t("common.status")}</span>
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
