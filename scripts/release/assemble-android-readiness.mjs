import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { parseManifest } from "./mobile-readiness.ts";

const apis = ["37", "30", "31", "33"];
const signedJob = "Build and verify signed Android App Bundle";
const publisherJob = "Upload Android bundle to Google Play production draft release";

function requireEvidence(condition, message) {
  if (!condition) throw new TypeError(message);
}

function readJson(path, label) {
  try {
    const input = readFileSync(path);
    return { value: JSON.parse(input), sha256: createHash("sha256").update(input).digest("hex") };
  } catch (error) {
    if (!(error instanceof SyntaxError) && !error.code) throw error;
    throw new TypeError(`Cannot read ${label} as JSON`);
  }
}

function matches(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

function isDigest(value) {
  return matches(value, /^[a-f0-9]{64}$/);
}

function distinct(items) {
  return new Set(items).size === items.length;
}

function sourceFile(sourceSha, path) {
  try {
    return execFileSync("git", ["show", `${sourceSha}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    if (!error.code && !Number.isInteger(error.status)) throw error;
    throw new TypeError(`Cannot read ${path} at the pinned release source. Fetch that commit locally.`);
  }
}

function verifyRun(run, pin, publisher) {
  const { status, conclusion, headSha, databaseId, attempt, url, jobs } = run;
  const attemptUrl = `https://github.com/kirill-markin/flashcards-open-source-app/actions/runs/${pin.runId}/attempts/${pin.attempt}`;
  requireEvidence(Number.isSafeInteger(databaseId) && String(databaseId) === pin.runId &&
    Number.isSafeInteger(attempt) && String(attempt) === pin.attempt && url === attemptUrl,
  `Export GitHub jobs for the pinned run ${pin.runId} and attempt ${pin.attempt} with gh run view --attempt`);
  requireEvidence(status === "completed" && conclusion === "success" &&
    matches(headSha, /^[a-f0-9]{40}$/) && headSha === publisher.workflowSha &&
    Array.isArray(jobs) && jobs.every((job) => job?.conclusion === "success"),
  "The retained Android Release workflow must be complete and green at the publisher's workflow SHA");
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const requiredJobs = ["Resolve Android release target", "Android CI / Android build, unit tests, and lint",
    "Android CI / Android emulator data:local instrumentation", "Device Run app instrumentation",
    publisherJob, "Android release summary"];
  requireEvidence(byName.size === jobs.length && requiredJobs.every((name) => byName.has(name)),
    "The retained workflow is missing required Android Release jobs or has duplicate jobs");
  const signed = byName.get(signedJob) ?? byName.get(publisherJob);
  const requiredSteps = ["Build signed Android App Bundle", "Upload signed Android App Bundle artifact",
    "Report and gate R8 optimization coverage"];
  if (byName.has(signedJob)) requiredSteps.push("Record signed Android App Bundle checksum");
  for (const [job, steps] of [
    [signed, requiredSteps],
    [byName.get("Device Run app instrumentation"), ["Collect private native evidence and gate named results"]],
    [byName.get(publisherJob), ["Upload bundle to Google Play production track as draft release"]],
  ]) {
    requireEvidence(Array.isArray(job.steps) && steps.every((step) =>
      job.steps.filter((entry) => entry?.name === step && entry.conclusion === "success").length === 1),
    "A signed bundle, native collection, R8 or publisher step is missing or failed");
  }
}

function verifyPublisher(publisher, pin, releaseId, aabSha256) {
  const { sourceSha, versionCode, runId, attempt } = pin;
  const releaseName = `main-draft-${releaseId}`;
  requireEvidence(publisher.sourceSha === sourceSha && publisher.versionCode === versionCode &&
    publisher.publisherRunId === runId && publisher.publisherRunAttempt === attempt &&
    publisher.aabSha256 === aabSha256 && publisher.releaseName === releaseName &&
    publisher.commitStatus === "confirmed" && publisher.committed === true &&
    publisher.changesInReviewBehavior === "ERROR_IF_IN_REVIEW",
  "Play publisher does not confirm the pinned source, run, attempt, release code and AAB");
  const { track, releases } = publisher.track ?? {};
  requireEvidence(track === "production" && Array.isArray(releases) && releases.length === 1 &&
    releases[0]?.status === "draft" && releases[0].name === releaseName &&
    Array.isArray(releases[0].versionCodes) && releases[0].versionCodes.length === 1 &&
    releases[0].versionCodes[0] === versionCode, "Play did not return a single production draft for the pinned version code");
}

function checkedCases(cases, api) {
  requireEvidence(Array.isArray(cases) && cases.every((test) => test?.status === "passed" &&
    test.count === 1 && matches(test.identity, /^com\.flashcardsopensourceapp\.app\.[\w.]+#\w+$/)),
  `API ${api} contains a malformed, duplicate or nonpassing named result`);
  const names = cases.map((test) => test.identity);
  requireEvidence(distinct(names), `API ${api} contains duplicate named results`);
  return names;
}

function verifySession(session, expected, device) {
  const { api, session_id: sessionId, report, executions, counts } = session;
  requireEvidence(session.device === device && session.selection === (api === "37" ? "latest" : `compat-api${api}`) &&
    session.passed === true && Array.isArray(session.problems) && session.problems.length === 0 &&
    matches(sessionId, /^session-[a-f0-9-]+$/) && report?.member === `${sessionId}/session-full.json` &&
    isDigest(report.sha256), `API ${api} is missing passing native evidence for the configured device`);
  const names = checkedCases(session.cases, api);
  requireEvidence(session.expected_count === expected.size && names.length === expected.size &&
    names.every((name) => expected.has(name)) && counts?.passed === expected.size &&
    counts.failure === 0 && counts.error === 0 && counts.skipped === 0,
  `API ${api} does not contain the exact configured named selection and passing totals`);
  requireEvidence(Array.isArray(executions) && executions.length > 0 && executions.every((execution) =>
    execution?.terminal_passed === true && Array.isArray(execution.cases) &&
    execution.case_count === execution.cases.length && execution.case_count > 0 &&
    matches(execution.id, /^[a-f0-9-]{36}$/) && Array.isArray(execution.artifacts) &&
    execution.artifacts.some((artifact) => matches(artifact?.object, /\/(?:merged_)?junit\.xml$/) && isDigest(artifact.sha256)) &&
    execution.artifacts.some((artifact) => matches(artifact?.object, /\/logcat\.txt$/) && isDigest(artifact.sha256))) &&
    distinct(executions.map((execution) => execution.id)),
  `API ${api} is missing terminal passing execution evidence`);
  const executed = checkedCases(executions.flatMap((execution) => execution.cases), api);
  requireEvidence(executed.length === expected.size && executed.every((name) => expected.has(name)),
    `API ${api} execution cases do not reconcile to the session selection`);
  return names.map((name) => `${name.replace("#", "/")}@${device}`);
}

function verifyNative(summary, pin, releaseId, compat) {
  const { sourceSha, runId, attempt, devices } = pin;
  const { latest_inventory: latest, sessions } = summary;
  requireEvidence(summary.target_sha === sourceSha && summary.github_run_id === runId &&
    summary.github_run_attempt === attempt && summary.release_id === releaseId &&
    summary.private_archive_uploaded === true && isDigest(summary.private_archive_sha256) &&
    typeof summary.private_archive === "string" &&
    summary.private_archive.endsWith(`/release-evidence/${sourceSha}/r${runId}a${attempt}/raw.tar.gz`),
  "Native summary does not match the pinned release or lacks the retained private archive");
  requireEvidence(Array.isArray(latest) && distinct(latest) && compat.length === 4 &&
    distinct(compat) && compat.every((name) => latest.includes(name)), "Latest or compatibility source inventory is invalid");
  requireEvidence(Array.isArray(sessions) && sessions.length === apis.length &&
    distinct(sessions.map((session) => session?.api)) && apis.every((api) => sessions.some((session) => session?.api === api)) &&
    apis.every((api) => matches(devices?.[api], /^[A-Za-z0-9_-]+$/)) && distinct(apis.map((api) => devices[api])),
  "Native summary and device pins must cover the four configured APIs on distinct devices");
  const required = sessions.flatMap((session) =>
    verifySession(session, new Set(session.api === "37" ? latest : compat), devices[session.api]));
  const retries = sessions.filter((session) => Object.hasOwn(session, "initial_failure")).map((session) => {
    const failure = session.initial_failure;
    requireEvidence(failure?.selection === session.selection && failure.reason === "lab_dns_before_auth_request" &&
      matches(failure.session_id, /^session-[a-f0-9-]+$/) &&
      failure.report?.member === `${failure.session_id}/session-full.json` && isDigest(failure.report.sha256),
    "Retried Device Run destination is missing the original classified failure evidence");
    return { api: session.api, sessionId: failure.session_id, reason: failure.reason, reportSha256: failure.report.sha256 };
  });
  const sessionIds = sessions.map((session) => session.session_id);
  requireEvidence(retries.length <= 1 && distinct([...sessionIds, ...retries.map((retry) => retry.sessionId)]),
    "Device Run session identities are duplicated or exceed the single allowed retry");
  const [appSha256, testSha256] = ["app", "test"].map((kind) => {
    const hashes = sessions.map((session) => {
      const artifacts = Array.isArray(session.artifacts) ? session.artifacts.filter((item) => item?.kind === kind) : [];
      requireEvidence(artifacts.length === 1 && isDigest(artifacts[0].sha256), `Native summary lacks a verified ${kind} APK hash`);
      return artifacts[0].sha256;
    });
    requireEvidence(new Set(hashes).size === 1, `Device Run sessions used different ${kind} APK bytes`);
    return hashes[0];
  });
  return { required, sessionIds, retries, appSha256, testSha256 };
}

async function assemble(review, run, native, publisher, bundlePath) {
  const { sourceSha, version, versionCode, runId, attempt, aabSha256, reviewedBy, reviews } = review;
  requireEvidence(matches(sourceSha, /^[a-f0-9]{40}$/) && isDigest(aabSha256) &&
    [versionCode, runId, attempt].every((value) => matches(value, /^[1-9][0-9]*$/)),
  "Pin the full release source SHA, signed AAB SHA-256, version code, run ID and attempt as strings");
  const versions = [...sourceFile(sourceSha, "apps/android/app/build.gradle.kts").matchAll(/versionName\s*=\s*"([^"]+)"/g)];
  requireEvidence(versions.length === 1 && versions[0][1] === version, "Pinned marketing version differs from the release source");
  const selection = JSON.parse(sourceFile(sourceSha, "scripts/android/device-run-test-selection.json"));
  requireEvidence(Array.isArray(selection.compat) && selection.compat.every((value) => matches(value, /^class \S+$/)),
    "Pinned source does not declare the supported compatibility selection");
  const compat = selection.compat.map((value) => value.slice("class ".length));
  const releaseId = `vc${versionCode}-r${runId}a${attempt}-s${sourceSha.slice(0, 8)}`;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(bundlePath)) hash.update(chunk);
  requireEvidence(hash.digest("hex") === aabSha256, "Downloaded signed AAB differs from the pinned checksum");
  verifyPublisher(publisher.value, review, releaseId, aabSha256);
  verifyRun(run.value, review, publisher.value);
  const { required, appSha256, testSha256, sessionIds, retries } = verifyNative(native.value, review, releaseId, compat);

  const target = { sourceSha, version, build: versionCode, artifactId: `sha256-${aabSha256}` };
  const cloudIdentity = { ...target, runId: `${runId}-attempt-${attempt}` };
  const nativeIdentity = { ...cloudIdentity, artifactId: `sha256-${appSha256}` };
  const gates = [];
  const results = [];
  for (const [id, identity, names] of [
    ["cloud-release", cloudIdentity, []],
    ["firebase-tests", nativeIdentity, required],
  ]) {
    const { inventoryRef, evidenceRef, warningReview, warningReviewRef, warnings } = reviews[id];
    gates.push({ id, identity, inventorySourceSha: sourceSha, inventoryRef, inventoryReviewedBy: reviewedBy,
      inventoryComplete: true, cases: names.map((name) => ({ id: name, disposition: "required" })) });
    results.push({ gateId: id, identity, status: "passed", evidenceRef, warningReview, warningReviewRef, warnings,
      cases: names.map((name) => ({ id: name, status: "passed" })) });
  }
  const manifest = parseManifest({ schemaVersion: 2, platform: "android", target, gates, results, equivalences: [] });
  return { ...manifest, androidEvidence: { releaseId, nativeSummarySha256: native.sha256,
    publisherSha256: publisher.sha256, githubRunSha256: run.sha256, testSha256, sessionIds, retries } };
}

try {
  const [review, run, native, publisher, bundle, ...extra] = process.argv.slice(2);
  requireEvidence(bundle && !extra.length,
    "Usage: node scripts/release/assemble-android-readiness.mjs review.json github-run.json summary.json play-publisher-provenance.json app-release.aab");
  const manifest = await assemble(readJson(review, "review").value, readJson(run, "GitHub run"),
    readJson(native, "native summary"), readJson(publisher, "Play publisher provenance"), bundle);
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  if (!(error instanceof TypeError) && !error.code && !(error instanceof SyntaxError)) throw error;
  console.error(error instanceof TypeError ? error.message : "Android readiness inputs could not be read");
  process.exitCode = 2;
}
