import { Hono } from "hono";
import { createAgentAccountEnvelope, shouldUseAgentSetupEnvelope } from "../agentSetup";
import { query } from "../db";
import { getSessionCsrfToken } from "../requestSecurity";
import { loadRequestContextFromRequest } from "../server/requestContext";
import type { AppEnv } from "../app";

type SystemRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
}>;

export function createSystemRoutes(options: SystemRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/health", async (context) => {
    const result = await query<Readonly<{ now: Date | string }>>("SELECT now() AS now", []);
    return context.json({
      status: "ok",
      service: "flashcards-open-source-app-backend",
      dbTime: result.rows[0]?.now ?? null,
    });
  });

  app.get("/me", async (context) => {
    const { requestAuthInputs, requestContext } = await loadRequestContextFromRequest(
      context.req.raw,
      options.allowedOrigins,
    );
    if (shouldUseAgentSetupEnvelope(requestContext.transport)) {
      return context.json(createAgentAccountEnvelope(requestContext));
    }

    return context.json({
      userId: requestContext.userId,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      authTransport: requestContext.transport,
      csrfToken: requestContext.transport === "session" && requestAuthInputs.sessionToken !== undefined
        ? await getSessionCsrfToken(requestAuthInputs.sessionToken)
        : null,
      profile: {
        email: requestContext.email,
        locale: requestContext.locale,
        createdAt: requestContext.userSettingsCreatedAt,
      },
    });
  });

  return app;
}
