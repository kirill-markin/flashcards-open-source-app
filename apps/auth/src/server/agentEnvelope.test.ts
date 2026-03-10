import assert from "node:assert/strict";
import test from "node:test";
import { createAgentEnvelope, createAgentErrorEnvelope } from "./agentEnvelope.js";

test("createAgentEnvelope returns the stable success shape", () => {
  const envelope = createAgentEnvelope(
    "https://auth.example.com/api/agent/send-code",
    { otpSessionToken: "otp-1" },
    [{
      name: "verify_code",
      method: "POST",
      url: "https://auth.example.com/api/agent/verify-code",
    }],
    "Ask the user for the code.",
  );

  assert.deepEqual(envelope, {
    ok: true,
    data: { otpSessionToken: "otp-1" },
    actions: [{
      name: "verify_code",
      method: "POST",
      url: "https://auth.example.com/api/agent/verify-code",
    }],
    instructions: "Ask the user for the code.",
    docs: {
      openapiUrl: "https://api.example.com/v1/agent/openapi.json",
      swaggerUrl: "https://api.example.com/v1/agent/swagger.json",
    },
  });
});

test("createAgentErrorEnvelope keeps errors in the same envelope shape", () => {
  const envelope = createAgentErrorEnvelope(
    "https://auth.example.com/api/agent/send-code",
    "OTP_CODE_INVALID",
    "Enter a valid 8-digit code.",
    "Retry verify_code with the latest code.",
  );

  assert.deepEqual(envelope, {
    ok: false,
    data: {},
    actions: [],
    instructions: "Retry verify_code with the latest code.",
    docs: {
      openapiUrl: "https://api.example.com/v1/agent/openapi.json",
      swaggerUrl: "https://api.example.com/v1/agent/swagger.json",
    },
    error: {
      code: "OTP_CODE_INVALID",
      message: "Enter a valid 8-digit code.",
    },
  });
});
