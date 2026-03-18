import assert from "node:assert/strict";
import test from "node:test";
import { __internal } from "./cognitoAuth.js";

test("password sign-in sends password with SELECT_CHALLENGE before password challenge", async () => {
  const previousClientId = process.env.COGNITO_CLIENT_ID;
  process.env.COGNITO_CLIENT_ID = "test-client-id";

  try {
    const calls: Array<{ target: string; body: Record<string, unknown> }> = [];
    const tokens = await __internal.signInWithPasswordViaCognito(
      async (target: string, body: Record<string, unknown>) => {
        calls.push({ target, body });

        if (target === "InitiateAuth") {
          return {
            ChallengeName: "SELECT_CHALLENGE",
            Session: "initial-session",
          };
        }

        if (target === "RespondToAuthChallenge" && body.ChallengeName === "SELECT_CHALLENGE") {
          return {
            ChallengeName: "PASSWORD",
            Session: "password-session",
          };
        }

        if (target === "RespondToAuthChallenge" && body.ChallengeName === "PASSWORD") {
          return {
            AuthenticationResult: {
              IdToken: "id-token",
              AccessToken: "access-token",
              RefreshToken: "refresh-token",
              ExpiresIn: 3600,
            },
          };
        }

        throw new Error(`Unexpected Cognito call: ${target}`);
      },
      "reviewer@example.com",
      "reviewer-password",
    );

    assert.deepEqual(tokens, {
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1], {
      target: "RespondToAuthChallenge",
      body: {
        ClientId: "test-client-id",
        ChallengeName: "SELECT_CHALLENGE",
        Session: "initial-session",
        ChallengeResponses: {
          USERNAME: "reviewer@example.com",
          ANSWER: "PASSWORD",
          PASSWORD: "reviewer-password",
        },
      },
    });
  } finally {
    process.env.COGNITO_CLIENT_ID = previousClientId;
  }
});
