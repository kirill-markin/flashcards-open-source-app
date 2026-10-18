import { probeBrowserGuestSession } from "../../../api/endpoints/guestAuth";
import { ApiError } from "../../../api/transport/errors";
import { recoverRegisteredCredentialForProbe } from "../../../api/transport/transport";
import type { BrowserGuestProbe } from "../../../apiContracts/guestAuth";

export async function probeBrowserGuestSessionWithRegisteredRecovery(): Promise<BrowserGuestProbe> {
  try {
    return await probeBrowserGuestSession();
  } catch (error) {
    // This probe rejects registered tokens with 401; guest credential loss is a successful status envelope.
    if (!(error instanceof ApiError) || error.statusCode !== 401 || error.endpoint !== "GET /guest-auth/browser/session") {
      throw error;
    }
    await recoverRegisteredCredentialForProbe();
    return probeBrowserGuestSession();
  }
}
