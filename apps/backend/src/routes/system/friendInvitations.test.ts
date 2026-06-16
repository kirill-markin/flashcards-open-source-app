import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext } from "../../server/requestContext";
import { HttpError } from "../../shared/errors";
import { createSystemTestApp } from "./systemTestSupport";

test("POST /me/community/friend-invitations creates an invite link for signed-in humans", async () => {
  let createCalled = false;
  const app = createSystemTestApp({
    transport: "bearer",
    createFriendInvitationFn: async (input) => {
      createCalled = true;
      assert.deepEqual(input, {
        userId: "user-1",
        inviteeDisplayName: "Priya 🎯",
      });
      return {
        inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
        expiresAt: "2026-06-17T10:00:00.000Z",
      };
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviteeDisplayName: "  Priya 🎯  ",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(createCalled, true);
  assert.deepEqual(await response.json(), {
    inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
});

test("GET /community/friend-invitations/:inviteToken previews without identity fields", async () => {
  let previewCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    previewFriendInvitationFn: async (rawInviteToken) => {
      previewCalled = true;
      assert.equal(rawInviteToken, "raw-token");
      return {
        status: "active",
        expiresAt: "2026-06-17T10:00:00.000Z",
      };
    },
  });

  const response = await app.request("http://localhost/community/friend-invitations/raw-token");
  const payload = await response.json() as Readonly<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(previewCalled, true);
  assert.deepEqual(payload, {
    status: "active",
    expiresAt: "2026-06-17T10:00:00.000Z",
  });
  assert.equal(Object.hasOwn(payload, "inviterUserId"), false);
  assert.equal(Object.hasOwn(payload, "email"), false);
  assert.equal(Object.hasOwn(payload, "publicProfileId"), false);
  assert.equal(Object.hasOwn(payload, "inviteeDisplayName"), false);
});

test("GET /community/friend-invitations/:inviteToken rejects ApiKey authentication", async () => {
  let previewCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    previewFriendInvitationFn: async () => {
      previewCalled = true;
      return { status: "inactive" };
    },
  });

  const response = await app.request("http://localhost/community/friend-invitations/raw-token", {
    headers: {
      Authorization: "ApiKey test-key",
    },
  });

  assert.equal(previewCalled, false);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Friend invitation preview does not support ApiKey authentication",
    requestId: "request-1",
    code: "FRIEND_INVITATION_API_KEY_AUTH_UNSUPPORTED",
  });
});

test("POST /me/community/friend-invitations/:inviteToken/accept accepts for signed-in humans", async () => {
  let acceptCalled = false;
  const app = createSystemTestApp({
    transport: "session",
    acceptFriendInvitationFn: async (input) => {
      acceptCalled = true;
      assert.deepEqual(input, {
        userId: "user-1",
        rawInviteToken: "raw-token",
        inviterDisplayName: "Alex",
      });
      return { status: "accepted" };
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations/raw-token/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviterDisplayName: "  Alex  ",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(acceptCalled, true);
  assert.deepEqual(await response.json(), {
    status: "accepted",
  });
});

test("POST /me/community/friend-invitations/:inviteToken/accept returns self-link errors", async () => {
  const app = createSystemTestApp({
    transport: "bearer",
    acceptFriendInvitationFn: async () => {
      throw new HttpError(
        409,
        "This is your own invitation link.",
        "FRIEND_INVITATION_SELF",
      );
    },
  });

  const response = await app.request("http://localhost/me/community/friend-invitations/raw-token/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inviterDisplayName: "Alex",
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "This is your own invitation link.",
    requestId: "request-1",
    code: "FRIEND_INVITATION_SELF",
  });
});

test("friend invitation human endpoints reject ApiKey and Guest authentication", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/friend-invitations",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviteeDisplayName: "Priya",
        }),
      },
    },
    {
      url: "http://localhost/me/community/friend-invitations/raw-token/accept",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inviterDisplayName: "Alex",
        }),
      },
    },
  ] as const;
  const transports: ReadonlyArray<RequestContext["transport"]> = ["api_key", "guest"];

  for (const transport of transports) {
    for (const testCase of cases) {
      let serviceCalled = false;
      const app = createSystemTestApp({
        transport,
        createFriendInvitationFn: async () => {
          serviceCalled = true;
          return {
            inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
            expiresAt: "2026-06-17T10:00:00.000Z",
          };
        },
        acceptFriendInvitationFn: async () => {
          serviceCalled = true;
          return { status: "accepted" };
        },
      });
      const response = await app.request(testCase.url, testCase.init);

      assert.equal(serviceCalled, false);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: "This endpoint requires signed-in human authentication",
        requestId: "request-1",
        code: "FRIEND_INVITATION_HUMAN_AUTH_REQUIRED",
      });
    }
  }
});

test("friend invitation routes reject invalid display names before service calls", async () => {
  const cases = [
    {
      url: "http://localhost/me/community/friend-invitations",
      body: {
        inviteeDisplayName: "Line\nBreak",
      },
      expectedError: "inviteeDisplayName must not contain control characters or newlines.",
    },
    {
      url: "http://localhost/me/community/friend-invitations/raw-token/accept",
      body: {
        inviterDisplayName: "",
      },
      expectedError: "inviterDisplayName must be 1 to 30 characters after trimming.",
    },
  ] as const;

  for (const testCase of cases) {
    let serviceCalled = false;
    const app = createSystemTestApp({
      transport: "session",
      createFriendInvitationFn: async () => {
        serviceCalled = true;
        return {
          inviteUrl: "https://app.flashcards-open-source-app.com/invite/raw-token",
          expiresAt: "2026-06-17T10:00:00.000Z",
        };
      },
      acceptFriendInvitationFn: async () => {
        serviceCalled = true;
        return { status: "accepted" };
      },
    });
    const response = await app.request(testCase.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testCase.body),
    });

    assert.equal(serviceCalled, false);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: testCase.expectedError,
      requestId: "request-1",
      code: "FRIEND_INVITATION_DISPLAY_NAME_INVALID",
    });
  }
});
