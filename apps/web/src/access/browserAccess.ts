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

export function formatBrowserPermissionState(state: BrowserPermissionState): string {
  switch (state) {
    case "granted":
      return "Allowed";
    case "prompt":
      return "Ask every time";
    case "denied":
      return "Blocked";
    case "unsupported":
      return "Unavailable";
  }
}

export function browserPermissionSettingsGuidance(kind: BrowserMediaPermissionKind): string {
  const resourceLabel = kind === "camera" ? "camera" : "microphone";
  return `If access is blocked, use the site controls in your browser bar to enable ${resourceLabel} access for this site.`;
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
): string {
  const resourceLabel = kind === "camera" ? "camera" : "microphone";
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      if (permissionState === "denied") {
        return `Flashcards cannot use your ${resourceLabel}. Click the site controls in your browser bar and enable ${resourceLabel} access, then try again.`;
      }

      return `${resourceLabel[0]?.toUpperCase() ?? ""}${resourceLabel.slice(1)} access was not granted.`;
    }

    if (error.name === "NotFoundError") {
      return `No ${resourceLabel} is available on this device.`;
    }

    if (error.name === "NotReadableError") {
      return `The ${resourceLabel} is busy in another app. Close the other app and try again.`;
    }
  }

  return error instanceof Error ? error.message : String(error);
}
