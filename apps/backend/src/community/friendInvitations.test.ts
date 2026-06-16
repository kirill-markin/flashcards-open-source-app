import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import type {
  DatabaseExecutor,
  SqlValue,
  UserDatabaseScope,
} from "../database";
import { HttpError } from "../shared/errors";
import {
  acceptFriendInvitationWithDependencies,
  createFriendInvitationWithDependencies,
  friendInviteTokenByteLength,
  friendInviteUrlBase,
  hashFriendInviteToken,
  parseFriendInvitationDisplayName,
  previewFriendInvitationWithDependencies,
  type FriendInvitationServiceDependencies,
} from "./friendInvitations";

type QueryResultRow = pg.QueryResultRow;

type RecordedQuery = Readonly<{
  text: string;
  params: ReadonlyArray<SqlValue>;
}>;

type CreatedInvitationRecord = Readonly<{
  invitationId: string;
  inviterUserId: string;
  inviteTokenHash: string;
  inviteeDisplayName: string;
}>;

type PreviewInvitationFixtureRow = QueryResultRow & Readonly<{
  invitation_status: string;
  expires_at: Date | string | null;
  inviter_user_id?: string;
  inviter_email?: string;
  public_profile_id?: string;
  invitee_display_name_for_inviter?: string;
}>;

type AcceptInvitationFixtureRow = QueryResultRow & Readonly<{
  acceptance_status: string;
  inviter_public_profile_id: string | null;
  invitee_public_profile_id: string | null;
}>;

type MutableFriendInvitationState = {
  activeInvitationCount: number;
  currentProfileUserId: string;
  createdInvitations: Array<CreatedInvitationRecord>;
  previewRows: Array<PreviewInvitationFixtureRow>;
  acceptRows: Array<AcceptInvitationFixtureRow>;
  existingFriendDisplayName: string | null;
  operationOrder: Array<string>;
  queries: Array<RecordedQuery>;
  scopes: Array<UserDatabaseScope>;
  tokenBytes: Buffer;
  requestedTokenByteCounts: Array<number>;
};

const expiresAt = new Date("2026-06-17T10:00:00.000Z");
const inviterPublicProfileId = "00000000-0000-4000-8000-0000000000a1";
const inviteePublicProfileId = "00000000-0000-4000-8000-0000000000b2";

function createQueryResult<Row extends QueryResultRow>(rows: ReadonlyArray<Row>): pg.QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function createFriendInvitationState(): MutableFriendInvitationState {
  return {
    activeInvitationCount: 0,
    currentProfileUserId: "user-1",
    createdInvitations: [],
    previewRows: [],
    acceptRows: [],
    existingFriendDisplayName: null,
    operationOrder: [],
    queries: [],
    scopes: [],
    tokenBytes: Buffer.alloc(friendInviteTokenByteLength, 7),
    requestedTokenByteCounts: [],
  };
}

function readStringParam(params: ReadonlyArray<SqlValue>, index: number, label: string): string {
  const value = params[index];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function createFriendInvitationExecutor(state: MutableFriendInvitationState): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> {
      state.queries.push({ text, params });

      if (text.includes("COUNT(*)::INTEGER AS active_invitation_count")) {
        state.operationOrder.push("count");
        return createQueryResult([
          { active_invitation_count: state.activeInvitationCount },
        ]) as unknown as pg.QueryResult<Row>;
      }

      if (text === "SELECT pg_advisory_xact_lock(hashtextextended($1, 0::bigint))") {
        state.operationOrder.push("lock");
        assert.equal(readStringParam(params, 0, "lockKey"), "community.friend_invitations:user-1");
        return createQueryResult([]) as unknown as pg.QueryResult<Row>;
      }

      if (text.startsWith("INSERT INTO community.friend_invitations")) {
        state.operationOrder.push("insert");
        state.createdInvitations.push({
          invitationId: readStringParam(params, 0, "friendInvitationId"),
          inviterUserId: readStringParam(params, 1, "inviterUserId"),
          inviteTokenHash: readStringParam(params, 2, "inviteTokenHash"),
          inviteeDisplayName: readStringParam(params, 3, "inviteeDisplayName"),
        });
        return createQueryResult([{ expires_at: expiresAt }]) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("community.preview_friend_invitation")) {
        state.operationOrder.push("preview");
        return createQueryResult(state.previewRows) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("community.accept_friend_invitation")) {
        state.operationOrder.push("accept");
        return createQueryResult(state.acceptRows) as unknown as pg.QueryResult<Row>;
      }

      if (text.includes("FROM community.friendships")) {
        state.operationOrder.push("existing_friend");
        if (state.existingFriendDisplayName === null) {
          return createQueryResult([]) as unknown as pg.QueryResult<Row>;
        }

        return createQueryResult([
          { friend_display_name: state.existingFriendDisplayName },
        ]) as unknown as pg.QueryResult<Row>;
      }

      throw new Error(`Unexpected friend invitation query: ${text}`);
    },
  };
}

