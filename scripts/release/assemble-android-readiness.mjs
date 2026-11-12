import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { parseManifest } from "./mobile-readiness.ts";

const deviceId = /^[A-Za-z0-9_-]+$/;
const methodTarget = /^class com\.flashcardsopensourceapp\.app\.[\w.]+#\w+$/;
const signedJob = "Build and verify signed Android App Bundle";
const publisherJob = "Upload Android bundle to Google Play production draft release";
const wearPublisherJob = "Upload Wear OS bundle to Google Play Wear OS internal testing release";

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

function verifyRun(run, pin, publisher, hasWear) {
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
    publisherJob, "Android release summary", ...(hasWear ? [wearPublisherJob] : [])];
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
    ...(hasWear ? [[byName.get(wearPublisherJob), ["Upload Wear OS bundle to Google Play Wear OS internal testing track"]]] : []),
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

function verifyWearPublisher(wear, pin, publisher) {
  const { sourceSha, wearVersionCode, wearAabSha256, runId, attempt } = pin;
  const releaseName = `main-draft-vc${wearVersionCode}-r${runId}a${attempt}-s${sourceSha.slice(0, 8)}`;
  requireEvidence(wear.sourceSha === sourceSha && wear.versionCode === wearVersionCode &&
    wear.publisherRunId === runId && wear.publisherRunAttempt === attempt &&
    wear.workflowSha === publisher.workflowSha && wear.aabSha256 === wearAabSha256 &&
    wear.releaseName === releaseName && wear.playTrack === "wear:qa" &&
    wear.commitStatus === "confirmed" && wear.committed === true &&
    wear.changesInReviewBehavior === "ERROR_IF_IN_REVIEW",
  "Wear OS Play publisher does not confirm the pinned source, run, attempt, Wear OS release code and AAB");
  const { track, releases } = wear.track ?? {};
  requireEvidence(track === "wear:qa" && Array.isArray(releases) && releases.length === 1 &&
    releases[0]?.status === "completed" && releases[0].name === releaseName &&
    Array.isArray(releases[0].versionCodes) && releases[0].versionCodes.length === 1 &&
    releases[0].versionCodes[0] === wearVersionCode,
  "Play did not return a single completed Wear OS internal testing release for the pinned Wear OS version code");
}

