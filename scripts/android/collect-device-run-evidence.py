#!/usr/bin/env python3

import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from urllib.request import urlopen


Json = dict[str, object]
LINKED_WORKSPACE_CASE = "com.flashcardsopensourceapp.app.livesmoke.LiveSmokeTest#linkedWorkspaceAccountStatusAndWorkspaceStateAreVisible"


@dataclass(frozen=True)
class Destination:
    selection: str
    api: str
    device: str
    targets: list[str]
    labels: Json
    expected: set[str]
    excluded: set[str]


def obj(value: object) -> Json:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object; inspect private session evidence")
    return cast(Json, value)


def records(value: object) -> list[Json]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON list; inspect private session evidence")
    return [obj(item) for item in value]


def text(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("Expected a nonempty string; inspect private session evidence")
    return value


def strings(value: object) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Expected a string list; inspect private session evidence")
    return [text(item) for item in value]


def read(path: Path) -> Json:
    return obj(json.loads(path.read_text()))


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def release_apk_hashes() -> dict[str, str]:
    hashes = {kind: os.environ[f"{kind.upper()}_APK_SHA256"] for kind in ("app", "test")}
    if any(not re.fullmatch(r"[a-f0-9]{64}", sha) for sha in hashes.values()):
        raise ValueError("Invalid pinned GitHub run APK hashes")
    return hashes


def gcloud(args: list[str], destination: Path, diagnostics: Path) -> None:
    with TemporaryDirectory(dir=destination.parent) as directory:
        pending = Path(directory) / destination.name
        for attempt in range(1, 4):
            with pending.open("wb") as output, diagnostics.open("ab") as errors:
                result = subprocess.run(["gcloud", *args, "--quiet"], stdout=output, stderr=errors, check=False)
            if result.returncode == 0:
                pending.replace(destination)
                return
            print(f"WARNING: Google evidence operation attempt {attempt}/3 failed; diagnostics retained privately")
            if attempt < 3:
                time.sleep(5)
    raise ValueError(f"Google evidence operation failed with exit {result.returncode}; inspect private collector diagnostics")


def download(uri: str, destination: Path, transfer_log: Path, diagnostics: Path) -> None:
    with TemporaryDirectory(dir=destination.parent) as directory:
        pending = Path(directory) / destination.name
        gcloud(["storage", "cp", uri, str(pending)], transfer_log, diagnostics)
        pending.replace(destination)


# The expected latest inventory comes from the checked-out declarations, never from passing results, so a
# test that silently never ran still fails the gate; unsupported declaration forms fail instead of being guessed.
def inventory() -> tuple[set[str], set[str]]:
    selected: set[str] = set()
    excluded: set[str] = set()
    root = Path("apps/android/app/src")
    for path in sorted(root.rglob("*")):
        if path.suffix not in (".kt", ".java") or not (path.relative_to(root).parts[0] == "androidTest" or path.relative_to(root).parts[0].endswith("AndroidTest")):
            continue
        source = path.read_text()
        source = re.sub(r'""".*?"""|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|/\*.*?\*/|//[^\n]*', "", source, flags=re.S)
        if re.search(r"import org.junit.Test\s+as\b|@org.junit.Test\b|\bTestCase\b", source):
            raise ValueError("Unsupported test import or runner; extend independent inventory before releasing")
        if not re.search(r"@Test\b", source):
            continue
        if path.suffix != ".kt" or "androidTest" not in path.parts:
            raise ValueError("Test declarations outside androidTest require explicit inventory support")
        packages = re.findall(r"^package ([\w.]+)\s*$", source, re.M)
        classes = list(re.finditer(r"^class (\w+)(?:\s*:\s*FirebaseAppInstrumentationTimeoutTest\(\))?\s*\{", source, re.M))
        methods = list(re.finditer(r"^[ \t]*@Test[ \t]*\n[ \t]*fun (\w+)\(\)\s*\{", source, re.M))
        if (len(packages) != 1 or len(classes) != 1 or
                len(methods) != len(re.findall(r"@Test\b", source)) or
                re.search(r"^[ \t]+(?:(?:private|data|open|abstract) )*class ", source, re.M) or
                "@RunWith(AndroidJUnit4::class)" not in source or
                re.search(r"@Ignore\b", source)):
            raise ValueError("Unsupported JUnit declaration: extend independent inventory before releasing")
        helpers = list(re.finditer(r"^(?:(?:private|data|open|abstract) )+class ", source, re.M))
        if any(method.start() < classes[0].end() or any(helper.start() < method.start() for helper in helpers) for method in methods):
            raise ValueError("Inherited or helper-class test methods require explicit inventory support")
        prefix = source[:classes[0].start()]
        class_id = packages[0] + "." + classes[0].group(1)
        if not class_id.startswith("com.flashcardsopensourceapp.app."):
            raise ValueError("Test declaration outside configured package")
        manual = "@ManualOnlyAndroidTest" in prefix
        if len(re.findall(r"@ManualOnlyAndroidTest\b", source)) != int(manual):
            raise ValueError("Method-level manual exclusion requires explicit inventory support")
        identities = {class_id + "#" + method.group(1) for method in methods}
        if len(identities) != len(methods) or identities & (selected | excluded):
            raise ValueError("Duplicate test declaration")
        (excluded if manual else selected).update(identities)
    if not selected:
        raise ValueError("Independent latest inventory is empty")
    return selected, excluded


def junit(path: Path, allowed: set[str], excluded: set[str]) -> tuple[Counter[tuple[str, str]], int]:
    root = ET.parse(path).getroot()
    cases: Counter[tuple[str, str]] = Counter()
    manual_count = 0
    for case in root.iter("testcase"):
        identity = (case.get("classname") or "") + "#" + (case.get("name") or "")
        status = "passed"
        for tag in ("skipped", "failure", "error"):
            if case.find(tag) is not None:
                status = tag
        if identity in excluded and status == "skipped":
            manual_count += 1
        elif identity not in allowed:
            raise ValueError("JUnit contains an unselected identity; inspect private XML")
        else:
            cases[(identity, status)] += 1
    for suite in root.iter("testsuite"):
        if int(suite.get("flakes", "0")) != 0:
            raise ValueError("JUnit contains a flaky result; failed attempts cannot satisfy the gate")
        children = list(suite.iter("testcase"))
        for key, tag in (("tests", None), ("failures", "failure"), ("errors", "error"), ("skipped", "skipped")):
            actual = len(children) if tag is None else sum(case.find(tag) is not None for case in children)
            if key in suite.attrib and int(suite.attrib[key]) != actual:
                raise ValueError("JUnit declared counts disagree with named cases")
    return cases, manual_count


def passed(report: Json) -> bool:
    return (obj(report.get("status", {})).get("statusType") == "DONE" and
            obj(report.get("result", {})).get("resultType") == "PASSED")


def verify_submission(report: Json, session_id: str, device: str, targets: list[str], labels: Json,
                      bucket: str, local: Path, diagnostics: Path) -> tuple[Json, Json, list[Json]]:
    base = f"gs://{bucket}/automation/sessions/{session_id}/"
    config = obj(report["sessionConfig"])
    jobs = records(config["jobConfigs"])
    runtime = obj(report["sessionReport"])
    job_reports = records(runtime.get("jobReports", []))
    if (not text(report["name"]).endswith("/locations/global/sessions/" + session_id) or
            obj(obj(config["outputDirectoryConfig"])["gcsOutputDirectory"])["path"] != base.rsplit(session_id + "/", 1)[0].rstrip("/") or
            len(jobs) != 1 or len(job_reports) != 1):
        raise ValueError("Session identity, private directory or job count mismatch")
    job = jobs[0]
    if job.get("displayName") != "job-000" or job_reports[0].get("displayName") != "job-000":
        raise ValueError("Configured and reported job identity mismatch")
    action = obj(obj(job["action"])["androidInstrumentationTest"])
    devices = records(obj(job["allocationConfig"])["deviceConfigs"])
    if (len(devices) != 1 or obj(devices[0]["requirement"]).get("deviceId") != device or
            sorted(strings(action.get("testTargets", []))) != sorted(targets) or job.get("labels") != labels or job_reports[0].get("labels") != labels):
        raise ValueError("Session device, selected targets or run labels mismatch")
    installs = [obj(item["androidInstallPackages"]) for item in records(devices[0]["actions"]) if "androidInstallPackages" in item]
    if len(installs) != 1 or len(records(installs[0]["installables"])) != 1:
        raise ValueError("Expected one app installation action")
    artifacts: list[Json] = []
    expected_hashes = release_apk_hashes()
    for kind, installable, original in (
        ("test", obj(action["testInstallable"]), Path(os.environ["TEST_APK_PATH"])),
        ("app", records(installs[0]["installables"])[0], Path(os.environ["APP_APK_PATH"])),
    ):
        files = records(installable["files"])
        if len(files) != 1:
            raise ValueError("Expected exactly one submitted APK per installable")
        uri = text(obj(files[0]["gcsInputFile"])["path"])
        input_pattern = re.escape(f"gs://{bucket}/automation/inputs/") + r"[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9:.]+_[A-Za-z0-9]{4}/" + re.escape(original.name)
        if not re.fullmatch(input_pattern, uri):
            raise ValueError("Submitted APK reference is outside the private input directory")
        apk = local / (kind + ".apk")
        download(uri, apk, local / "transfer.log", diagnostics)
        sha = digest(apk)
        if sha != expected_hashes[kind]:
            raise ValueError(f"Submitted {kind} APK hash differs from the pinned GitHub run artifact")
        artifacts.append({"kind": kind, "object": uri, "sha256": sha})
        apk.unlink()
    return runtime, job_reports[0], artifacts


def collect_session(report: Json, session_id: str, device: str, targets: list[str], labels: Json,
                    expected: set[str], excluded: set[str], bucket: str, local: Path, diagnostics: Path) -> Json:
    runtime, job_report, artifacts = verify_submission(report, session_id, device, targets, labels, bucket, local, diagnostics)
    base = f"gs://{bucket}/automation/sessions/{session_id}/"
    executions = records(job_report.get("executionReports", []))
    case_counts: Counter[tuple[str, str]] = Counter()
    execution_summaries: list[Json] = []
    job_cases: list[Counter[tuple[str, str]]] = []
    problems: list[str] = []
    for index, owner in enumerate([*executions, job_report]):
        files = records(owner.get("outputFiles", []))
        owner_cases: list[Counter[tuple[str, str]]] = []
        filenames: set[str] = set()
        owner_artifacts: list[Json] = []
        manual_count = 0
        for entry in files:
            uri = text(obj(entry["gcsOutputFile"])["path"])
            relative = uri.removeprefix(base)
            directory = r"job-000/execution-[0-9]+/" if index < len(executions) else r"job-000/"
            if not re.fullmatch(directory + r"(?:junit.xml|merged_junit.xml|logcat.txt|instrument.log|instrumentation.log)", relative):
                continue
            filenames.add(relative.rsplit("/", 1)[-1])
            path = local / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                download(uri, path, local / "transfer.log", diagnostics)
            except ValueError:
                problems.append("native_download_failed")
                continue
            if path.stat().st_size == 0:
                problems.append("empty_native_artifact")
            artifact: Json = {"object": uri, "sha256": digest(path)}
            artifacts.append(artifact)
            owner_artifacts.append(artifact)
            if path.suffix == ".xml":
                try:
                    parsed, manual_count = junit(path, expected, excluded)
                    owner_cases.append(parsed)
                except (ValueError, ET.ParseError) as error:
                    problems.append("invalid_junit")
                    with diagnostics.open("a") as stream:
                        stream.write(f"JUnit parse: {error}\n")
        if index < len(executions):
            if len(owner_cases) != 1 or "logcat.txt" not in filenames:
                problems.append("missing_execution_native_evidence")
            native = owner_cases[0] if len(owner_cases) == 1 else Counter()
            if not native:
                problems.append("zero_execution_native_cases")
            case_counts.update(native)
            execution_id = text(owner["id"])
            if not re.fullmatch(r"[a-f0-9-]{36}", execution_id):
                raise ValueError("Invalid execution ID")
            execution_summaries.append({"index": index, "id": execution_id, "terminal_passed": passed(owner),
                                        "case_count": sum(native.values()), "manual_exclusions": manual_count,
                                        "artifacts": owner_artifacts,
                                        "cases": [{"identity": identity, "status": status, "count": count} for (identity, status), count in sorted(native.items())]})
        else:
            job_cases = owner_cases
    if not executions or not case_counts:
        problems.append("zero_native_cases")
    if any(value != 1 for value in case_counts.values()) or Counter(identity for identity, status in case_counts) != Counter(expected):
        problems.append("missing_or_duplicate_selected_cases")
    if any(status != "passed" for identity, status in case_counts):
        problems.append("selected_case_not_passed")
    if len(job_cases) != 1 or job_cases[0] != case_counts:
        problems.append("job_execution_junit_mismatch")
    if not all(passed(owner) for owner in [runtime, job_report, *executions]):
        problems.append("terminal_result_not_passed")
    return {"session_id": session_id, "device": device, "expected_count": len(expected),
            "executions": execution_summaries, "counts": dict(Counter({status: sum(n for (identity, s), n in case_counts.items() if s == status) for status in ("passed", "failure", "error", "skipped")})),
            "cases": [{"identity": identity, "status": status, "count": count} for (identity, status), count in sorted(case_counts.items())],
            "artifacts": artifacts, "problems": problems, "passed": not problems}


def named_selection(targets: list[str], inventory: set[str], count: int) -> set[str]:
    names = {target.removeprefix("class ") for target in targets}
    if (len(targets) != count or len(names) != count or not names <= inventory or
            any(not target.startswith("class ") for target in targets)):
        raise ValueError(f"Selection must name exactly {count} distinct non-manual methods declared in the pinned source")
    return names


def release_destinations() -> tuple[int, list[Destination]]:
    selected, excluded = inventory()
    selection = read(Path("scripts/android/device-run-test-selection.json"))
    schema = selection.get("schemaVersion", 1)
    if type(schema) is not int:
        raise ValueError("Invalid Device Run selection schema version")
    latest = strings(selection["latest"])
    compat = strings(selection["compat"])
    if schema == 1:
        if latest != ["package com.flashcardsopensourceapp.app", "notAnnotation com.flashcardsopensourceapp.app.ManualOnlyAndroidTest"]:
            raise ValueError("Legacy latest filters require explicit inventory support")
        latest_names = selected
        compat_names = named_selection(compat, latest_names, 4)
        compat_apis = ("30", "31", "33")
    elif schema == 2:
        latest_names = named_selection(latest, selected, 5)
        compat_names = named_selection(compat, latest_names, 1)
        compat_apis = ("30",)
        excluded = set()
    else:
        raise ValueError("Unsupported Device Run selection schema")

    configured_compat = strings(json.loads(os.environ["ANDROID_DEVICE_RUN_COMPAT_DEVICES"]))
    devices = [os.environ["ANDROID_DEVICE_RUN_DEVICE"], *configured_compat]
    if len(devices) != 4 or len(set(devices)) != 4 or any(not re.fullmatch(r"[A-Za-z0-9_-]+", device) for device in devices):
        raise ValueError("Expected a distinct API 37 device and the configured API 30/31/33 catalog ID list")
    labels: Json = {"target_sha": os.environ["TARGET_SHA"], "github_run_id": os.environ["GITHUB_RUN_ID"],
                    "github_run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "release_id": os.environ["RELEASE_ID"]}
    return int(schema), [
        Destination("latest", "37", devices[0], latest, {**labels, "suite": "latest"}, latest_names, excluded),
        *(Destination(f"compat-api{api}", api, device, compat, {**labels, "suite": "compat"}, compat_names, set())
          for api, device in zip(compat_apis, devices[1:len(compat_apis) + 1], strict=True)),
    ]


def physical_devices(catalog: Path, api: str) -> list[Json]:
    return [device for device in records(json.loads(catalog.read_text()))
            if device.get("platform") == "ANDROID" and device.get("hardwareType") == "PHYSICAL" and
            device.get("osVersion") == api and obj(device.get("lifecycle", {})).get("state") == "ACTIVE" and
            not strings(device.get("accessDeniedReasons", [])) and
            any(product.get("automation") is not None for product in records(device.get("supportedProducts", [])))]


def catalog_id(device: Json) -> str:
    device_id = text(device["name"]).rsplit("/", 1)[-1]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", device_id):
        raise ValueError("Invalid Device Run catalog ID")
    return device_id


def prepare_destinations() -> None:
    schema, destinations = release_destinations()
    temporary = Path(os.environ["RUNNER_TEMP"])
    catalog = temporary / "device-run-catalog.json"
    for destination in destinations:
        if destination.device not in {catalog_id(device) for device in physical_devices(catalog, destination.api)}:
            raise ValueError(f"API {destination.api} device {destination.device} is not an active, accessible physical Android automation destination")
    if schema == 1:
        latest, minimum, api31, api33 = destinations
        destinations = [api31, latest, minimum, api33]
    print(json.dumps([{"selection": item.selection, "api": item.api, "device": item.device,
                       "suite": item.labels["suite"], "targets": item.targets} for item in destinations]))


def session_ids(log: Path) -> list[str]:
    return re.findall(r"Creating session \[(session-[a-f0-9-]+)\]", log.read_text()) if log.exists() else []


def collect_destination(report: Path, session_id: str, destination: Destination, private: Path) -> Json:
    return collect_session(read(report), session_id, destination.device, destination.targets, destination.labels,
                           destination.expected, destination.excluded, os.environ["ANDROID_DEVICE_RUN_RESULTS_BUCKET"],
                           report.parent, private / "collector.log")


def auth_dns_log_matches(logcat: Path) -> bool:
    class_name, method = LINKED_WORKSPACE_CASE.split("#")
    test = f"{method}({class_name})"
    prefix = re.compile(r"^\S+ \S+\s+(\d+)\s+\d+\s+[A-Z] (TestRunner|AppObservability): (.*)$")
    # Orchestrator also logs a discovery invocation. Bind DNS to the failed test process.
    active: dict[str, list[dict[str, str]]] = {}
    failed: set[str] = set()
    completed: list[list[dict[str, str]]] = []
    with logcat.open() as lines:
        for line in lines:
            match = prefix.match(line)
            if match is None:
                continue
            pid, tag, message = match.groups()
            if tag == "TestRunner":
                if message == f"started: {test}":
                    if pid in active:
                        return False
                    active[pid] = []
                elif message == f"failed: {test}":
                    if pid not in active or pid in failed:
                        return False
                    failed.add(pid)
                elif message == f"finished: {test}":
                    if pid not in active:
                        return False
                    attempts = active.pop(pid)
                    if pid in failed:
                        failed.remove(pid)
                        completed.append(attempts)
                    elif attempts:
                        return False
                continue
            if pid in active and pid not in failed:
                fields = dict(re.findall(r"\b(\w+)=([^\s]+)", message))
                if fields.get("action") == "http_attempt_finished" and fields.get("endpointName") == "/api/auth-methods":
                    active[pid].append(fields)
    if active or len(completed) != 1 or len(completed[0]) != 4:
        return False
    required = {"event": "breadcrumb", "platform": "android", "feature": "auth", "method": "GET",
                "statusCode": "null", "requestId": "null", "requestHeadersCompleted": "false",
                "responseBodyRead": "false", "cancelled": "false", "exceptionClass": "java.net.UnknownHostException"}
    return all(fields.get("attemptNumber") == str(index) and all(fields.get(key) == value for key, value in required.items())
               for index, fields in enumerate(completed[0], start=1))


def auth_dns_failure(report: Json, evidence: Json, local: Path) -> bool:
    if set(strings(evidence["problems"])) != {"selected_case_not_passed", "terminal_result_not_passed"}:
        return False
    if [case for case in records(evidence["cases"]) if case["status"] != "passed"] != [
        {"identity": LINKED_WORKSPACE_CASE, "status": "failure", "count": 1},
    ]:
        return False
    session = obj(report["sessionReport"])
    job, = records(session["jobReports"])
    executions = records(job["executionReports"])
    if len(executions) != 1:
        return False
    for owner, reason in zip([session, job, *executions], ("SESSION_HAS_FAILED_JOBS", "JOB_HAS_FAILED_TESTS", "TEST_CASE_FAILURE"), strict=True):
        result = obj(owner["result"])
        if (obj(owner["status"])["statusType"] != "DONE" or result["resultType"] != "FAILED" or
                obj(obj(result["cause"])["summary"])["reason"] != reason):
            return False
    junit_files = sorted((local / "job-000").rglob("*junit.xml"))
    logcats = list((local / "job-000").glob("execution-*/logcat.txt"))
    if len(junit_files) != 2 or len(logcats) != 1:
        return False
    for junit_file in junit_files:
        failures = list(ET.parse(junit_file).iter("failure"))
        if len(failures) != 1:
            return False
        stack = failures[0].text or ""
        if not stack.startswith("java.lang.AssertionError: Android live smoke step failed: sign in with the configured review account\n"):
            return False
        if not re.search(
            r"^Caused by: androidx\.compose\.ui\.test\.ComposeTimeoutException:[^\n]*\n"
            r"(?:[ \t]+at [^\n]+\n)*"
            r"[ \t]+at com\.flashcardsopensourceapp\.app\.livesmoke\.diagnostics\.LiveSmokeDiagnosticsKt"
            r"\.waitUntilAtLeastOneExistsOrFail\(LiveSmokeDiagnostics\.kt:\d+\)\n"
            r"[ \t]+at com\.flashcardsopensourceapp\.app\.livesmoke\.flows\.LiveSmokeAuthFlowsKt"
            r"\.signInWithReviewAccount\(LiveSmokeAuthFlows\.kt:\d+\)$",
            stack, re.M,
        ):
            return False
    return auth_dns_log_matches(logcats[0])


def public_json(url: str) -> Json:
    with urlopen(url, timeout=10) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError("Production health probe returned a non-200 or redirected response")
        return obj(json.loads(response.read(65536)))


def verify_production_health() -> None:
    configuration = Path("apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/cloud/CloudSupport.kt").read_text()
    auth, = re.findall(r'^private const val flashcardsOfficialAuthBaseUrl: String = "(https://auth\.(?:nibomo|flashcards-open-source-app)\.com)"$', configuration, re.M)
    api, = re.findall(r'^private const val flashcardsOfficialApiBaseUrl: String = "(https://api\.(?:nibomo|flashcards-open-source-app)\.com/v1)"$', configuration, re.M)
    methods = public_json(auth + "/api/auth-methods?client=android")
    health = public_json(api + "/health")
    if (methods.get("client") != "android" or obj(obj(methods["methods"])["email"]).get("available") is not True or
            health.get("status") != "ok" or not health.get("dbTime")):
        raise ValueError("Production Android auth methods or API database health did not verify")


def no_execution_began(session: Json, job: Json, cancelled_after_timeout: bool) -> bool:
    if (any(obj(owner["status"])["statusType"] != "DONE" for owner in (session, job)) or
            records(job.get("executionReports", [])) or records(job.get("outputFiles", []))):
        return False
    session_result = obj(session["result"])
    job_result = obj(job["result"])
    cause = obj(obj(job_result["cause"])["summary"])
    if cancelled_after_timeout:
        return (session_result["resultType"] == job_result["resultType"] == cause["reason"] == "CANCELLED" and
                obj(obj(session_result["cause"])["summary"])["reason"] == "CANCELLED")
    return (session_result["resultType"] in ("ERROR", "FAILED") and job_result["resultType"] in ("ERROR", "FAILED") and
            cause.get("type") == "INFRA" and bool(text(cause.get("reason"))))


def alternate_destination(destination: Destination, catalog: Path) -> str | None:
    availability = {"AVAILABILITY_HIGH": 0, "AVAILABILITY_MEDIUM": 1, "AVAILABILITY_LOW": 2}
    candidates = sorted(
        (availability[idle], catalog_id(device))
        for device in physical_devices(catalog, destination.api)
        if catalog_id(device) != destination.device
        and (idle := obj(device.get("availability", {})).get("available")) in availability
    )
    return candidates[0][1] if candidates else None


def classify_retry(selection: str) -> None:
    temporary = Path(os.environ["RUNNER_TEMP"])
    private = temporary / "device-run-private"
    private.mkdir(exist_ok=True)
    diagnostics = private / "collector.log"
    try:
        schema, destinations = release_destinations()
        destination, = [item for item in destinations if item.selection == selection]
        log = temporary / f"device-run-{selection}-submit.log"
        session_id, = session_ids(log)
        markers = re.findall(r"^(DEVICE_RUN_TERMINAL_FAILURE|DEVICE_RUN_CANCELLED_AFTER_WAIT_TIMEOUT)=(.+)$", log.read_text(), re.M)
        (marker, marked_id), = markers
        if marked_id != session_id:
            raise ValueError("Retry marker differs from the submitted session")
        first = temporary / f"device-run-{selection}-session.json"
        local = private / session_id
        local.mkdir()
        report_path = local / "session-full.json"
        report_path.write_bytes(first.read_bytes())
        report = read(report_path)
        runtime = obj(report["sessionReport"])
        job, = records(runtime["jobReports"])
        cancelled_after_timeout = marker == "DEVICE_RUN_CANCELLED_AFTER_WAIT_TIMEOUT"
        retry: Json = {"selection": selection, "session_id": session_id, "device": destination.device,
                       "effective_device": destination.device,
                       "report": {"member": f"{session_id}/session-full.json", "sha256": digest(report_path)}}
        if schema == 2 and no_execution_began(runtime, job, cancelled_after_timeout):
            _, _, artifacts = verify_submission(report, session_id, destination.device, destination.targets,
                                                destination.labels, os.environ["ANDROID_DEVICE_RUN_RESULTS_BUCKET"],
                                                local, diagnostics)
            catalog = private / "retry-catalog.json"
            gcloud(["beta", "device-run", "devices", "list", "--project", os.environ["GCP_PROJECT_ID"],
                    "--location", "global", "--format=json"], catalog, diagnostics)
            alternate = alternate_destination(destination, catalog)
            if alternate is None:
                raise SystemExit(f"No idle alternate physical Android device is available for API {destination.api}")
            retry["effective_device"] = alternate
            retry["reason"] = "lab_unavailable_before_execution"
            retry["alternate_catalog"] = {"member": catalog.name, "sha256": digest(catalog)}
        else:
            if cancelled_after_timeout:
                raise ValueError("Device Run reported execution or did not confirm a terminal cancellation")
            evidence = collect_destination(report_path, session_id, destination, private)
            if not auth_dns_failure(report, evidence, local):
                raise ValueError("Device Run did not confirm a pre-execution infrastructure failure or the known auth DNS failure")
            verify_production_health()
            artifacts = records(evidence["artifacts"])
            retry["reason"] = "lab_dns_before_auth_request"
        retry["apk_sha256"] = {text(item["kind"]): item["sha256"] for item in artifacts if "kind" in item}
        (temporary / "device-run-retry-evidence.json").write_text(json.dumps(retry) + "\n")
    except (ValueError, KeyError, OSError, ET.ParseError) as error:
        with diagnostics.open("a") as stream:
            stream.write(f"{selection}: retry classification declined: {error}\n")
        raise SystemExit(f"Device Run retry declined for {selection}; inspect private diagnostics")


def effective_destination(destination: Destination, retry: Json, ids: list[str], private: Path) -> Destination:
    first_id, = ids
    first_report = f"{first_id}/session-full.json"
    if (retry.get("session_id") != first_id or retry.get("device") != destination.device or
            retry.get("report") != {"member": first_report, "sha256": digest(private / first_report)} or
            retry.get("apk_sha256") != release_apk_hashes()):
        raise ValueError("Initial failed report, device or APK hashes do not match the retained evidence")
    device = text(retry["effective_device"])
    if retry["reason"] == "lab_unavailable_before_execution":
        catalog = private / "retry-catalog.json"
        if (retry.get("alternate_catalog") != {"member": catalog.name, "sha256": digest(catalog)} or
                device != alternate_destination(destination, catalog)):
            raise ValueError("Effective device does not match the retained same-API alternate catalog")
    elif retry["reason"] != "lab_dns_before_auth_request" or device != destination.device:
        raise ValueError("Unexpected Device Run retry reason or device")
    return replace(destination, device=device)


def main() -> None:
    temporary = Path(os.environ["RUNNER_TEMP"])
    bucket = os.environ["ANDROID_DEVICE_RUN_RESULTS_BUCKET"]
    sha, run_id, attempt = (os.environ[key] for key in ("TARGET_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    if not re.fullmatch(r"vc[0-9]+-r" + run_id + "a" + attempt + "-s" + sha[:8], os.environ["RELEASE_ID"]) or not re.fullmatch(r"[a-f0-9]{40}", sha) or not run_id.isdecimal() or not attempt.isdecimal() or not re.fullmatch(r"[a-z0-9][a-z0-9._-]+", bucket):
        raise ValueError("Invalid release evidence correlation values")
    private = temporary / "device-run-private"
    private.mkdir(exist_ok=True)
    diagnostics = private / "collector.log"
    archive = f"gs://{bucket}/release-evidence/{sha}/r{run_id}a{attempt}/"
    summary: Json = {"target_sha": sha, "github_run_id": run_id, "github_run_attempt": attempt,
                     "release_id": os.environ["RELEASE_ID"], "private_archive": archive + "raw.tar.gz", "sessions": []}
    sessions: list[Json] = []
    try:
        schema, destinations = release_destinations()
        if schema == 2:
            summary["selection_schema_version"] = schema
        summary["latest_inventory"] = sorted(destinations[0].expected)
        summary["manual_exclusions"] = sorted(destinations[0].excluded)
        retry_path = temporary / "device-run-retry-evidence.json"
        retry = read(retry_path) if retry_path.exists() else {}
        if retry and retry.get("selection") not in {destination.selection for destination in destinations}:
            raise ValueError("Retry record does not identify a configured destination")
        for destination in destinations:
            suffix = destination.selection
            record: Json = {"selection": suffix, "device": destination.device, "api": destination.api, "passed": False}
            if schema == 2:
                record["configured_device"] = destination.device
            sessions.append(record)
            ids = session_ids(temporary / f"device-run-{suffix}-submit.log")
            if retry.get("selection") == suffix:
                destination = effective_destination(destination, retry, ids, private)
                first_id, = ids
                ids = session_ids(temporary / f"device-run-{suffix}-retry-submit.log")
                if first_id in ids:
                    raise ValueError("Retry must use a new session ID")
                keys = ["selection", "session_id", "reason", "report"]
                if schema == 2:
                    keys += ["device", "apk_sha256"]
                    if "alternate_catalog" in retry:
                        keys.append("alternate_catalog")
                record["initial_failure"] = {key: retry[key] for key in keys}
                record["device"] = destination.device
            if len(ids) != 1:
                record["problem"] = "session_not_created"
                continue
            session_id = ids[0]
            local = private / session_id
            local.mkdir(exist_ok=True)
            try:
                refreshed = local / "session-full.json"
                gcloud(["beta", "device-run", "sessions", "describe", session_id, "--full", "--format=json",
                        "--project", os.environ["GCP_PROJECT_ID"], "--location", "global"], refreshed, diagnostics)
                record["session_id"] = session_id
                record["report"] = {"member": session_id + "/session-full.json", "sha256": digest(refreshed)}
                record.update(collect_destination(refreshed, session_id, destination, private))
            except (ValueError, KeyError, OSError, ET.ParseError) as error:
                record["problem"] = "evidence_collection_failed"
                with diagnostics.open("a") as stream:
                    stream.write(f"{suffix}: {error}\n")
                print(f"ERROR: Native evidence collection failed for {suffix}; inspect private diagnostics")
    finally:
        for path in temporary.glob("device-run-*"):
            if path.is_file():
                (private / path.name).write_bytes(path.read_bytes())
        summary["sessions"] = sessions
        archive_path = temporary / "device-run-raw.tar.gz"
        with tarfile.open(archive_path, "w:gz") as bundle:
            for path in sorted(private.rglob("*")):
                if path.is_file():
                    bundle.add(path, arcname=str(path.relative_to(private)))
        summary["private_archive_sha256"] = digest(archive_path)
        summary["private_archive_uploaded"] = False
        public = temporary / "device-run-public"
        public.mkdir(exist_ok=True)
        (public / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        gcloud(["storage", "cp", str(archive_path), archive + "raw.tar.gz"], temporary / "device-run-private-upload.log", diagnostics)
        summary["private_archive_uploaded"] = True
        (public / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if len(sessions) != len(destinations) or not all(session["passed"] for session in sessions):
        raise ValueError("All configured sessions require complete, reconciled, passing native evidence before Play draft upload")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--classify-retry":
        classify_retry(sys.argv[2])
        raise SystemExit(0)
    if sys.argv[1:] == ["--prepare-destinations"]:
        prepare_destinations()
        raise SystemExit(0)
    if len(sys.argv) != 1:
        raise SystemExit("Expected --prepare-destinations, --classify-retry <selection>, or no arguments")
    try:
        main()
    except (ValueError, KeyError, OSError, ET.ParseError):
        raise SystemExit("ERROR: Device Run evidence gate failed; inspect the safe summary and private archive")