function createFriendInvitationDependencies(
  state: MutableFriendInvitationState,
): FriendInvitationServiceDependencies {
  const executor = createFriendInvitationExecutor(state);

  return {
    transactionWithUserScopeFn: async <Result>(
      scope: UserDatabaseScope,
      callback: (transactionExecutor: DatabaseExecutor) => Promise<Result>,
    ): Promise<Result> => {
      state.scopes.push(scope);
      return callback(executor);
    },
    unsafeQueryFn: async <Row extends QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue>,
    ): Promise<pg.QueryResult<Row>> => executor.query<Row>(text, params),
    ensureCurrentUserPublicProfileFn: async () => {
      state.operationOrder.push("ensure");
      return {
        userId: state.currentProfileUserId,
        publicProfileId: "00000000-0000-4000-8000-000000000001",
      };
    },
    randomBytesFn: (byteCount) => {
      state.requestedTokenByteCounts.push(byteCount);
      return state.tokenBytes;
    },
    randomUuidFn: () => "00000000-0000-4000-8000-000000000099",
    inviteUrlBase: friendInviteUrlBase,
    activeInviteLimit: 20,
  };
}

function assertHttpError(
  error: unknown,
  statusCode: number,
  code: string,
  message: string,
): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  return true;
}

test("createFriendInvitation stores only the token hash and returns the raw token URL", async () => {
  const state = createFriendInvitationState();
  const dependencies = createFriendInvitationDependencies(state);
  const rawToken = state.tokenBytes.toString("base64url");

  const response = await createFriendInvitationWithDependencies(
    {
      userId: "user-1",
      inviteeDisplayName: "  Priya 🎯  ",
    },
    dependencies,
  );

  assert.deepEqual(response, {
    inviteUrl: `${friendInviteUrlBase}/${rawToken}`,
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
  assert.deepEqual(state.scopes, [{ userId: "user-1" }]);
  assert.deepEqual(state.operationOrder, ["ensure", "lock", "count", "insert"]);
  assert.deepEqual(state.requestedTokenByteCounts, [friendInviteTokenByteLength]);

  const createdInvitation = state.createdInvitations[0];
  assert.notEqual(createdInvitation, undefined);
  assert.equal(createdInvitation?.inviterUserId, "user-1");
  assert.equal(createdInvitation?.inviteeDisplayName, "Priya 🎯");
  assert.equal(createdInvitation?.inviteTokenHash, hashFriendInviteToken(rawToken));
  assert.notEqual(createdInvitation?.inviteTokenHash, rawToken);
  assert.match(createdInvitation?.inviteTokenHash ?? "", /^[0-9a-f]{64}$/);
});

test("createFriendInvitation rejects the twentieth active unaccepted invitation before insert", async () => {
  const state = createFriendInvitationState();
  state.activeInvitationCount = 20;
  const dependencies = createFriendInvitationDependencies(state);

  await assert.rejects(
    async () => createFriendInvitationWithDependencies(
      {
        userId: "user-1",
        inviteeDisplayName: "Priya",
      },
      dependencies,
    ),
    (error: unknown) => assertHttpError(
      error,
      409,
      "FRIEND_INVITATION_LIMIT_REACHED",
      "You already have 20 active friend invitation links. Wait for one to expire or be accepted before creating another.",
    ),
  );

  assert.deepEqual(state.operationOrder, ["ensure", "lock", "count"]);
  assert.deepEqual(state.createdInvitations, []);
});

test("previewFriendInvitation hashes the raw token and returns no identity fields", async () => {
  const state = createFriendInvitationState();
  state.previewRows = [{
    invitation_status: "active",
    expires_at: expiresAt,
    inviter_user_id: "user-inviter",
    inviter_email: "inviter@example.com",
    public_profile_id: inviterPublicProfileId,
    invitee_display_name_for_inviter: "Private invitee name",
  }];
  const dependencies = createFriendInvitationDependencies(state);

  const response = await previewFriendInvitationWithDependencies("raw-token", dependencies);

  assert.deepEqual(response, {
    status: "active",
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
  assert.equal(Object.hasOwn(response, "inviterUserId"), false);
  assert.equal(Object.hasOwn(response, "email"), false);
  assert.equal(Object.hasOwn(response, "publicProfileId"), false);
  assert.equal(Object.hasOwn(response, "inviteeDisplayName"), false);
  assert.deepEqual(state.operationOrder, ["preview"]);
  assert.deepEqual(state.queries[0]?.params, [hashFriendInviteToken("raw-token")]);
});

test("acceptFriendInvitation returns accepted after ensuring the invitee public profile", async () => {
  const state = createFriendInvitationState();
  state.acceptRows = [{
    acceptance_status: "accepted",
    inviter_public_profile_id: inviterPublicProfileId,
    invitee_public_profile_id: inviteePublicProfileId,
  }];
  const dependencies = createFriendInvitationDependencies(state);

  const response = await acceptFriendInvitationWithDependencies(
    {
      userId: "user-1",
      rawInviteToken: "raw-token",
      inviterDisplayName: "  Alex  ",
    },
    dependencies,
  );

  assert.deepEqual(response, { status: "accepted" });
  assert.deepEqual(state.scopes, [{ userId: "user-1" }]);
  assert.deepEqual(state.operationOrder, ["ensure", "accept"]);
  assert.deepEqual(state.queries[0]?.params, [hashFriendInviteToken("raw-token"), "Alex"]);
});

test("acceptFriendInvitation rejects self invite links with a clear typed error", async () => {
  const state = createFriendInvitationState();
  state.acceptRows = [{
    acceptance_status: "self",
    inviter_public_profile_id: null,
    invitee_public_profile_id: null,
  }];
  const dependencies = createFriendInvitationDependencies(state);

  await assert.rejects(
    async () => acceptFriendInvitationWithDependencies(
      {
        userId: "user-1",
        rawInviteToken: "raw-token",
        inviterDisplayName: "Alex",
      },
      dependencies,
    ),
    (error: unknown) => assertHttpError(
      error,
      409,
      "FRIEND_INVITATION_SELF",
      "This is your own invitation link.",
    ),
  );
});

test("acceptFriendInvitation returns the existing stored display name for already-friends links", async () => {
  const state = createFriendInvitationState();
  state.acceptRows = [{
    acceptance_status: "already_friends",
    inviter_public_profile_id: inviterPublicProfileId,
    invitee_public_profile_id: inviteePublicProfileId,
  }];
  state.existingFriendDisplayName = "Stored Alex";
  const dependencies = createFriendInvitationDependencies(state);

  const response = await acceptFriendInvitationWithDependencies(
    {
      userId: "user-1",
      rawInviteToken: "raw-token",
      inviterDisplayName: "Changed Alex",
    },
    dependencies,
  );

  assert.deepEqual(response, {
    status: "already_friends",
    existingFriendDisplayName: "Stored Alex",
  });
  assert.deepEqual(state.operationOrder, ["ensure", "accept", "existing_friend"]);
});

test("acceptFriendInvitation maps inactive and already-accepted links to inactive", async () => {
  for (const acceptanceStatus of ["inactive", "already_accepted"] as const) {
    const state = createFriendInvitationState();
    state.acceptRows = [{
      acceptance_status: acceptanceStatus,
      inviter_public_profile_id: null,
      invitee_public_profile_id: null,
    }];
    const dependencies = createFriendInvitationDependencies(state);

    const response = await acceptFriendInvitationWithDependencies(
      {
        userId: "user-1",
        rawInviteToken: "raw-token",
        inviterDisplayName: "Alex",
      },
      dependencies,
    );

    assert.deepEqual(response, { status: "inactive" });
    assert.deepEqual(state.operationOrder, ["ensure", "accept"]);
  }
});

test("friend invitation display-name validation trims Unicode names and rejects invalid input", () => {
  assert.equal(parseFriendInvitationDisplayName("  Alex 😊  ", "inviteeDisplayName"), "Alex 😊");

  const invalidCases = [
    {
      value: "   ",
      message: "inviteeDisplayName must be 1 to 30 characters after trimming.",
    },
    {
      value: "a".repeat(31),
      message: "inviteeDisplayName must be 1 to 30 characters after trimming.",
    },
    {
      value: "Line\nBreak",
      message: "inviteeDisplayName must not contain control characters or newlines.",
    },
    {
      value: 42,
      message: "inviteeDisplayName must be a string.",
    },
  ] as const;

  for (const invalidCase of invalidCases) {
    assert.throws(
      () => parseFriendInvitationDisplayName(invalidCase.value, "inviteeDisplayName"),
      (error: unknown) => assertHttpError(
        error,
        400,
        "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
        invalidCase.message,
      ),
    );
  }
});
