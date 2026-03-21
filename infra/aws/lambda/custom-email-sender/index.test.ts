import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMessage,
  handleCustomEmailSenderEvent,
} from "./index";

test("buildMessage creates authentication email content", () => {
  const message = buildMessage("CustomEmailSender_Authentication", "12345678");

  assert.equal(message.subject, "Your Flashcards sign-in code");
  assert.equal(message.requiresCode, true);
  assert.match(message.html, /12345678/);
});

test("buildMessage rejects unknown trigger sources", () => {
  assert.throws(
    () => buildMessage("CustomEmailSender_Unknown", "12345678"),
    /Unsupported Cognito custom email trigger source/,
  );
});

test("handleCustomEmailSenderEvent sends email through Resend", async () => {
  let requestBody = "";

  const event = {
    triggerSource: "CustomEmailSender_Authentication",
    request: {
      code: "encrypted-code",
      userAttributes: {
        email: "kirill@example.com",
      },
    },
  };

  const result = await handleCustomEmailSenderEvent(event, {
    keyArn: "arn:aws:kms:eu-central-1:123456789012:key/test",
    keyId: "1234-5678",
    resendApiKey: "re_test",
    resendFromEmail: "no-reply@mail.flashcards-open-source-app.com",
    resendFromName: "Flashcards Open Source App",
  }, {
    decryptCode: async (encryptedCode: string) => {
      assert.equal(encryptedCode, "encrypted-code");
      return "87654321";
    },
    fetchFn: async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = init?.body as string;
      return new Response(JSON.stringify({ id: "email-id-1" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
  });

  assert.equal(result, event);
  assert.match(requestBody, /87654321/);
  assert.match(requestBody, /no-reply@mail\.flashcards-open-source-app\.com/);
});

test("handleCustomEmailSenderEvent fails when resend returns an error", async () => {
  const event = {
    triggerSource: "CustomEmailSender_Authentication",
    request: {
      code: "encrypted-code",
      userAttributes: {
        email: "kirill@example.com",
      },
    },
  };

  await assert.rejects(
    handleCustomEmailSenderEvent(event, {
      keyArn: "arn:aws:kms:eu-central-1:123456789012:key/test",
      keyId: "1234-5678",
      resendApiKey: "re_test",
      resendFromEmail: "no-reply@mail.flashcards-open-source-app.com",
      resendFromName: "Flashcards Open Source App",
    }, {
      decryptCode: async () => "87654321",
      fetchFn: async () => new Response("provider failed", { status: 500 }),
    }),
    /Resend email send failed with status 500/,
  );
});

test("handleCustomEmailSenderEvent propagates decrypt errors", async () => {
  const event = {
    triggerSource: "CustomEmailSender_Authentication",
    request: {
      code: "encrypted-code",
      userAttributes: {
        email: "kirill@example.com",
      },
    },
  };

  await assert.rejects(
    handleCustomEmailSenderEvent(event, {
      keyArn: "arn:aws:kms:eu-central-1:123456789012:key/test",
      keyId: "1234-5678",
      resendApiKey: "re_test",
      resendFromEmail: "no-reply@mail.flashcards-open-source-app.com",
      resendFromName: "Flashcards Open Source App",
    }, {
      decryptCode: async () => {
        throw new Error("decrypt failed");
      },
      fetchFn: async () => new Response(null, { status: 200 }),
    }),
    /decrypt failed/,
  );
});
