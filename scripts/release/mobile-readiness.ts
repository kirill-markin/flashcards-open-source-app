type Platform = "ios" | "android";
type Status = "passed" | "failed" | "skipped" | "pending";
type Identity = { sourceSha: string; version: string; build: string; artifactId: string; runId: string };
type InventoryCase = { id: string; disposition: "required" | "manual-exclusion" | "destination-exclusion"; reason: string; evidenceRef: string; requiredCaseId: string };
type Gate = {
  id: string; identity: Identity; inventorySourceSha: string;
  inventoryRef: string; inventoryReviewedBy: string; inventoryComplete: true; cases: InventoryCase[];
};
type Warning = {
  id: string; decision: "accepted" | "blocking" | "unreviewed";
  notice: string; owner: string; version: string; reason: string; policyRef: string; evidenceRef: string;
};
type Result = {
  gateId: string; identity: Identity; status: Status; evidenceRef: string;
  warningReview: "complete" | "pending"; warningReviewRef: string;
  warnings: Warning[]; cases: { id: string; status: Status; reason: string }[];
};
type Equivalence = {
  fromSha: string; toSha: string; gateIds: string[]; comparedInputs: string[];
  reviewedBy: string; reason: string; evidenceRef: string;
};
export type Manifest = {
  target: { sourceSha: string; version: string; build: string; artifactId: string };
  gates: Gate[]; results: Result[]; equivalences: Equivalence[];
} & ({ schemaVersion: 1; platform: Platform } | { schemaVersion: 2; platform: "android" });
type GateReport = {
  id: string; ready: boolean; expectedIdentity: Identity; recordedIdentity: Identity | null;
  evidenceRef: string | null; inventoryRef: string; errors: string[];
  cases: { id: string; status: Status; disposition: string; exclusionRef: string | null; requiredCaseId: string | null }[];
  counts: { passed: number; failed: number; skipped: number; pending: number; missing: number };
  warningReviewRef: string | null;
  warnings: { id: string; decision: string; owner: string; version: string; policyRef: string; evidenceRef: string }[];
};

const SCHEMA_1_GATES: Record<Platform, readonly string[]> = {
  ios: ["local-archive", "local-smoke", "cloud-archive", "cloud-tests"],
  android: ["local-ci", "local-release", "local-smoke", "cloud-release", "firebase-tests"],
};
const ANDROID_CLOUD_GATES: readonly string[] = ["cloud-release", "firebase-tests"];
const TEST_GATES = new Set(["local-ci", "local-smoke", "cloud-tests", "firebase-tests"]);
const STATUSES = ["passed", "failed", "skipped", "pending"] as const;

