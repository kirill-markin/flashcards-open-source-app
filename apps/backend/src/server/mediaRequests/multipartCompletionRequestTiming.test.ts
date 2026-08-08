import assert from "node:assert/strict";
import test from "node:test";
import {
  createMultipartCompletionRequestTiming,
  createMultipartCompletionWriterLeaseTargetAtMs,
  multipartCompletionMinimumOperationBudgetMs,
  multipartCompletionRequestBudgetMs,
  multipartCompletionResolutionReserveMs,
  readMultipartCompletionIngressAtMs,
} from "./multipartCompletionRequestTiming";

test("multipart completion timing is anchored to ingress and reserves exact resolution time", () => {
  const ingressAtMs = 1_000_000;
  const timing = createMultipartCompletionRequestTiming(
    ingressAtMs,
    ingressAtMs + 2_000,
    60_000,
  );

  assert.equal(
    timing.requestDeadlineAtMs,
    ingressAtMs + multipartCompletionRequestBudgetMs,
  );
  assert.equal(
    timing.operationDeadlineAtMs,
    timing.requestDeadlineAtMs - multipartCompletionResolutionReserveMs,
  );
  assert.ok(
    timing.operationDeadlineAtMs < timing.writerLeaseTargetAtMs,
  );
  assert.ok(
    timing.writerLeaseTargetAtMs < timing.requestDeadlineAtMs,
  );
  assert.equal(
    timing.acquisitionDeadlineAtMs,
    timing.operationDeadlineAtMs - multipartCompletionMinimumOperationBudgetMs,
  );
});

test("maximum multipart operation budget keeps storage abort before absolute lease expiry and resolution", () => {
  const ingressAtMs = 1_000_000;
  const timing = createMultipartCompletionRequestTiming(
    ingressAtMs,
    ingressAtMs,
    60_000,
  );

  assert.equal(
    timing.operationDeadlineAtMs - timing.ingressAtMs,
    multipartCompletionRequestBudgetMs
      - multipartCompletionResolutionReserveMs,
  );
  assert.equal(
    timing.writerLeaseTargetAtMs,
    timing.operationDeadlineAtMs
      + Math.floor(multipartCompletionResolutionReserveMs / 2),
  );
  assert.ok(
    timing.operationDeadlineAtMs < timing.writerLeaseTargetAtMs,
  );
  assert.ok(
    timing.writerLeaseTargetAtMs < timing.requestDeadlineAtMs,
  );
});

test("multipart writer lease target rejects a resolution window without both safety margins", () => {
  assert.throws(
    () => createMultipartCompletionWriterLeaseTargetAtMs(
      1_000_000,
      1_000_500,
    ),
    /resolution window is too short/u,
  );
});

test("multipart completion timing uses the earlier Lambda response deadline", () => {
  const ingressAtMs = 1_000_000;
  const observedAtMs = ingressAtMs + 5_000;
  const timing = createMultipartCompletionRequestTiming(
    ingressAtMs,
    observedAtMs,
    10_000,
  );

  assert.equal(timing.lambdaDeadlineAtMs, observedAtMs + 10_000);
  assert.equal(timing.requestDeadlineAtMs, observedAtMs + 8_000);
});

test("multipart completion ingress parsing supports REST and HTTP API request timestamps", () => {
  assert.equal(readMultipartCompletionIngressAtMs({
    requestContext: { requestTimeEpoch: 1_000_000 },
  }), 1_000_000);
  assert.equal(readMultipartCompletionIngressAtMs({
    version: "2.0",
    requestContext: { timeEpoch: 2_000_000 },
  }), 2_000_000);
  assert.equal(readMultipartCompletionIngressAtMs({
    version: "2.0",
    requestContext: { timeEpoch: "invalid" },
  }), null);
});
