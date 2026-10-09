import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../release/check-mobile-readiness.mjs", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/release-readiness/ios-1.30.0.json", import.meta.url), "utf8"));
const destinationFixture = JSON.parse(readFileSync(new URL("./fixtures/release-readiness/ios-1.33.0.json", import.meta.url), "utf8"));
const directory = mkdtempSync(join(tmpdir(), "mobile-readiness-"));

function recordedCloudManifest(capture, release) {
  const identity = { sourceSha: capture.sourceSha, version: release.version, build: capture.number, artifactId: capture.actionId, runId: capture.runId };
  return {
    schemaVersion: 1, platform: "ios",
    target: { sourceSha: capture.sourceSha, version: release.version, build: "not-captured", artifactId: "not-captured" },
    gates: ["local-archive", "local-smoke", "cloud-archive", "cloud-tests"].map((id) => ({
      id, identity: id === "cloud-tests" ? identity : { ...identity, build: "not-captured", artifactId: "not-captured", runId: "not-captured" },
      inventorySourceSha: capture.sourceSha, inventoryRef: capture.inventoryRef, inventoryReviewedBy: "captured-source-review", inventoryComplete: true,
      cases: id === "cloud-tests" ? capture.inventory : id === "local-smoke" ? capture.inventory.filter((test) => test.id.includes("/testLiveSmokeGuestNavigationFlow()")) : [],
    })),
    results: [{
      gateId: "cloud-tests", identity,
      status: release.status,
      evidenceRef: capture.sourceRef, warningReview: release.warningReview, warningReviewRef: release.warningReviewRef,
      warnings: release.warnings, cases: capture.cases,
    }],
    equivalences: [],
  };
}
function execute(manifest) {
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  const execution = spawnSync(process.execPath, [cli, path], { encoding: "utf8", shell: false });
  if (execution.error !== undefined) throw execution.error;
  assert.equal(execution.signal, null);
  return execution;
}
function invoke(manifest) {
  const execution = execute(manifest);
  assert.equal(execution.stderr, "");
  return { exitCode: execution.status, report: JSON.parse(execution.stdout) };
}
function expectInvalid(manifest, path) {
  const execution = execute(manifest);
  assert.equal(execution.status, 2);
  assert.equal(execution.stdout, "");
  assert.ok(execution.stderr.includes(`${path}:`), execution.stderr);
}
function cloudReport(manifest) {
  const execution = invoke(manifest);
  assert.equal(execution.exitCode, 1, "partial evidence must leave absent release gates blocked");
  assert.equal(execution.report.ready, false);
  return execution.report.gates.find((gate) => gate.id === "cloud-tests");
}