// Error messages contain field paths only: untrusted evidence may contain credentials or URLs.
function invalid(path: string, requirement: string): never {
  throw new TypeError(`${path}: ${requirement}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "expected object");
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "expected array");
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) invalid(path, "expected nonempty text, at most 2000 characters");
  return value;
}
function token(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/() @+\-]*$/.test(result)) invalid(path, "expected secret-free identifier or record reference, without URLs/query strings");
  return result;
}
function sha(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^[a-f0-9]{40}$/.test(result)) invalid(path, "expected full lowercase Git SHA");
  return result;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path, `expected one of ${choices.join(", ")}`);
  return value as T;
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path, "duplicate identities are not allowed");
}
function identity(value: unknown, path: string): Identity {
  const item = object(value, path);
  return {
    sourceSha: sha(item.sourceSha, `${path}.sourceSha`), version: token(item.version, `${path}.version`),
    build: token(item.build, `${path}.build`), artifactId: token(item.artifactId, `${path}.artifactId`), runId: token(item.runId, `${path}.runId`),
  };
}
function inventoryCase(value: unknown, path: string): InventoryCase {
  const item = object(value, path);
  const disposition = choice(item.disposition, ["required", "manual-exclusion", "destination-exclusion"], `${path}.disposition`);
  return {
    id: token(item.id, `${path}.id`), disposition,
    reason: disposition !== "required" ? text(item.reason, `${path}.reason`) : "",
    evidenceRef: disposition !== "required" ? token(item.evidenceRef, `${path}.evidenceRef`) : "",
    requiredCaseId: disposition === "destination-exclusion" ? token(item.requiredCaseId, `${path}.requiredCaseId`) : "",
  };
}
function destinationCaseIdentity(id: string, path: string): { test: string; destination: string } {
  const match = /^([^/@]+\/[^/@]+\(\))@([^@]+)$/.exec(id);
  if (match === null || match[2].trim().length === 0) invalid(path, "expected Class/method()@destination identity");
  return { test: match[1], destination: match[2] };
}
function gate(value: unknown, path: string): Gate {
  const item = object(value, path);
  if (item.inventoryComplete !== true) invalid(`${path}.inventoryComplete`, "operator must attest the full configured inventory is represented");
  const cases = array(item.cases, `${path}.cases`).map((entry, index) => inventoryCase(entry, `${path}.cases[${index}]`));
  unique(cases.map((entry) => entry.id), `${path}.cases`);
  return {
    id: token(item.id, `${path}.id`), identity: identity(item.identity, `${path}.identity`), inventoryComplete: true, cases,
    inventorySourceSha: sha(item.inventorySourceSha, `${path}.inventorySourceSha`),
    inventoryRef: token(item.inventoryRef, `${path}.inventoryRef`),
    inventoryReviewedBy: token(item.inventoryReviewedBy, `${path}.inventoryReviewedBy`),
  };
}
function warning(value: unknown, path: string): Warning {
  const item = object(value, path);
  return {
    id: token(item.id, `${path}.id`), decision: choice(item.decision, ["accepted", "blocking", "unreviewed"], `${path}.decision`),
    notice: text(item.notice, `${path}.notice`), owner: token(item.owner, `${path}.owner`), version: token(item.version, `${path}.version`),
    reason: text(item.reason, `${path}.reason`), policyRef: token(item.policyRef, `${path}.policyRef`), evidenceRef: token(item.evidenceRef, `${path}.evidenceRef`),
  };
}
function result(value: unknown, path: string): Result {
  const item = object(value, path);
  const warnings = array(item.warnings, `${path}.warnings`).map((entry, index) => warning(entry, `${path}.warnings[${index}]`));
  const cases = array(item.cases, `${path}.cases`).map((entry, index) => {
    const at = `${path}.cases[${index}]`;
    const test = object(entry, at);
    const status = choice(test.status, STATUSES, `${at}.status`);
    return { id: token(test.id, `${at}.id`), status, reason: status === "skipped" ? text(test.reason, `${at}.reason`) : "" };
  });
  unique(cases.map((entry) => entry.id), `${path}.cases`);
  unique(warnings.map((entry) => entry.id), `${path}.warnings`);
  return {
    gateId: token(item.gateId, `${path}.gateId`), identity: identity(item.identity, `${path}.identity`),
    status: choice(item.status, STATUSES, `${path}.status`), evidenceRef: token(item.evidenceRef, `${path}.evidenceRef`),
    warningReview: choice(item.warningReview, ["complete", "pending"], `${path}.warningReview`),
    warningReviewRef: token(item.warningReviewRef, `${path}.warningReviewRef`), warnings, cases,
  };
}
function equivalence(value: unknown, path: string): Equivalence {
  const item = object(value, path);
  const gateIds = array(item.gateIds, `${path}.gateIds`).map((entry, index) => token(entry, `${path}.gateIds[${index}]`));
  const comparedInputs = array(item.comparedInputs, `${path}.comparedInputs`).map((entry, index) => token(entry, `${path}.comparedInputs[${index}]`));
  if (gateIds.length === 0 || comparedInputs.length === 0) invalid(path, "gateIds and comparedInputs must be nonempty");
  unique(gateIds, `${path}.gateIds`);
  return {
    fromSha: sha(item.fromSha, `${path}.fromSha`), toSha: sha(item.toSha, `${path}.toSha`), gateIds, comparedInputs,
    reviewedBy: token(item.reviewedBy, `${path}.reviewedBy`), reason: text(item.reason, `${path}.reason`), evidenceRef: token(item.evidenceRef, `${path}.evidenceRef`),
  };
}

export function parseManifest(value: unknown): Manifest {
  const item = object(value, "manifest");
  const schemaVersion = item.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) invalid("manifest.schemaVersion", "expected 1 or 2");
  const platform = choice(item.platform, ["ios", "android"], "manifest.platform");
  if (schemaVersion === 2 && platform !== "android") invalid("manifest.platform", "schema 2 requires android; iOS uses schema 1");
  const requiredGates = schemaVersion === 1 ? SCHEMA_1_GATES[platform] : ANDROID_CLOUD_GATES;
  const target = object(item.target, "manifest.target");
  const gates = array(item.gates, "manifest.gates").map((entry, index) => gate(entry, `manifest.gates[${index}]`));
  const results = array(item.results, "manifest.results").map((entry, index) => result(entry, `manifest.results[${index}]`));
  const equivalences = array(item.equivalences, "manifest.equivalences").map((entry, index) => equivalence(entry, `manifest.equivalences[${index}]`));
  unique(gates.map((entry) => entry.id), "manifest.gates");
  unique(results.map((entry) => entry.gateId), "manifest.results");
  if (gates.length !== requiredGates.length || gates.some((entry) => !requiredGates.includes(entry.id))) invalid("manifest.gates", `must declare exactly ${requiredGates.join(", ")}`);
  if (results.some((entry) => !requiredGates.includes(entry.gateId))) invalid("manifest.results", "unknown gate");
  for (const [index, entry] of gates.entries()) {
    if (TEST_GATES.has(entry.id) && !entry.cases.some((test) => test.disposition === "required")) invalid(`manifest.gates[${index}].cases`, "test gate needs a nonempty required inventory");
    if (!TEST_GATES.has(entry.id) && entry.cases.length !== 0) invalid(`manifest.gates[${index}].cases`, "build gate inventory must be empty");
    for (const [caseIndex, test] of entry.cases.entries()) {
      if (test.disposition !== "destination-exclusion") continue;
      const path = `manifest.gates[${index}].cases[${caseIndex}]`;
      if (platform !== "ios" || entry.id !== "cloud-tests") invalid(`${path}.disposition`, "destination exclusions require iOS cloud-tests");
      const excluded = destinationCaseIdentity(test.id, `${path}.id`);
      const required = destinationCaseIdentity(test.requiredCaseId, `${path}.requiredCaseId`);
      if (excluded.test !== required.test || excluded.destination === required.destination) invalid(`${path}.requiredCaseId`, "must identify the same logical test on a different destination");
      if (!entry.cases.some((candidate) => candidate.id === test.requiredCaseId && candidate.disposition === "required")) invalid(`${path}.requiredCaseId`, "must reference a required case in the same gate");
    }
  }
  for (const [index, entry] of equivalences.entries()) {
    if (entry.gateIds.some((id) => !requiredGates.includes(id))) invalid(`manifest.equivalences[${index}].gateIds`, "unknown gate");
  }
  const contents = {
    target: { sourceSha: sha(target.sourceSha, "manifest.target.sourceSha"), version: token(target.version, "manifest.target.version"), build: token(target.build, "manifest.target.build"), artifactId: token(target.artifactId, "manifest.target.artifactId") },
    gates, results, equivalences,
  };
  return schemaVersion === 1 ? { ...contents, schemaVersion, platform } : { ...contents, schemaVersion, platform: "android" };
}

function checkGate(gate: Gate, manifest: Manifest): GateReport {
  const result = manifest.results.find((entry) => entry.gateId === gate.id);
  const errors: string[] = [];
  if (gate.identity.version !== manifest.target.version) errors.push("expected gate version differs from target version");
  if (gate.inventorySourceSha !== gate.identity.sourceSha) errors.push("inventory source differs from gate source");
  if (gate.identity.sourceSha !== manifest.target.sourceSha) {
    const matching = manifest.equivalences.filter((entry) => entry.fromSha === gate.identity.sourceSha && entry.toSha === manifest.target.sourceSha && entry.gateIds.includes(gate.id));
    if (matching.length !== 1) errors.push("source differs from target without exactly one bounded equivalence record");
  }
  const artifactGate = manifest.platform === "ios" ? "cloud-archive" : "cloud-release";
  if (gate.id === artifactGate && (gate.identity.build !== manifest.target.build || gate.identity.artifactId !== manifest.target.artifactId)) errors.push("distribution artifact/build differs from target");
  if (result === undefined) errors.push("missing recorded gate evidence");
  const counts = { passed: 0, failed: 0, skipped: 0, pending: 0, missing: 0 };
  if (result !== undefined) {
    for (const key of ["sourceSha", "version", "build", "artifactId", "runId"] as const) {
      if (result.identity[key] !== gate.identity[key]) errors.push(`recorded identity.${key} differs from expected identity`);
    }
    if (result.status !== "passed") errors.push(`gate status is ${result.status}`);
    if (result.warningReview !== "complete") errors.push("warning inspection is unfinished");
    for (const warning of result.warnings) {
      if (warning.decision !== "accepted") errors.push(`warning ${warning.id} is ${warning.decision}`);
    }
    for (const test of result.cases) {
      counts[test.status] += 1;
      const expected = gate.cases.find((entry) => entry.id === test.id);
      if (expected === undefined) errors.push(`unexpected case ${test.id}`);
      if (test.status === "failed" || test.status === "pending") errors.push(`case ${test.id} is ${test.status}`);
      if (test.status === "skipped" && (expected === undefined || expected.disposition === "required" || expected.reason !== test.reason)) errors.push(`case ${test.id} is skipped without matching declared exclusion`);
    }
  }
  for (const test of gate.cases) {
    if (!result?.cases.some((entry) => entry.id === test.id)) {
      counts.missing += 1;
      errors.push(`missing case ${test.id}`);
    }
    if (test.disposition === "destination-exclusion" && !result?.cases.some((entry) => entry.id === test.requiredCaseId && entry.status === "passed")) errors.push(`case ${test.id} requires passed counterpart ${test.requiredCaseId}`);
  }
  return {
    id: gate.id, ready: errors.length === 0, expectedIdentity: gate.identity, recordedIdentity: result?.identity ?? null,
    evidenceRef: result?.evidenceRef ?? null, inventoryRef: gate.inventoryRef, errors, counts,
    cases: (result?.cases ?? []).map((test) => {
      const expected = gate.cases.find((entry) => entry.id === test.id);
      return { id: test.id, status: test.status, disposition: expected?.disposition ?? "unexpected", exclusionRef: expected?.evidenceRef || null, requiredCaseId: expected?.requiredCaseId || null };
    }),
    warningReviewRef: result?.warningReviewRef ?? null,
    warnings: (result?.warnings ?? []).map(({ id, decision, owner, version, policyRef, evidenceRef }) => ({ id, decision, owner, version, policyRef, evidenceRef })),
  };
}

export function checkReadiness(manifest: Manifest): {
  schemaVersion: number; scope: string; platform: Platform; target: Manifest["target"]; ready: boolean;
  errors: string[]; gates: GateReport[]; equivalences: Omit<Equivalence, "reason">[]; limits: string[];
} {
  const gates = manifest.gates.map((gate) => checkGate(gate, manifest));
  const errors: string[] = [];
  for (const [index, entry] of manifest.equivalences.entries()) {
    if (entry.toSha !== manifest.target.sourceSha || entry.fromSha === entry.toSha || entry.gateIds.some((id) => manifest.gates.find((gate) => gate.id === id)?.identity.sourceSha !== entry.fromSha)) errors.push(`equivalences[${index}] does not match the declared gate sources and target`);
  }
  if (manifest.platform === "android") {
    const release = manifest.gates.find((gate) => gate.id === "cloud-release")!;
    const firebase = manifest.gates.find((gate) => gate.id === "firebase-tests")!;
    for (const key of ["sourceSha", "version", "build", "runId"] as const) {
      if (release.identity[key] !== firebase.identity[key]) errors.push(`firebase-tests and cloud-release ${key} must match (use matrix identity in evidenceRef)`);
    }
  }
  return {
    schemaVersion: manifest.schemaVersion, scope: "recorded-mobile-build-and-test-gates", platform: manifest.platform, target: manifest.target,
    ready: errors.length === 0 && gates.every((gate) => gate.ready), errors, gates,
    equivalences: manifest.equivalences.map(({ reason, ...entry }) => entry),
    limits: [
      "Offline supplied evidence only; no independent vendor, source-diff, inventory-completeness or artifact verification.",
      "Warning acceptance, source equivalence and destination eligibility are operator adjudications; references are not security proof.",
      "Inspect full native diagnostics and logs, store processing, binary localizations, metadata, signing and artifact provenance manually.",
      "Store submission, release settings, publication and public availability remain manual gates; ready is not operator completion or live release.",
    ],
  };
}
