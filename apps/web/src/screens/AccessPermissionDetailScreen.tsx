import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import {
  queryBrowserPermissionState,
  requestBrowserMediaPermission,
  type BrowserMediaPermissionKind,
  type BrowserPermissionState,
} from "../access/browserAccess";
import { type TranslationKey, useI18n } from "../i18n";
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

function formatPermissionError(
  kind: BrowserMediaPermissionKind,
  error: unknown,
  permissionState: BrowserPermissionState,
  t: (key: TranslationKey) => string,
): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      if (permissionState === "denied") {
        return kind === "camera"
          ? t("accessSettings.permission.errorNotAllowedDeniedCamera")
          : t("accessSettings.permission.errorNotAllowedDeniedMicrophone");
      }

      return kind === "camera"
        ? t("accessSettings.permission.errorNotAllowedCamera")
        : t("accessSettings.permission.errorNotAllowedMicrophone");
    }

    if (error.name === "NotFoundError") {
      return kind === "camera"
        ? t("accessSettings.permission.errorNotFoundCamera")
        : t("accessSettings.permission.errorNotFoundMicrophone");
    }

    if (error.name === "NotReadableError") {
      return kind === "camera"
        ? t("accessSettings.permission.errorNotReadableCamera")
        : t("accessSettings.permission.errorNotReadableMicrophone");
    }
  }

  if (error instanceof Error) {
    if (error.message === "Media device access is unavailable in this browser.") {
      return t("accessSettings.permission.errorMediaUnavailable");
    }

    if (error.message === "Media permissions require HTTPS or localhost.") {
      return t("accessSettings.permission.errorSecureContext");
    }

    return error.message;
  }

  return String(error);
}

export function AccessPermissionDetailScreen(): ReactElement {
  const params = useParams();
  const kind = parseAccessDetailKind(params.accessKind);
  const { t } = useI18n();
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
      setErrorMessage(formatPermissionError(mediaKind, error, nextState, t));
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
