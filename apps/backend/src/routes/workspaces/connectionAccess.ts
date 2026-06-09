import type { AuthTransport } from "../../auth";
import { HttpError } from "../../shared/errors";

export function parseConnectionId(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "connectionId is required", "AGENT_API_KEY_ID_REQUIRED");
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    throw new HttpError(400, "connectionId must not be empty", "AGENT_API_KEY_ID_INVALID");
  }

  return trimmedValue;
}

export function requireHumanManagedConnectionAccess(transport: AuthTransport): void {
  if (transport === "api_key") {
    throw new HttpError(403, "Agent connections must be managed from a human session", "AGENT_API_KEY_HUMAN_SESSION_REQUIRED");
  }

  if (transport === "guest") {
    throw new HttpError(403, "Sign in with an account before managing workspaces or agent connections.", "ACCOUNT_SIGN_IN_REQUIRED");
  }
}