function checkedCases(cases, api) {
  requireEvidence(Array.isArray(cases) && cases.every((test) => test?.status === "passed" &&
    test.count === 1 && matches(test.identity, /^com\.flashcardsopensourceapp\.app\.[\w.]+#\w+$/)),
  `API ${api} contains a malformed, duplicate or nonpassing named result`);
  const names = cases.map((test) => test.identity);
  requireEvidence(distinct(names), `API ${api} contains duplicate named results`);
  return names;
}

function verifySession(session, expected) {
  const { api, device, session_id: sessionId, report, executions, counts } = session;
  requireEvidence(session.selection === (api === "37" ? "latest" : `compat-api${api}`) &&
    session.passed === true && Array.isArray(session.problems) && session.problems.length === 0 &&
    matches(sessionId, /^session-[a-f0-9-]+$/) && report?.member === `${sessionId}/session-full.json` &&
    isDigest(report.sha256), `API ${api} is missing passing native evidence for the effective device`);
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

function namedSelection(targets, count) {
  requireEvidence(Array.isArray(targets) && targets.length === count &&
    distinct(targets) && targets.every((target) => matches(target, methodTarget)),
  `Pinned source must declare ${count} distinct named Device Run methods`);
  return targets.map((target) => target.slice("class ".length));
}

function verifyRetry(session, schema, configuredDevice, hashes) {
  const failure = session.initial_failure;
  requireEvidence(failure?.selection === session.selection &&
    matches(failure.session_id, /^session-[a-f0-9-]+$/) &&
    failure.report?.member === `${failure.session_id}/session-full.json` && isDigest(failure.report.sha256),
  "Retried Device Run destination is missing the original classified failure evidence");
  const dns = failure.reason === "lab_dns_before_auth_request" && session.device === configuredDevice;
  const alternate = failure.reason === "lab_unavailable_before_execution" && session.device !== configuredDevice &&
    failure.alternate_catalog?.member === "retry-catalog.json" && isDigest(failure.alternate_catalog.sha256);
  requireEvidence(schema === 1 ? dns : (dns || alternate) && failure.device === configuredDevice &&
    failure.apk_sha256?.app === hashes.app && failure.apk_sha256?.test === hashes.test,
  "Retried Device Run destination does not match the classified retry, original device or APK hashes");
  return { api: session.api, sessionId: failure.session_id, reason: failure.reason, reportSha256: failure.report.sha256,
    ...(schema === 2 ? { device: failure.device, effectiveDevice: session.device } : {}) };
}

function verifyNative(summary, pin, releaseId, selection) {
  const { sourceSha, runId, attempt, devices } = pin;
  const { latest_inventory: latest, sessions } = summary;
  const schema = Object.hasOwn(selection, "schemaVersion") ? selection.schemaVersion : 1;
  const summarySchema = Object.hasOwn(summary, "selection_schema_version") ? summary.selection_schema_version : 1;
  const apis = schema === 1 ? ["37", "30", "31", "33"] : ["37", "30"];
  requireEvidence([1, 2].includes(schema) && summarySchema === schema,
    "Native selection schema does not match the pinned release source");
  const compat = namedSelection(selection.compat, schema === 1 ? 4 : 1);
  const pinnedLatest = schema === 2 ? namedSelection(selection.latest, 5) : null;
  requireEvidence(summary.target_sha === sourceSha && summary.github_run_id === runId &&
    summary.github_run_attempt === attempt && summary.release_id === releaseId &&
    summary.private_archive_uploaded === true && isDigest(summary.private_archive_sha256) &&
    typeof summary.private_archive === "string" &&
    summary.private_archive.endsWith(`/release-evidence/${sourceSha}/r${runId}a${attempt}/raw.tar.gz`),
  "Native summary does not match the pinned release or lacks the retained private archive");
  requireEvidence(Array.isArray(latest) && distinct(latest) && compat.every((name) => latest.includes(name)) &&
    (!pinnedLatest || latest.length === pinnedLatest.length && pinnedLatest.every((name) => latest.includes(name))),
  "Latest or compatibility source inventory is invalid");
  requireEvidence(Array.isArray(sessions) && sessions.length === apis.length &&
    distinct(sessions.map((session) => session?.api)) && apis.every((api) => sessions.some((session) => session?.api === api)) &&
    apis.every((api) => matches(devices?.[api], deviceId)) && distinct(apis.map((api) => devices[api])) &&
    sessions.every((session) => matches(session.device, deviceId) &&
      (schema === 2 ? session.configured_device === devices[session.api] : session.device === devices[session.api])) &&
    distinct(sessions.map((session) => session.device)),
  "Native summary and device pins must cover every required API on distinct physical destinations");
  const required = sessions.flatMap((session) =>
    verifySession(session, new Set(session.api === "37" ? latest : compat)));
  const hashes = Object.fromEntries(["app", "test"].map((kind) => {
    const values = sessions.map((session) => {
      const artifacts = Array.isArray(session.artifacts) ? session.artifacts.filter((item) => item?.kind === kind) : [];
      requireEvidence(artifacts.length === 1 && isDigest(artifacts[0].sha256), `Native summary lacks a verified ${kind} APK hash`);
      return artifacts[0].sha256;
    });
    requireEvidence(new Set(values).size === 1, `Device Run sessions used different ${kind} APK bytes`);
    return [kind, values[0]];
  }));
  const retries = sessions.flatMap((session) => {
    const configured = devices[session.api];
    if (Object.hasOwn(session, "initial_failure")) return [verifyRetry(session, schema, configured, hashes)];
    requireEvidence(session.device === configured, "An alternate effective device requires an original classified failure");
    return [];
  });
  const sessionIds = sessions.map((session) => session.session_id);
  requireEvidence(retries.length <= 1 && distinct([...sessionIds, ...retries.map((retry) => retry.sessionId)]),
    "Device Run session identities are duplicated or exceed the single allowed retry");
  return { required, sessionIds, retries, appSha256: hashes.app, testSha256: hashes.test };
}

async function assemble(review, run, native, publisher, bundlePath, wearPublisher) {
  const { sourceSha, version, versionCode, wearVersionCode, wearAabSha256, runId, attempt, aabSha256, reviewedBy, reviews } = review;
  requireEvidence(matches(sourceSha, /^[a-f0-9]{40}$/) && isDigest(aabSha256) &&
    [versionCode, runId, attempt].every((value) => matches(value, /^[1-9][0-9]*$/)),
  "Pin the full release source SHA, signed AAB SHA-256, version code, run ID and attempt as strings");
  // Runs dispatched before the Wear OS job existed carry no Wear OS evidence.
  const hasWear = Array.isArray(run.value.jobs) && run.value.jobs.some((job) => job?.name === wearPublisherJob);
  requireEvidence(hasWear === (wearPublisher !== undefined) && (!hasWear ||
    matches(wearVersionCode, /^[1-9][0-9]*$/) && wearVersionCode !== versionCode && isDigest(wearAabSha256)),
  hasWear ? "This run uploaded a Wear OS bundle: pass its publisher provenance and pin wearVersionCode and wearAabSha256"
    : "This run has no Wear OS job: omit the Wear OS publisher provenance");
  const versions = [...sourceFile(sourceSha, "apps/android/app/build.gradle.kts").matchAll(/versionName\s*=\s*"([^"]+)"/g)];
  requireEvidence(versions.length === 1 && versions[0][1] === version, "Pinned marketing version differs from the release source");
  const selection = JSON.parse(sourceFile(sourceSha, "scripts/android/device-run-test-selection.json"));
  const releaseId = `vc${versionCode}-r${runId}a${attempt}-s${sourceSha.slice(0, 8)}`;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(bundlePath)) hash.update(chunk);
  requireEvidence(hash.digest("hex") === aabSha256, "Downloaded signed AAB differs from the pinned checksum");
  verifyPublisher(publisher.value, review, releaseId, aabSha256);
  if (hasWear) verifyWearPublisher(wearPublisher.value, review, publisher.value);
  verifyRun(run.value, review, publisher.value, hasWear);
  const { required, appSha256, testSha256, sessionIds, retries } = verifyNative(native.value, review, releaseId, selection);

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
    publisherSha256: publisher.sha256, ...(hasWear ? { wearPublisherSha256: wearPublisher.sha256 } : {}), githubRunSha256: run.sha256, testSha256, sessionIds, retries } };
}

try {
  const [review, run, native, publisher, bundle, wearPublisher, ...extra] = process.argv.slice(2);
  requireEvidence(bundle && !extra.length,
    "Usage: node scripts/release/assemble-android-readiness.mjs review.json github-run.json summary.json play-publisher-provenance.json app-release.aab [play-wear-publisher-provenance.json]");
  const manifest = await assemble(readJson(review, "review").value, readJson(run, "GitHub run"),
    readJson(native, "native summary"), readJson(publisher, "Play publisher provenance"), bundle,
    wearPublisher === undefined ? undefined : readJson(wearPublisher, "Wear OS Play publisher provenance"));
  console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
  if (!(error instanceof TypeError) && !error.code && !(error instanceof SyntaxError)) throw error;
  console.error(error instanceof TypeError ? error.message : "Android readiness inputs could not be read");
  process.exitCode = 2;
}
