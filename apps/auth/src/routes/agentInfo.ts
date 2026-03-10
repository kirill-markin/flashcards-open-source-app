/**
 * Agent discovery route. Terminal clients can start here with a plain GET to
 * learn what this service is, how login/registration works, and which action
 * to call first.
 */
import { Hono } from "hono";
import { type AuthAppEnv } from "../server/apiErrors.js";
import { createAgentEnvelope } from "../server/agentEnvelope.js";
import { getPublicApiBaseUrl, getPublicAuthBaseUrl } from "../server/publicUrls.js";

const app = new Hono<AuthAppEnv>();

app.get("/api/agent", async (c) => {
  const authBaseUrl = getPublicAuthBaseUrl(c.req.url);
  const apiBaseUrl = getPublicApiBaseUrl(c.req.url);

  return c.json(createAgentEnvelope(
    {
      service: {
        name: "flashcards-open-source-app",
        description: "Offline-first flashcards service with user-owned workspaces and AI-friendly API onboarding.",
      },
      authentication: {
        type: "email_otp_then_api_key",
        registerAndLogin: "The same flow works for both new and existing users.",
      },
      capabilitiesAfterLogin: [
        "Load account context",
        "List, create, and select workspaces",
        "Search cards and decks",
        "Use AI chat to inspect and create cards",
      ],
      authBaseUrl,
      apiBaseUrl,
    },
    [{
      name: "send_code",
      method: "POST",
      url: `${authBaseUrl}/api/agent/send-code`,
      input: {
        required: ["email"],
      },
    }],
    "This endpoint is the discovery entrypoint for AI agents. Start by calling send_code with the user's email address. The same flow covers both registration and login. Every later response includes the next action and short English instructions.",
  ));
});

export default app;
