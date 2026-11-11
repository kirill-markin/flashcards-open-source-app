#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

from play_release_notes import read_notes

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


def named_selection(value: Json, count: int) -> set[str]:
    targets = array_value(value)
    require(len(targets) == count and all(isinstance(target, str) and
            re.fullmatch(r'class com\.flashcardsopensourceapp\.app\.[\w.]+#\w+', target) for target in targets),
            f'Original pinned source selection must contain {count} named methods')
    names = {str(target).removeprefix('class ') for target in targets}
    require(len(names) == count, 'Original pinned source selection has duplicate methods')
    return names


def is_digest(value: Json) -> bool:
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def verified_session_id(record: dict[str, Json]) -> str:
    session_id = str(record.get('session_id'))
    report = object_value(record.get('report'))
    require(re.fullmatch(r'session-[a-f0-9-]+', session_id) is not None and
            report.get('member') == f'{session_id}/session-full.json' and is_digest(report.get('sha256')),
            'Original native full session report is missing or invalid')
    return session_id


def verify_native(native: dict[str, Json], selection: dict[str, Json], expected_devices: dict[str, str]) -> None:
    schema = selection.get('schemaVersion', 1)
    summary_schema = native.get('selection_schema_version', 1)
    require(type(schema) is int and schema in (1, 2) and type(summary_schema) is int and summary_schema == schema,
            'Original native selection schema differs from the pinned source')
    apis = {'37', '30', '31', '33'} if schema == 1 else {'37', '30'}
    compat = named_selection(selection.get('compat'), 4 if schema == 1 else 1)
    sessions = [object_value(session) for session in array_value(native.get('sessions'))]
    require(len(sessions) == len(apis) and {session.get('api') for session in sessions} == apis,
            'Original native evidence does not contain the required APIs')
    require(len({session.get('session_id') for session in sessions}) == len(apis), 'Original native session IDs are duplicated')
    inventory = array_value(native.get('latest_inventory'))
    require(len(inventory) > 0 and len(inventory) == len(set(inventory)), 'Original full source inventory is empty or duplicated')
    if schema == 2:
        require(set(inventory) == named_selection(selection.get('latest'), 5) and compat <= set(inventory),
                'Original native inventory differs from the pinned source')

    session_ids: set[str] = set()
    retry_ids: list[str] = []
    apk_hashes: list[dict[str, Json]] = []
    effective_devices: set[str] = set()
    for session in sessions:
        api = str(session['api'])
        configured = expected_devices[api]
        effective = str(session.get('device'))
        require(session.get('passed') is True and session.get('problems') == [],
                f'Original API {api} native gate did not pass')
        cases = [object_value(case) for case in array_value(session.get('cases'))]
        expected_cases = set(inventory) if api == '37' else compat
        require(len(cases) == len(expected_cases) and {case.get('identity') for case in cases} == expected_cases,
                f'Original API {api} named inventory differs')
        require(all(case.get('status') == 'passed' and case.get('count') == 1 for case in cases),
                f'Original API {api} contains a nonpassing or duplicate named case')
        require(session.get('counts') == {'passed': len(cases), 'failure': 0, 'error': 0, 'skipped': 0},
                f'Original API {api} native totals differ')
        if schema == 1:
            require(effective == configured, f'Original API {api} did not run on the configured destination')
            continue
        require(session.get('configured_device') == configured and
                re.fullmatch(r'[A-Za-z0-9_-]+', effective) is not None and
                session.get('selection') == ('latest' if api == '37' else f'compat-api{api}') and
                session.get('expected_count') == len(expected_cases),
                f'Original API {api} selection or device pin differs')
        effective_devices.add(effective)
        session_ids.add(verified_session_id(session))
        artifacts = [object_value(item) for item in array_value(session.get('artifacts'))]
        hashes = {}
        for kind in ('app', 'test'):
            matching = [artifact.get('sha256') for artifact in artifacts if artifact.get('kind') == kind]
            require(len(matching) == 1 and is_digest(matching[0]), f'Original API {api} {kind} APK hash is missing or invalid')
            hashes[kind] = matching[0]
        apk_hashes.append(hashes)
        if 'initial_failure' not in session:
            require(effective == configured, f'Original API {api} has an alternate device without classified failure evidence')
            continue
        failure = object_value(session['initial_failure'])
        retry_ids.append(verified_session_id(failure))
        require(failure.get('selection') == session['selection'] and failure.get('device') == configured and
                failure.get('apk_sha256') == hashes,
                f'Original API {api} retry does not match its first device and APK hashes')
        if failure.get('reason') == 'lab_unavailable_before_execution':
            catalog = object_value(failure.get('alternate_catalog'))
            require(effective != configured and catalog.get('member') == 'retry-catalog.json' and is_digest(catalog.get('sha256')),
                    f'Original API {api} retry is missing alternate device catalog evidence')
        else:
            require(failure.get('reason') == 'lab_dns_before_auth_request' and effective == configured,
                    f'Original API {api} retry has an unsupported reason or device')
    if schema == 2:
        require(len(effective_devices) == len(apis) and len(retry_ids) <= 1 and session_ids.isdisjoint(retry_ids),
                'Original native effective devices or retry sessions are duplicated, or retry limit exceeded')
        require(all(hashes == apk_hashes[0] for hashes in apk_hashes), 'Original Device Run sessions used different APK bytes')


