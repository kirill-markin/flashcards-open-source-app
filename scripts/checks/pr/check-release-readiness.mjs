import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../release/check-mobile-readiness.mjs", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("./fixtures/release-readiness/ios-1.30.0.json", import.meta.url), "utf8"));
const directory = mkdtempSync(join(tmpdir(), "mobile-readiness-"));

function recordedCloudManifest(capture) {
  const identity = { sourceSha: capture.sourceSha, version: "1.30.0", build: capture.number, artifactId: capture.actionId, runId: capture.runId };
  return {
    schemaVersion: 1, platform: "ios",
    target: { sourceSha: capture.sourceSha, version: "1.30.0", build: "not-captured", artifactId: "not-captured" },
    gates: ["local-archive", "local-smoke", "cloud-archive", "cloud-tests"].map((id) => ({
      id, identity: id === "cloud-tests" ? identity : { ...identity, build: "not-captured", artifactId: "not-captured", runId: "not-captured" },
      inventorySourceSha: capture.sourceSha, inventoryRef: capture.inventoryRef, inventoryReviewedBy: "captured-source-review", inventoryComplete: true,
      cases: id === "cloud-tests" ? capture.inventory : id === "local-smoke" ? capture.inventory.filter((test) => test.id.includes("/testLiveSmokeGuestNavigationFlow()")) : [],
    })),
    results: [{
      gateId: "cloud-tests", identity,
      // Preserve the vendor run summary to prove it cannot hide failed named cases.
      status: capture.overallRunStatus === "SUCCEEDED" ? "passed" : "failed",
      evidenceRef: capture.sourceRef, warningReview: capture.number === "606" ? "complete" : "pending", warningReviewRef: `release-1.30.0/ios/cloud/${capture.number}/${capture.number === "606" ? "final-inspection.json" : "failure-root-cause.json"}`,
      warnings: [], cases: capture.cases,
    }],
    equivalences: [],
  };
}
function invoke(manifest) {
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  const execution = spawnSync(process.execPath, [cli, path], { encoding: "utf8", shell: false });
  if (execution.error !== undefined) throw execution.error;
  assert.equal(execution.signal, null);
  assert.equal(execution.stderr, "");
  return { exitCode: execution.status, report: JSON.parse(execution.stdout) };
}

try {
  const [passed, failed] = fixture.captures.map((capture) => invoke(recordedCloudManifest(capture)));
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
  console.log("Mobile readiness CLI replayed captured Xcode Cloud 606 and 603 named-case evidence; absent gates remain blocked.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
