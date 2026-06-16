import type { Hono } from "hono";
import {
  ensurePublicProfileForUser,
  updateLeaderboardParticipation,
  type PublicProfile,
} from "../../community/publicProfiles";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { expectRecord, parseJsonBody } from "../../server/requestParsing";
import {
  assertCommunityProfileHumanTransport,
  parseCommunityProfileInput,
} from "./support";
import type {
  CommunityPublicProfileResponse,
  EnsurePublicProfileForUserFn,
  UpdateLeaderboardParticipationFn,
} from "./types";
import type { AuthTransport } from "../../auth";

export { ensurePublicProfileForUser, updateLeaderboardParticipation };

type CommunityProfileRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  ensurePublicProfileForUserFn: EnsurePublicProfileForUserFn;
  updateLeaderboardParticipationFn: UpdateLeaderboardParticipationFn;
}>;

function createCommunityPublicProfileResponse(
  profile: PublicProfile,
  transport: AuthTransport,
): CommunityPublicProfileResponse {
  return {
    ...profile,
    linkedAccountRequiredForLeaderboard: transport === "guest",
  };
}

export function registerCommunityProfileRoutes(
  app: Hono<AppEnv>,
  options: CommunityProfileRoutesOptions,
): void {
  app.get("/me/community/profile", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertCommunityProfileHumanTransport(requestContext.transport);

    const profile = await options.ensurePublicProfileForUserFn(requestContext.userId, requestContext.locale);
    return context.json(createCommunityPublicProfileResponse(profile, requestContext.transport));
  });

  app.patch("/me/community/profile", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertCommunityProfileHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseCommunityProfileInput(body);
    const profile = await options.updateLeaderboardParticipationFn(
      requestContext.userId,
      input.leaderboardParticipationEnabled,
      requestContext.locale,
    );

    return context.json(createCommunityPublicProfileResponse(profile, requestContext.transport));
  });
}