def main() -> None:
    require(os.environ['PLAY_PREFLIGHT_CONFIRMED'] == 'true', 'Fresh Play preflight must confirm managed publishing OFF (unless user requested a hold), no active review, an empty ready-to-submit queue and all retained release gates reviewed')
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
    publish_name = 'Upload Android bundle to Google Play production draft release'
    signed_build_name = 'Build and verify signed Android App Bundle'
    combined_jobs = {
        'Resolve Android release target', 'Android CI / Android build, unit tests, and lint',
        'Android CI / Android emulator data:local instrumentation', 'Device Run app instrumentation',
        'Android release summary', publish_name,
    }
    wear_publish_name = 'Upload Wear OS bundle to Google Play wear production draft release'
    split_jobs = combined_jobs | {signed_build_name}
    wear_jobs = split_jobs | {wear_publish_name}
    jobs_by_name = {str(job.get('name')): job for job in jobs}
    require(len(jobs_by_name) == len(jobs) and jobs_by_name.keys() in (combined_jobs, split_jobs, wear_jobs), 'Original release job inventory differs')
    publish = jobs_by_name[publish_name]
    # The Wear OS publisher runs only after a successful phone publisher, so it is skipped here.
    require(publish.get('conclusion') == 'failure' and all(job.get('conclusion') == ('skipped' if name == wear_publish_name else 'success') for name, job in jobs_by_name.items() if name != publish_name), 'Original release has a failure outside the publisher gate')
    build_steps = ('Build signed Android App Bundle', 'Upload signed Android App Bundle artifact', 'Report and gate R8 optimization coverage')
    is_split_release = signed_build_name in jobs_by_name
    if is_split_release:
        signed_build = jobs_by_name[signed_build_name]
        bundle_name = f'android-release-bundle-r{run_id}a{attempt}'
        build_steps += ('Record signed Android App Bundle checksum',)
    else:
        signed_build = publish
        bundle_name = 'android-release-bundle'
    signed_steps = {step.get('name'): step.get('conclusion') for step in (object_value(item) for item in array_value(signed_build.get('steps')))}
    for name in build_steps:
        require(signed_steps.get(name) == 'success', f'Original signed build/artifact/R8 step did not pass: {name}')
    publish_steps = {step.get('name'): step.get('conclusion') for step in (object_value(item) for item in array_value(publish.get('steps')))}
    upload_conclusion = publish_steps.get('Upload bundle to Google Play production track as draft release')
    failed_before_upload = (
        is_split_release
        and upload_conclusion == 'skipped'
        and any(
            publish_steps.get(name) == 'failure'
            for name in (
                'Validate Google Play configuration',
                'Check out publisher tooling from the workflow source',
                'Download signed Android App Bundle for this attempt',
                'Download original Play release notes',
                'Authenticate to Google Play',
            )
        )
    )
    require(upload_conclusion == 'failure' or failed_before_upload, 'Original publisher failure does not match the supported recovery boundary')
    started = run.get('run_started_at')
    finished = max(str(job['completed_at']) for job in jobs)
    require(isinstance(started, str), 'Original attempt start time is missing')
    preflight = jobs_by_name['Resolve Android release target']
    preflight_log = subprocess.check_output(['gh', 'api', f'repos/{repository}/actions/jobs/{preflight["id"]}/logs', '--allow-escape-sequences']).decode()
    clean_preflight_log = re.sub(r'\x1b\[[0-9;]*m', '', preflight_log)
    resolved_targets = re.findall(r'(?m)^\S+\s+TARGET_SHA:\s*([a-f0-9]{40})\s*$', clean_preflight_log)
    workflow_targets = re.findall(r'(?m)^\S+\s+WORKFLOW_TARGET_SHA:\s*([a-f0-9]{40})\s*$', clean_preflight_log)
    require(set(resolved_targets) == {source}, 'Original resolved preflight product target differs from the pinned signed source')
    require(set(workflow_targets) == {workflow_sha}, 'Original preflight workflow head differs from GitHub run metadata')
    output = Path(os.environ['RECOVERY_EVIDENCE_DIR'])
    output.mkdir(parents=True, exist_ok=True)
    bundle_metadata = artifact_file(os.environ['BUNDLE_ARTIFACT_ID'], bundle_name, 'app-release.aab', run_id, workflow_sha, started, finished, output / 'app-release.aab')
    native_metadata = artifact_file(os.environ['NATIVE_ARTIFACT_ID'], 'android-device-run-submissions', 'summary.json', run_id, workflow_sha, started, finished, output / 'summary.json')
    require(hashlib.sha256((output / 'app-release.aab').read_bytes()).hexdigest() == expected_hash, 'Original signed AAB SHA-256 differs')
    require(hashlib.sha256((output / 'summary.json').read_bytes()).hexdigest() == summary_hash, 'Original native summary SHA-256 differs')
    native = object_value(json.loads((output / 'summary.json').read_text()))
    release_id = f'vc{code}-r{run_id}a{attempt}-s{source[:8]}'
    require(native.get('target_sha') == source and native.get('github_run_id') == run_id and native.get('github_run_attempt') == attempt and native.get('release_id') == release_id, 'Original native source/run/attempt/code labels differ')
    require(native.get('private_archive_uploaded') is True and isinstance(native.get('private_archive_sha256'), str), 'Original full private native evidence is missing')
    expected_devices = {'37': os.environ['ANDROID_DEVICE_RUN_DEVICE'], **dict(zip(('30', '31', '33'), json.loads(os.environ['ANDROID_DEVICE_RUN_COMPAT_DEVICES']), strict=True))}
    selection = github(f'repos/{repository}/contents/scripts/android/device-run-test-selection.json?ref={source}')
    selection_data = object_value(json.loads(base64.b64decode(str(selection['content']))))
    verify_native(native, selection_data, expected_devices)
    if selection_data.get('schemaVersion') == 2:
        require(is_digest(native.get('private_archive_sha256')), 'Original private native archive hash is missing or invalid')
        native_steps = array_value(jobs_by_name['Device Run app instrumentation'].get('steps'))
        require(sum(step.get('name') == 'Collect private native evidence and gate named results' and
                    step.get('conclusion') == 'success' for step in map(object_value, native_steps)) == 1,
                'Original Device Run native evidence collection step did not pass')
    source_build = github(f'repos/{repository}/contents/apps/android/app/build.gradle.kts?ref={source}')
    version_matches = re.findall(r'versionName\s*=\s*"([^"]+)"', base64.b64decode(str(source_build['content'])).decode())
    require(len(version_matches) == 1, 'Original source version name is missing or ambiguous')
    original_workflow = github(f'repos/{repository}/contents/.github/workflows/android-release.yml?ref={workflow_sha}')
    supports_notes = 'localized_release_notes:' in base64.b64decode(str(original_workflow['content'])).decode()
    notes_hashes = re.findall(r'(?m)^\S+\s+PLAY_NOTES_SHA256=([a-f0-9]{64})\s*$', clean_preflight_log)
    preflight_steps = {step.get('name'): step.get('conclusion') for step in (object_value(item) for item in array_value(preflight.get('steps')))}
    notes_metadata: dict[str, Json] | None = None
    notes_digest = ''
    notes_path = ''
    if supports_notes:
        require(len(notes_hashes) == 1, 'Original release-notes manifest SHA-256 is missing or ambiguous in original preflight logs')
        for step_name in ('Prepare localized Play release notes', 'Retain original Play release notes'):
            require(preflight_steps.get(step_name) == 'success', f'Original release-notes evidence step did not pass: {step_name}')
        artifacts_page = github(f'repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100')
        artifacts = [object_value(item) for item in array_value(artifacts_page.get('artifacts'))]
        require(artifacts_page.get('total_count') == len(artifacts), 'Original notes artifact export is incomplete')
        notes_name = f'android-release-notes-r{run_id}a{attempt}'
        matching_notes = [artifact for artifact in artifacts if artifact.get('name') == notes_name]
        require(len(matching_notes) == 1, 'Exact original run/attempt release-notes artifact is missing or ambiguous')
        notes_path = str(output / 'release-notes.json')
        notes_metadata = artifact_file(str(matching_notes[0]['id']), notes_name, 'release-notes.json', run_id, workflow_sha, started, finished, Path(notes_path))
        notes_digest = notes_hashes[0]
        read_notes(Path(notes_path), notes_digest, source, code, version_matches[0], run_id, attempt)
    else:
        require(not notes_hashes and 'Prepare localized Play release notes' not in preflight_steps, 'Legacy original workflow has unexpected release-notes evidence')
    record = {'artifactSourceSha': source, 'originalWorkflowSha': workflow_sha, 'resolvedPreflightSourceSha': source, 'preflightLogSha256': hashlib.sha256(preflight_log.encode()).hexdigest(), 'versionName': version_matches[0], 'originalRun': run, 'originalJobs': jobs, 'bundleArtifact': bundle_metadata, 'nativeArtifact': native_metadata, 'originalReleaseId': release_id, 'aabSha256': expected_hash, 'nativeSummarySha256': summary_hash, 'notesArtifact': notes_metadata, 'releaseNotesSha256': notes_digest or None}
    (output / 'original-release-provenance.json').write_text(json.dumps(record, indent=2) + '\n')
    with Path(os.environ['GITHUB_ENV']).open('a') as environment:
        environment.write(f'ANDROID_VERSION_NAME={version_matches[0]}\nPLAY_NOTES_PATH={notes_path}\nPLAY_NOTES_SHA256={notes_digest}\nANDROID_PLAY_RELEASE_NAME=main-draft-{release_id}\nAAB_PATH={output / "app-release.aab"}\n')


if __name__ == '__main__':
    main()
