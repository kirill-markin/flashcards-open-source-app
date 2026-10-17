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
  // Contract-only CLI inputs; these are not captured native acceptance evidence.
  const uiTarget = "Flashcards Open Source App UI Tests";
  const nonUiTarget = "Flashcards Open Source App Tests";
  const smokeTests = JSON.parse(readFileSync(new URL("../../../apps/ios/Flashcards/CloudSmoke.xctestplan", import.meta.url), "utf8")).testTargets[0].selectedTests;
  const ipadTests = ["LiveSmokeIPadTests/testIPadCompanionPreservesDraftAndRevealedReviewAcrossSections()", "LiveSmokeIPadTests/testIPadReviewHardwareKeysRespectFilterAndRateCards()", "LiveSmokeAIConsentTests/testWideCompanionAndCardHandoffStayBlockedAfterWithdrawal()"];
  const plans = { "local-full": "LocalFull", "local-ipad": "LocalIPad", "local-ios18": "IOS18Compatibility", "cloud-smoke": "CloudSmoke" };
  const localCloud = structuredClone(manifest);
  localCloud.schemaVersion = 3;
  localCloud.results = [];
  localCloud.gates = ["local-archive", ...Object.keys(plans).slice(0, 3), "cloud-archive", "cloud-smoke"].map((id) => {
    const base = { ...structuredClone(manifest.gates[0]), id, cases: [] };
    const testPlan = plans[id];
    if (testPlan === undefined) return base;
    const destination = { id: `${id}-device`, model: id === "local-ipad" ? "iPad" : "iPhone", osVersion: id === "local-ios18" ? "18.7" : "27.0", kind: id === "local-ipad" ? "ipad" : "iphone" };
    const tests = id === "local-ipad" ? ipadTests : smokeTests;
    base.selection = { scheme: "Flashcards Native Acceptance", testPlan, configuration: "Acceptance", destination };
    base.cases = tests.map((test) => ({ id: `${test}@${destination.id}`, target: uiTarget, disposition: "required" }));
    if (id === "local-full") base.cases.push({ id: `FsrsSchedulerParityTests/testFullFsrsVectors()@${destination.id}`, target: nonUiTarget, disposition: "required" });
    return base;
  });
  const partial = invoke(localCloud);
  assert.equal(partial.exitCode, 1);
  assert.equal(partial.report.gates.length, 6);
  assert.ok(partial.report.gates.every((gate) => !gate.ready && gate.errors.includes("missing recorded gate evidence")));
  const cloudIndex = localCloud.gates.findIndex((gate) => gate.id === "cloud-smoke");
  const selectedCloud = localCloud.gates[cloudIndex];
  localCloud.results = [{ ...structuredClone(manifest.results[0]), gateId: selectedCloud.id, identity: structuredClone(selectedCloud.identity), status: "passed", warningReview: "complete", warnings: [], cases: selectedCloud.cases.map((test) => ({ id: test.id, status: "passed" })) }];
  assert.equal(invoke(localCloud).report.gates[cloudIndex].ready, true);
  for (const status of ["failed", "pending", "skipped"]) {
    const changed = structuredClone(localCloud);
    Object.assign(changed.results[0].cases[0], { status, reason: "Unexpected native skip" });
    assert.equal(invoke(changed).report.gates[cloudIndex].ready, false);
  }
  const missingSmoke = structuredClone(localCloud);
  missingSmoke.results[0].cases.pop();
  assert.equal(invoke(missingSmoke).report.gates[cloudIndex].counts.missing, 1);
  for (const key of ["sourceSha", "version", "build", "artifactId", "runId"]) {
    const changed = structuredClone(localCloud);
    changed.results[0].identity[key] = key === "sourceSha" ? "f".repeat(40) : "different-identity";
    assert.equal(invoke(changed).report.gates[cloudIndex].ready, false);
  }
  const wrongDestination = structuredClone(localCloud);
  wrongDestination.gates[cloudIndex].selection.destination.id = "unselected-device";
  expectInvalid(wrongDestination, `manifest.gates[${cloudIndex}].cases[0].id`);
  const missingNonUi = structuredClone(localCloud);
  missingNonUi.gates[1].cases = missingNonUi.gates[1].cases.filter((test) => test.target !== nonUiTarget);
  expectInvalid(missingNonUi, "manifest.gates[1].cases");
  const narrowed = structuredClone(localCloud);
  narrowed.gates[cloudIndex].cases.pop();
  expectInvalid(narrowed, `manifest.gates[${cloudIndex}].cases`);
  const wrongPlan = structuredClone(localCloud);
  wrongPlan.gates[cloudIndex].selection.testPlan = "LocalFull";
  expectInvalid(wrongPlan, `manifest.gates[${cloudIndex}].selection.testPlan`);
  const completeLocalCloud = structuredClone(localCloud);
  completeLocalCloud.results = completeLocalCloud.gates.map((gate) => ({
    ...structuredClone(localCloud.results[0]), gateId: gate.id, identity: structuredClone(gate.identity),
    cases: gate.cases.map((test) => ({ id: test.id, status: "passed" })),
  }));
  assert.equal(invoke(completeLocalCloud).exitCode, 0);
  const localOnly = structuredClone(completeLocalCloud);
  localOnly.schemaVersion = 4;
  localOnly.gates = localOnly.gates.filter((gate) => gate.id !== "cloud-smoke");
  localOnly.results = localOnly.results.filter((result) => result.gateId !== "cloud-smoke");
  const readyLocal = invoke(localOnly);
  assert.equal(readyLocal.exitCode, 0);
  assert.equal(readyLocal.report.ready, true);
  assert.equal(readyLocal.report.schemaVersion, 4);
  assert.deepEqual(readyLocal.report.gates.map((gate) => gate.id), ["local-archive", "local-full", "local-ipad", "local-ios18", "cloud-archive"]);
  const historicalWithoutSmoke = structuredClone(localOnly);
  historicalWithoutSmoke.schemaVersion = 3;
  expectInvalid(historicalWithoutSmoke, "manifest.gates");
  const androidLocalOnly = structuredClone(localOnly);
  androidLocalOnly.platform = "android";
  expectInvalid(androidLocalOnly, "manifest.platform");
  const extraCloudGate = structuredClone(completeLocalCloud);
  extraCloudGate.schemaVersion = 4;
  expectInvalid(extraCloudGate, "manifest.gates");
  const extraCloudResult = structuredClone(localOnly);
  extraCloudResult.results.push(structuredClone(localCloud.results[0]));
  expectInvalid(extraCloudResult, "manifest.results");
  for (const [index, gate] of localOnly.gates.entries()) {
    const absent = structuredClone(localOnly);
    absent.gates.splice(index, 1);
    expectInvalid(absent, "manifest.gates");
    const unrecorded = structuredClone(localOnly);
    unrecorded.results.splice(index, 1);
    const blocked = invoke(unrecorded);
    assert.equal(blocked.exitCode, 1);
    assert.ok(blocked.report.gates[index].errors.includes("missing recorded gate evidence"));
    for (const status of ["failed", "pending", "skipped"]) {
      const changed = structuredClone(localOnly);
      changed.results[index].status = status;
      assert.equal(invoke(changed).exitCode, 1);
      if (gate.cases.length === 0) continue;
      changed.results[index].status = "passed";
      Object.assign(changed.results[index].cases[0], { status, reason: "Unexpected native skip" });
      const failedCase = invoke(changed);
      assert.equal(failedCase.exitCode, 1);
      assert.equal(failedCase.report.gates[index].counts[status], 1);
    }
    for (const key of ["sourceSha", "version", "build", "artifactId", "runId"]) {
      const changed = structuredClone(localOnly);
      changed.results[index].identity[key] = key === "sourceSha" ? "f".repeat(40) : "different-identity";
      assert.equal(invoke(changed).exitCode, 1);
    }
    const unreviewed = structuredClone(localOnly);
    unreviewed.results[index].warningReview = "pending";
    assert.equal(invoke(unreviewed).exitCode, 1);
    const wrongInventorySource = structuredClone(localOnly);
    wrongInventorySource.gates[index].inventorySourceSha = "f".repeat(40);
    assert.equal(invoke(wrongInventorySource).exitCode, 1);
    const unattested = structuredClone(localOnly);
    unattested.gates[index].inventoryComplete = false;
    expectInvalid(unattested, `manifest.gates[${index}].inventoryComplete`);
    for (const field of ["inventoryRef", "inventoryReviewedBy"]) {
      const changed = structuredClone(localOnly);
      delete changed.gates[index][field];
      expectInvalid(changed, `manifest.gates[${index}].${field}`);
    }
    const unexpectedCase = structuredClone(localOnly);
    unexpectedCase.results[index].cases.push({ id: "UnexpectedTests/testUnexpected()@unselected-device", status: "passed" });
    assert.equal(invoke(unexpectedCase).exitCode, 1);
    if (gate.cases.length === 0) {
      const buildSelection = structuredClone(localOnly);
      buildSelection.gates[index].selection = structuredClone(localOnly.gates[1].selection);
      expectInvalid(buildSelection, `manifest.gates[${index}].selection`);
      const buildInventory = structuredClone(localOnly);
      buildInventory.gates[index].cases = structuredClone(localOnly.gates[1].cases);
      expectInvalid(buildInventory, `manifest.gates[${index}].cases`);
      continue;
    }
    const missing = structuredClone(localOnly);
    missing.results[index].cases.pop();
    const missingCase = invoke(missing);
    assert.equal(missingCase.exitCode, 1);
    assert.equal(missingCase.report.gates[index].counts.missing, 1);
    const absentSelection = structuredClone(localOnly);
    delete absentSelection.gates[index].selection;
    expectInvalid(absentSelection, `manifest.gates[${index}].selection`);
    for (const [field, value] of [["scheme", "Flashcards"], ["testPlan", "CloudSmoke"], ["configuration", "Debug"]]) {
      const changed = structuredClone(localOnly);
      changed.gates[index].selection[field] = value;
      expectInvalid(changed, `manifest.gates[${index}].selection.${field}`);
    }
    for (const [field, value] of [["id", "unselected-device"], ["osVersion", gate.id === "local-ios18" ? "27.0" : "18.7"], ["osVersion", "Latest"]]) {
      const changed = structuredClone(localOnly);
      changed.gates[index].selection.destination[field] = value;
      expectInvalid(changed, field === "id" ? `manifest.gates[${index}].cases[0].id` : `manifest.gates[${index}].selection.destination.${field}`);
    }
    for (const [field, value] of [["target", nonUiTarget], ["disposition", "manual-exclusion"]]) {
      const changed = structuredClone(localOnly);
      Object.assign(changed.gates[index].cases[0], { [field]: value, reason: "Unexpected exclusion", evidenceRef: "contract/exclusion" });
      expectInvalid(changed, gate.id === "local-full" && field === "target" ? `manifest.gates[${index}].cases` : `manifest.gates[${index}].cases[0].${field}`);
    }
    const narrowedLocal = structuredClone(localOnly);
    narrowedLocal.gates[index].cases.pop();
    expectInvalid(narrowedLocal, `manifest.gates[${index}].cases`);
    const wrongFamily = structuredClone(localOnly);
    wrongFamily.gates[index].selection.destination.kind = "mac";
    expectInvalid(wrongFamily, `manifest.gates[${index}].selection.destination.kind`);
    if (gate.id !== "local-ios18") {
      wrongFamily.gates[index].selection.destination.kind = gate.id === "local-ipad" ? "iphone" : "ipad";
      expectInvalid(wrongFamily, `manifest.gates[${index}].selection.destination.kind`);
    }
  }
  const mismatchedLatest = structuredClone(localOnly);
  mismatchedLatest.gates[2].selection.destination.osVersion = "26.1";
  assert.equal(invoke(mismatchedLatest).exitCode, 1);
  const acceptedWarning = structuredClone(localOnly);
  acceptedWarning.results[0].warnings = [{ id: "vendor-notice", decision: "accepted", notice: "Vendor runtime notice", owner: "vendor", version: "27.0", reason: "Inspected vendor diagnostic", policyRef: "release/warning-policy", evidenceRef: "contract/warning-review" }];
  assert.equal(invoke(acceptedWarning).exitCode, 0);
  for (const decision of ["blocking", "unreviewed"]) {
    const changed = structuredClone(acceptedWarning);
    changed.results[0].warnings[0].decision = decision;
    assert.equal(invoke(changed).exitCode, 1);
  }
  for (const key of ["build", "artifactId"]) {
    const changed = structuredClone(localOnly);
    changed.target[key] = "different-uploaded-archive";
    assert.equal(invoke(changed).exitCode, 1);
  }
  const changedSource = structuredClone(localOnly);
  changedSource.target.sourceSha = "f".repeat(40);
  assert.equal(invoke(changedSource).exitCode, 1);
  changedSource.equivalences = [{ fromSha: localOnly.target.sourceSha, toSha: changedSource.target.sourceSha, gateIds: localOnly.gates.map((gate) => gate.id), comparedInputs: ["apps/ios"], reviewedBy: "contract-reviewer", reason: "Native inputs unchanged", evidenceRef: "contract/source-comparison" }];
  assert.equal(invoke(changedSource).exitCode, 0);
  const duplicateEquivalence = structuredClone(changedSource);
  duplicateEquivalence.equivalences.push(structuredClone(changedSource.equivalences[0]));
  assert.equal(invoke(duplicateEquivalence).exitCode, 1);
  const smokeEquivalence = structuredClone(changedSource);
  smokeEquivalence.equivalences[0].gateIds.push("cloud-smoke");
  expectInvalid(smokeEquivalence, "manifest.equivalences[0].gateIds");
  console.log("Mobile readiness CLI replayed captured Xcode Cloud 606, 603 and the complete 614 destination matrix; historical gates and schema 4 local acceptance enforce complete evidence.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
