import type { TranslationKey } from "../i18n";

export type BrowserMediaPermissionKind = "camera" | "microphone";
export type BrowserPermissionState = "denied" | "granted" | "prompt" | "unsupported";

type BrowserPermissionsApi = Readonly<{
  query: (descriptor: PermissionDescriptor) => Promise<Readonly<{ state: PermissionState }>>;
}>;

function getPermissionsApi(): BrowserPermissionsApi | null {
  const permissionsValue = navigator.permissions;
  if (permissionsValue === undefined) {
    return null;
  }

  return permissionsValue as unknown as BrowserPermissionsApi;
}

export async function queryBrowserPermissionState(kind: BrowserMediaPermissionKind): Promise<BrowserPermissionState> {
  const permissionsApi = getPermissionsApi();
  if (permissionsApi === null) {
    return "unsupported";
  }

  try {
    const result = await permissionsApi.query({ name: kind as PermissionName });
    if (result.state === "granted" || result.state === "denied" || result.state === "prompt") {
      return result.state;
    }

    return "unsupported";
  } catch {
    return "unsupported";
  }
}

export async function requestBrowserMediaPermission(kind: BrowserMediaPermissionKind): Promise<void> {
  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== "function") {
    throw new Error("Media device access is unavailable in this browser.");
  }

  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (window.isSecureContext === false && isLocalHost === false) {
    throw new Error("Media permissions require HTTPS or localhost.");
  }

  const stream = await mediaDevices.getUserMedia(
    kind === "camera"
      ? { audio: false, video: true }
      : { audio: true, video: false },
  );
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function explainBrowserMediaPermissionError(
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
  }

  return error instanceof Error ? error.message : String(error);
}
