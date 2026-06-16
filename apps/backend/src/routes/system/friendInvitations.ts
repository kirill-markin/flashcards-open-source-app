import type { Hono } from "hono";
import {
  acceptFriendInvitation,
  createFriendInvitation,
  previewFriendInvitation,
  type FriendInvitationAcceptResponse,
  type FriendInvitationCreateResponse,
  type FriendInvitationPreviewResponse,
} from "../../community/friendInvitations";
import type { AppEnv } from "../../server/app";
import type { loadRequestContextFromRequest } from "../../server/requestContext";
import { expectRecord, parseJsonBody } from "../../server/requestParsing";
import {
  assertFriendInvitationHumanTransport,
  assertFriendInvitationPublicPreviewTransport,
  parseFriendInvitationAcceptInput,
  parseFriendInvitationCreateInput,
  parseInviteTokenParam,
} from "./support";
import type {
  AcceptFriendInvitationFn,
  CreateFriendInvitationFn,
  PreviewFriendInvitationFn,
} from "./types";

export { acceptFriendInvitation, createFriendInvitation, previewFriendInvitation };

type FriendInvitationRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  loadRequestContextFromRequestFn: typeof loadRequestContextFromRequest;
  createFriendInvitationFn: CreateFriendInvitationFn;
  previewFriendInvitationFn: PreviewFriendInvitationFn;
  acceptFriendInvitationFn: AcceptFriendInvitationFn;
}>;

export function registerFriendInvitationRoutes(
  app: Hono<AppEnv>,
  options: FriendInvitationRoutesOptions,
): void {
  app.post("/me/community/friend-invitations", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertFriendInvitationHumanTransport(requestContext.transport);

    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseFriendInvitationCreateInput(body);
    const invitation = await options.createFriendInvitationFn({
      userId: requestContext.userId,
      inviteeDisplayName: input.inviteeDisplayName,
    });

    return context.json(invitation satisfies FriendInvitationCreateResponse);
  });

  app.get("/community/friend-invitations/:inviteToken", async (context) => {
    assertFriendInvitationPublicPreviewTransport(context.req.raw);
    const rawInviteToken = parseInviteTokenParam(context.req.param("inviteToken"));
    const invitation = await options.previewFriendInvitationFn(rawInviteToken);
    return context.json(invitation satisfies FriendInvitationPreviewResponse);
  });

  app.post("/me/community/friend-invitations/:inviteToken/accept", async (context) => {
    const { requestContext } = await options.loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );

    assertFriendInvitationHumanTransport(requestContext.transport);

    const rawInviteToken = parseInviteTokenParam(context.req.param("inviteToken"));
    const body = expectRecord(await parseJsonBody(context.req.raw));
    const input = parseFriendInvitationAcceptInput(body);
    const invitation = await options.acceptFriendInvitationFn({
      userId: requestContext.userId,
      rawInviteToken,
      inviterDisplayName: input.inviterDisplayName,
    });

    return context.json(invitation satisfies FriendInvitationAcceptResponse);
  });
}
