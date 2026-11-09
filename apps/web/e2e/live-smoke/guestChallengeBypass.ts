import type { BrowserContext } from "@playwright/test";

const guestSessionCreationRoute = "**/guest-auth/browser/session";
const bypassToken = process.env.E2E_GUEST_CHALLENGE_BYPASS_TOKEN ?? "";

/**
 * Lets the smoke's guests pass the browser check the backend may ask a new web guest for. The token
 * goes in the creation body rather than a header, which the API's CORS rules would refuse; without
 * it configured the smoke creates guests exactly as a browser does.
 */
export async function addGuestChallengeBypass(context: BrowserContext): Promise<void> {
  if (bypassToken === "") return;
  await context.route(guestSessionCreationRoute, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (body === null || typeof body !== "object") {
      throw new Error(`Guest creation request body is not a JSON object: ${request.postData() ?? "<empty>"}`);
    }
    await route.fallback({ postData: JSON.stringify({ ...body, automationBypassToken: bypassToken }) });
  });
}
