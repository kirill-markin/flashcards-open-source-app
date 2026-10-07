#!/usr/bin/env python3

import hashlib
import json
import os
import re
import subprocess
import tarfile
import time
from pathlib import Path
from typing import cast


Json = dict[str, object]


def obj(value: object) -> Json:
    if not isinstance(value, dict):
        raise ValueError("Expected a provider JSON object; inspect private diagnostics")
    return cast(Json, value)


def records(value: object) -> list[Json]:
    if not isinstance(value, list):
        raise ValueError("Expected a provider JSON list; inspect private diagnostics")
    return [obj(item) for item in value]


def token(value: object, pattern: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("Invalid configuration or provider metadata; inspect private diagnostics")
    return value


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def gcloud(args: list[str], output: Path, diagnostics: Path) -> None:
    for attempt in range(1, 4):
        with output.open("wb") as stdout, diagnostics.open("ab") as stderr:
            try:
                result = subprocess.run(["gcloud", *args, "--quiet"], stdout=stdout, stderr=stderr, check=False, timeout=60)
                outcome = str(result.returncode)
            except subprocess.TimeoutExpired as error:
                stderr.write((str(error) + "\n").encode())
                outcome = "timeout"
        if outcome == "0":
            return
        print(f"WARNING: Google diagnostics operation failed on attempt {attempt}/3; raw details remain private")
        if attempt < 3:
            time.sleep(5)
    raise RuntimeError(f"Google diagnostics operation exited {outcome}; inspect the private archive and existing identity access")


def native_status(report: Json) -> Json:
    return {"status": token(obj(report.get("status", {})).get("statusType", "NOT_REPORTED"), r"[A-Z_]+"),
            "result": token(obj(report.get("result", {})).get("resultType", "NOT_REPORTED"), r"[A-Z_]+")}


def junit_reference_count(report: Json) -> int:
    count = 0
    for entry in records(report.get("outputFiles", [])):
        path = obj(entry["gcsOutputFile"])["path"]
        if not isinstance(path, str) or not path.startswith("gs://"):
            raise ValueError("Invalid native output reference; inspect private report")
        if path.endswith(("/junit.xml", "/merged_junit.xml")):
            count += 1
    return count


def session_summary(report: Json, session_id: str, project: str) -> Json:
    name = token(report["name"], r"projects/[a-z0-9-]+/locations/global/sessions/" + re.escape(session_id))
    if name.split("/")[1] != project and not name.split("/")[1].isdecimal():
        raise ValueError("Returned session project identity does not match the requested project")
    runtime = obj(report["sessionReport"])
    jobs: list[Json] = []
    for index, job in enumerate(records(runtime.get("jobReports", []))):
        executions = [{"index": execution_index, **native_status(execution),
                       "junit_reference_count": junit_reference_count(execution)}
                      for execution_index, execution in enumerate(records(job.get("executionReports", [])))]
        jobs.append({"index": index, **native_status(job), "executions": executions,
                     "junit_reference_count": junit_reference_count(job)})
    return {"session_id": session_id, "resource_name": name, **native_status(runtime), "jobs": jobs,
            "named_cases_verified": False, "named_result_evidence": "JUnit references only; XML and expected inventory were not reconciled"}


def catalog_summary(catalog: list[Json], devices: list[str]) -> list[Json]:
    results: list[Json] = []
    for device, api in zip(devices, ("37", "30", "31", "33")):
        matches = [item for item in catalog if isinstance(item.get("name"), str) and cast(str, item["name"]).rsplit("/", 1)[-1] == device]
        if len(matches) > 1:
            raise ValueError("Configured device has duplicate catalog matches; inspect private catalog")
        row: Json = {"device": device, "expected_api": api, "found": bool(matches), "suitable": False}
        if matches:
            item = matches[0]
            platform = token(item["platform"], r"[A-Z_]+")
            actual_api = token(item["osVersion"], r"[0-9.]+")
            lifecycle = token(obj(item["lifecycle"])["state"], r"[A-Z_]+")
            denied = item.get("accessDeniedReasons", [])
            if not isinstance(denied, list):
                raise ValueError("Invalid catalog access information")
            automation = any(isinstance(product.get("automation"), dict) for product in records(item["supportedProducts"]))
            availability = obj(item.get("availability", {}))
            row.update({"api": actual_api, "platform": platform, "lifecycle": lifecycle,
                        "access_denied_count": len(denied), "automation": automation,
                        "availability": token(availability.get("available", "NOT_REPORTED"), r"[A-Z_]+"),
                        "capacity": token(availability.get("capacity", "NOT_REPORTED"), r"[A-Z_]+"),
                        "suitable": actual_api == api and platform == "ANDROID" and lifecycle == "ACTIVE" and not denied and automation})
        results.append(row)
    return results


def main() -> None:
    project = token(os.environ["GCP_PROJECT_ID"], r"[a-z][a-z0-9-]{4,28}[a-z0-9]")
    bucket = token(os.environ["ANDROID_DEVICE_RUN_RESULTS_BUCKET"], r"[a-z0-9][a-z0-9._-]+")
    run_id = token(os.environ["GITHUB_RUN_ID"], r"[0-9]+")
    attempt = token(os.environ["GITHUB_RUN_ATTEMPT"], r"[0-9]+")
    sha = token(os.environ["GITHUB_SHA"], r"[a-f0-9]{40}")
    session_id = os.environ["DEVICE_RUN_SESSION_ID"]
    if session_id:
        token(session_id, r"session-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
    compat = json.loads(os.environ["ANDROID_DEVICE_RUN_COMPAT_DEVICES"])
    if not isinstance(compat, list) or len(compat) != 3:
        raise ValueError("Compatibility configuration must contain three IDs ordered by API 30, 31, 33")
    devices = [token(value, r"[A-Za-z0-9_-]+") for value in [os.environ["ANDROID_DEVICE_RUN_DEVICE"], *compat]]
    if len(set(devices)) != 4:
        raise ValueError("All four configured Device Run catalog IDs must be distinct")
    temporary = Path(os.environ["RUNNER_TEMP"])
    private = temporary / "device-run-diagnostics-private"
    public = temporary / "device-run-diagnostics-public"
    private.mkdir(exist_ok=True)
    public.mkdir(exist_ok=True)
    diagnostics = private / "diagnostics.log"
    archive_uri = f"gs://{bucket}/diagnostics/device-run/{sha}/r{run_id}a{attempt}/raw.tar.gz"
    summary: Json = {"project": project, "location": "global", "workflow_sha": sha, "github_run_id": run_id,
                     "github_run_attempt": attempt, "private_archive": archive_uri, "private_archive_uploaded": False}
    failed = False
    try:
        catalog = private / "catalog.json"
        summary["stage"] = "catalog_read"
        gcloud(["beta", "device-run", "devices", "list", "--project", project, "--location", "global", "--format=json"], catalog, diagnostics)
        summary["catalog_report"] = {"member": catalog.name, "sha256": digest(catalog)}
        summary["stage"] = "catalog_parse"
        destinations = catalog_summary(records(json.loads(catalog.read_text())), devices)
        summary["catalog"] = destinations
        if session_id:
            report = private / "session-full.json"
            summary["stage"] = "session_read"
            gcloud(["beta", "device-run", "sessions", "describe", session_id, "--full", "--project", project,
                    "--location", "global", "--format=json"], report, diagnostics)
            summary["session_report"] = {"member": report.name, "sha256": digest(report)}
            summary["stage"] = "session_parse"
            summary["session"] = session_summary(obj(json.loads(report.read_text())), session_id, project)
        summary["stage"] = "catalog_validation"
        if not all(row["suitable"] for row in destinations):
            raise ValueError("Configured catalog destinations are missing or unsuitable; inspect safe catalog metadata")
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        failed = True
        summary["failed_stage"] = summary["stage"]
        with diagnostics.open("a") as stream:
            stream.write(f"{type(error).__name__}: {error}\n")
    finally:
        archive = temporary / "device-run-diagnostics-raw.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for path in sorted(private.iterdir()):
                if path.is_file():
                    bundle.add(path, arcname=path.name)
        summary["stage"] = "archive_upload"
        summary["private_archive_sha256"] = digest(archive)
        (public / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        gcloud(["storage", "cp", str(archive), archive_uri], temporary / "device-run-diagnostics-upload.log", diagnostics)
        summary["private_archive_uploaded"] = True
        summary["stage"] = "failed" if failed else "complete"
        (public / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
            stream.write("## Device Run diagnostics\n\n```json\n" + json.dumps(summary, indent=2) + "\n```\n")
    if failed:
        raise RuntimeError("Diagnostics collection failed; inspect summary.json and its private archive for the failed read or catalog configuration")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.TimeoutExpired):
        raise SystemExit("ERROR: Device Run diagnostics failed; inspect the safe summary and private archive. Verify existing repository configuration and identity access.")
