#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None


def object_value(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object in retained release evidence')
    return value


def array_value(value: Json) -> list[Json]:
    if not isinstance(value, list):
        raise ValueError('Expected a JSON array in retained release evidence')
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def github(path: str) -> dict[str, Json]:
    return object_value(json.loads(subprocess.check_output(['gh', 'api', path])))


def artifact_file(artifact_id: str, expected_name: str, member_name: str, run_id: str, workflow_sha: str, started: str, finished: str, output: Path) -> dict[str, Json]:
    repository = os.environ['GITHUB_REPOSITORY']
    metadata = github(f'repos/{repository}/actions/artifacts/{artifact_id}')
    artifact_run = object_value(metadata.get('workflow_run'))
    require(metadata.get('name') == expected_name and metadata.get('expired') is False, 'Original artifact name differs or artifact expired')
    require(str(artifact_run.get('id')) == run_id and artifact_run.get('head_sha') == workflow_sha, 'Artifact is not from the original workflow head/run')
    created = metadata.get('created_at')
    require(isinstance(created, str) and started <= created <= finished, 'Artifact was not created during the selected original attempt')
    archive = output.with_suffix('.zip')
    with archive.open('wb') as target:
        subprocess.run(['gh', 'api', f'repos/{repository}/actions/artifacts/{artifact_id}/zip', '--allow-escape-sequences'], stdout=target, check=True)
    digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
    require(metadata.get('digest') == digest, 'Downloaded original artifact ZIP differs from GitHub digest')
    with zipfile.ZipFile(archive) as bundle:
        names = [name for name in bundle.namelist() if not name.endswith('/')]
        require(names == [member_name], f'Original artifact must contain exactly {member_name}: {names}')
        output.write_bytes(bundle.read(member_name))
    archive.unlink()
    return metadata


def main() -> None:
    require(os.environ['PLAY_PREFLIGHT_CONFIRMED'] == 'true', 'Fresh Play managed-publishing/no-review/empty-submission-queue preflight must be confirmed')
    run_id = os.environ['SOURCE_RUN_ID']
    attempt = os.environ['SOURCE_RUN_ATTEMPT']
    source = os.environ['ARTIFACT_SOURCE_SHA']
    code = os.environ['ANDROID_VERSION_CODE']
    expected_hash = os.environ['AAB_SHA256']
    summary_hash = os.environ['NATIVE_SUMMARY_SHA256']
    for value in (run_id, attempt, code, os.environ['BUNDLE_ARTIFACT_ID'], os.environ['NATIVE_ARTIFACT_ID']):
        require(re.fullmatch(r'[1-9][0-9]*', value) is not None, 'Run, attempt, code and artifact IDs must be positive integers')
    require(re.fullmatch(r'[a-f0-9]{40}', source) is not None, 'Original artifact source must be a full Git SHA')
    require(all(re.fullmatch(r'[a-f0-9]{64}', value) for value in (expected_hash, summary_hash)), 'Bundle and native summary SHA-256 must be full lowercase hashes')
    repository = os.environ['GITHUB_REPOSITORY']
    run = github(f'repos/{repository}/actions/runs/{run_id}/attempts/{attempt}')
    require(run.get('path') == '.github/workflows/android-release.yml' and run.get('event') == 'workflow_dispatch', 'Recovery requires an original Android Release dispatch')
    workflow_sha = run.get('head_sha')
    require(isinstance(workflow_sha, str) and re.fullmatch(r'[a-f0-9]{40}', workflow_sha) is not None, 'Original workflow head SHA is missing or invalid')
    require(str(run.get('run_attempt')) == attempt, 'Original release attempt differs')
    require(run.get('status') == 'completed' and run.get('conclusion') == 'failure', 'Recovery requires a terminal failed original release')
    jobs_page = github(f'repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    jobs = [object_value(job) for job in array_value(jobs_page.get('jobs'))]
    require(jobs_page.get('total_count') == len(jobs), 'Original attempt job export is incomplete')
    required_jobs = {
        'Resolve Android release target', 'Android CI / Android build, unit tests, and lint',
        'Android CI / Android emulator data:local instrumentation', 'Device Run app instrumentation',
        'Android release summary', 'Upload Android bundle to Google Play production draft release',
    }
    require(len(jobs) == len(required_jobs) and {job.get('name') for job in jobs} == required_jobs, 'Original release job inventory differs')
    publish = next(job for job in jobs if job.get('name') == 'Upload Android bundle to Google Play production draft release')
    require(publish.get('conclusion') == 'failure' and all(job.get('conclusion') == 'success' for job in jobs if job != publish), 'Original release has a failure outside the publisher gate')
    steps = {step.get('name'): step.get('conclusion') for step in (object_value(item) for item in array_value(publish.get('steps')))}
    for name in ('Build signed Android App Bundle', 'Upload signed Android App Bundle artifact', 'Report and gate R8 optimization coverage'):
        require(steps.get(name) == 'success', f'Original signed build/artifact/R8 step did not pass: {name}')
    require(steps.get('Upload bundle to Google Play production track as draft release') == 'failure', 'Original publisher failure does not match the supported recovery boundary')
    started = run.get('run_started_at')
    finished = max(str(job['completed_at']) for job in jobs)
    require(isinstance(started, str), 'Original attempt start time is missing')
    preflight = next(job for job in jobs if job.get('name') == 'Resolve Android release target')
    preflight_log = subprocess.check_output(['gh', 'api', f'repos/{repository}/actions/jobs/{preflight["id"]}/logs', '--allow-escape-sequences']).decode()
    clean_preflight_log = re.sub(r'\x1b\[[0-9;]*m', '', preflight_log)
    resolved_targets = re.findall(r'(?m)^\S+\s+TARGET_SHA:\s*([a-f0-9]{40})\s*$', clean_preflight_log)
    workflow_targets = re.findall(r'(?m)^\S+\s+WORKFLOW_TARGET_SHA:\s*([a-f0-9]{40})\s*$', clean_preflight_log)
    require(set(resolved_targets) == {source}, 'Original resolved preflight product target differs from the pinned signed source')
    require(set(workflow_targets) == {workflow_sha}, 'Original preflight workflow head differs from GitHub run metadata')
    output = Path(os.environ['RECOVERY_EVIDENCE_DIR'])
    output.mkdir(parents=True, exist_ok=True)
    bundle_metadata = artifact_file(os.environ['BUNDLE_ARTIFACT_ID'], 'android-release-bundle', 'app-release.aab', run_id, workflow_sha, started, finished, output / 'app-release.aab')
    native_metadata = artifact_file(os.environ['NATIVE_ARTIFACT_ID'], 'android-device-run-submissions', 'summary.json', run_id, workflow_sha, started, finished, output / 'summary.json')
    require(hashlib.sha256((output / 'app-release.aab').read_bytes()).hexdigest() == expected_hash, 'Original signed AAB SHA-256 differs')
    require(hashlib.sha256((output / 'summary.json').read_bytes()).hexdigest() == summary_hash, 'Original native summary SHA-256 differs')
    native = object_value(json.loads((output / 'summary.json').read_text()))
    release_id = f'vc{code}-r{run_id}a{attempt}-s{source[:8]}'
    require(native.get('target_sha') == source and native.get('github_run_id') == run_id and native.get('github_run_attempt') == attempt and native.get('release_id') == release_id, 'Original native source/run/attempt/code labels differ')
    require(native.get('private_archive_uploaded') is True and isinstance(native.get('private_archive_sha256'), str), 'Original full private native evidence is missing')
    sessions = [object_value(session) for session in array_value(native.get('sessions'))]
    expected_devices = {'37': os.environ['ANDROID_DEVICE_RUN_DEVICE'], **dict(zip(('30', '31', '33'), json.loads(os.environ['ANDROID_DEVICE_RUN_COMPAT_DEVICES']), strict=True))}
    require(len(sessions) == 4 and {session.get('api') for session in sessions} == set(expected_devices), 'Original native evidence does not contain all four APIs')
    require(len({session.get('session_id') for session in sessions}) == 4, 'Original native session IDs are duplicated')
    inventory = array_value(native.get('latest_inventory'))
    require(len(inventory) > 0 and len(inventory) == len(set(inventory)), 'Original full source inventory is empty or duplicated')
    selection = github(f'repos/{repository}/contents/scripts/android/device-run-test-selection.json?ref={source}')
    selection_data = object_value(json.loads(base64.b64decode(str(selection['content']))))
    compat = {str(target).removeprefix('class ') for target in array_value(selection_data.get('compat'))}
    require(len(compat) == 4, 'Original compatibility source selection must contain four methods')
    for session in sessions:
        api = str(session['api'])
        require(session.get('device') == expected_devices[api] and session.get('passed') is True and session.get('problems') == [], f'Original API {api} native gate did not pass on the configured destination')
        cases = [object_value(case) for case in array_value(session.get('cases'))]
        expected_cases = set(inventory) if api == '37' else compat
        require(len(cases) == len(expected_cases) and {case.get('identity') for case in cases} == expected_cases, f'Original API {api} named inventory differs')
        require(all(case.get('status') == 'passed' and case.get('count') == 1 for case in cases), f'Original API {api} contains a nonpassing or duplicate named case')
        require(session.get('counts') == {'passed': len(cases), 'failure': 0, 'error': 0, 'skipped': 0}, f'Original API {api} native totals differ')
    source_build = github(f'repos/{repository}/contents/apps/android/app/build.gradle.kts?ref={source}')
    version_matches = re.findall(r'versionName\s*=\s*"([^"]+)"', base64.b64decode(str(source_build['content'])).decode())
    require(len(version_matches) == 1, 'Original source version name is missing or ambiguous')
    record = {'artifactSourceSha': source, 'originalWorkflowSha': workflow_sha, 'resolvedPreflightSourceSha': source, 'preflightLogSha256': hashlib.sha256(preflight_log.encode()).hexdigest(), 'versionName': version_matches[0], 'originalRun': run, 'originalJobs': jobs, 'bundleArtifact': bundle_metadata, 'nativeArtifact': native_metadata, 'originalReleaseId': release_id, 'aabSha256': expected_hash, 'nativeSummarySha256': summary_hash}
    (output / 'original-release-provenance.json').write_text(json.dumps(record, indent=2) + '\n')
    with Path(os.environ['GITHUB_ENV']).open('a') as environment:
        environment.write(f'ANDROID_PLAY_RELEASE_NAME=main-draft-{release_id}\nAAB_PATH={output / "app-release.aab"}\n')


if __name__ == '__main__':
    main()