try {
  const [passed, failed] = fixture.captures.map((capture) => invoke(recordedCloudManifest(capture, {
    version: "1.30.0",
    // Preserve the historical green run summary to prove it cannot hide failed named cases.
    status: capture.overallRunStatus === "SUCCEEDED" ? "passed" : "failed",
    warningReview: capture.number === "606" ? "complete" : "pending",
    warningReviewRef: `release-1.30.0/ios/cloud/${capture.number}/${capture.number === "606" ? "final-inspection.json" : "failure-root-cause.json"}`,
    warnings: [],
  })));
  const passedCloud = passed.report.gates.find((gate) => gate.id === "cloud-tests");
  assert.equal(passedCloud.ready, true);
  assert.deepEqual(passedCloud.counts, { passed: 16, failed: 0, skipped: 2, pending: 0, missing: 0 });
  assert.equal(passed.exitCode, 1);
  assert.equal(passed.report.ready, false, "partial captured evidence must not claim full release readiness");
  assert.equal(passed.report.gates.filter((gate) => gate.errors.includes("missing recorded gate evidence")).length, 3);
  const failedCloud = failed.report.gates.find((gate) => gate.id === "cloud-tests");
  assert.equal(failed.exitCode, 1);
  assert.equal(failedCloud.ready, false);
  assert.deepEqual(failedCloud.counts, { passed: 15, failed: 1, skipped: 2, pending: 0, missing: 0 });
  assert.ok(failedCloud.errors.some((error) => error.includes("testLiveSmokeResetWorkspaceProgressFlow()") && error.endsWith("is failed")));
  const capture = destinationFixture.capture;
  const manifest = recordedCloudManifest(capture, capture.release);
  const cloud = cloudReport(manifest);
  assert.equal(cloud.ready, capture.expectedCloudReady);
  assert.deepEqual(cloud.counts, capture.expectedCounts);
  assert.equal(cloud.cases.length, 42);
  const excluded = capture.inventory.filter((test) => test.disposition === "destination-exclusion");
  assert.equal(excluded.length, 3);
  assert.equal(cloud.cases.filter((test) => test.disposition === "manual-exclusion").length, 4);
  for (const test of excluded) {
    const reported = cloud.cases.find((entry) => entry.id === test.id);
    assert.equal(reported.status, "skipped");
    assert.equal(reported.requiredCaseId, test.requiredCaseId);
    assert.equal(reported.exclusionRef, test.evidenceRef);
    const recordedCounterpart = capture.cases.find((entry) => entry.id === test.requiredCaseId);
    assert.ok(recordedCounterpart, "complete native evidence must include the eligible counterpart");
    if (recordedCounterpart.status !== "passed") {
      assert.equal(cloud.ready, false);
      assert.ok(cloud.errors.includes(`case ${test.id} requires passed counterpart ${test.requiredCaseId}`));
    }
    for (const status of ["skipped", "failed", "pending"]) {
      const changed = structuredClone(manifest);
      const counterpart = changed.results[0].cases.find((entry) => entry.id === test.requiredCaseId);
      counterpart.status = status;
      if (status === "skipped") counterpart.reason = "Test skipped - eligible destination did not execute.";
      const blocked = cloudReport(changed);
      assert.equal(blocked.ready, false);
      assert.ok(blocked.errors.includes(`case ${test.id} requires passed counterpart ${test.requiredCaseId}`));
    }
    const missing = structuredClone(manifest);
    missing.results[0].cases = missing.results[0].cases.filter((entry) => entry.id !== test.requiredCaseId);
    assert.ok(cloudReport(missing).errors.includes(`missing case ${test.requiredCaseId}`));
  }
  const test = excluded[0];
  const gateIndex = manifest.gates.findIndex((gate) => gate.id === "cloud-tests");
  const caseIndex = capture.inventory.findIndex((entry) => entry.id === test.id);
  const field = `manifest.gates[${gateIndex}].cases[${caseIndex}]`;
  for (const requiredCaseId of [test.id, "UnrelatedTests/testUnrelated()@iPad/iOS 27.0", `${test.id.split("@")[0]}@not-configured`]) {
    const changed = structuredClone(manifest);
    changed.gates[gateIndex].cases[caseIndex].requiredCaseId = requiredCaseId;
    expectInvalid(changed, `${field}.requiredCaseId`);
  }
  for (const disposition of ["manual-exclusion", "destination-exclusion"]) {
    const changed = structuredClone(manifest);
    const counterpart = changed.gates[gateIndex].cases.find((entry) => entry.id === test.requiredCaseId);
    Object.assign(counterpart, { disposition, reason: test.reason, evidenceRef: test.evidenceRef, requiredCaseId: test.id });
    const invalidIndex = disposition === "destination-exclusion" ? Math.min(caseIndex, changed.gates[gateIndex].cases.indexOf(counterpart)) : caseIndex;
    expectInvalid(changed, `manifest.gates[${gateIndex}].cases[${invalidIndex}].requiredCaseId`);
  }
  const missingDestination = structuredClone(manifest);
  missingDestination.gates[gateIndex].cases[caseIndex].id = test.id.split("@")[0];
  expectInvalid(missingDestination, `${field}.id`);
  const local = structuredClone(manifest);
  local.gates[1].cases.push(structuredClone(test));
  expectInvalid(local, `manifest.gates[1].cases[${local.gates[1].cases.length - 1}].disposition`);
  const android = structuredClone(manifest);
  android.schemaVersion = 2;
  android.platform = "android";
  android.gates = [
    { ...android.gates[2], id: "cloud-release" },
    { ...android.gates[gateIndex], id: "firebase-tests" },
  ];
  android.results = [];
  expectInvalid(android, `manifest.gates[1].cases[${caseIndex}].disposition`);
  const reasonMismatch = structuredClone(manifest);
  reasonMismatch.results[0].cases.find((entry) => entry.id === test.id).reason = "Test skipped - unexpected guard.";
  assert.ok(cloudReport(reasonMismatch).errors.includes(`case ${test.id} is skipped without matching declared exclusion`));
  const missingExcluded = structuredClone(manifest);
  missingExcluded.results[0].cases = missingExcluded.results[0].cases.filter((entry) => entry.id !== test.id);
  assert.ok(cloudReport(missingExcluded).errors.includes(`missing case ${test.id}`));
  for (const status of ["failed", "pending"]) {
    const changed = structuredClone(manifest);
    changed.results[0].cases.find((entry) => entry.id === test.id).status = status;
    assert.ok(cloudReport(changed).errors.includes(`case ${test.id} is ${status}`));
  }
  console.log("Mobile readiness CLI replayed captured Xcode Cloud 606, 603 and the complete 614 destination matrix; absent gates and invalid counterpart evidence remain blocked.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
