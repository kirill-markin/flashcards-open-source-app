#!/usr/bin/env python3
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None


def object_value(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError('Play API response must be an object')
    return value


def request(method: str, url: str, body: bytes | None, content_type: str) -> dict[str, Json]:
    headers = {'Authorization': f'Bearer {os.environ["PLAY_ACCESS_TOKEN"]}', 'Content-Type': content_type}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=300) as response:
            return object_value(json.loads(response.read()))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Play API {method} {url} failed: HTTP {error.code}: {error.read().decode()}') from error


def main() -> None:
    package = os.environ['ANDROID_PLAY_PACKAGE_NAME']
    code = os.environ['ANDROID_VERSION_CODE']
    name = os.environ['ANDROID_PLAY_RELEASE_NAME']
    source = os.environ['ARTIFACT_SOURCE_SHA']
    if re.fullmatch(r'[a-f0-9]{40}', source) is None:
        raise ValueError('Signed artifact source must be a full Git SHA')
    expected_hash = os.environ['AAB_SHA256']
    bundle_path = Path(os.environ['AAB_PATH'])
    if package != 'com.flashcardsopensourceapp.app' or not re.fullmatch(r'[1-9][0-9]*', code):
        raise ValueError('Unexpected Play package or version code')
    if hashlib.sha256(bundle_path.read_bytes()).hexdigest() != expected_hash:
        raise ValueError('Signed bundle does not match the pinned SHA-256')
    if not re.fullmatch(r'main-draft-vc' + code + r'-r[0-9]+a[0-9]+-s' + source[:8], name):
        raise ValueError('Play release name does not match the original version code and release identity')
    base = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package}/edits'
    edit = request('POST', base, b'{}', 'application/json')
    edit_id = edit.get('id')
    if not isinstance(edit_id, str) or re.fullmatch(r'[A-Za-z0-9_-]+', edit_id) is None:
        raise ValueError('Play did not return a valid edit ID')
    edit_base = f'{base}/{edit_id}'
    record: dict[str, Json] = {
        'sourceSha': os.environ['ARTIFACT_SOURCE_SHA'], 'versionCode': code,
        'aabSha256': expected_hash, 'releaseName': name, 'editId': edit_id,
        'publisherRunId': os.environ['GITHUB_RUN_ID'], 'publisherRunAttempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'workflowSha': os.environ['GITHUB_SHA'], 'changesInReviewBehavior': 'ERROR_IF_IN_REVIEW',
        'commitStatus': 'not-attempted',
    }
    record_path = Path(os.environ['PLAY_PROVENANCE_PATH'])
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    listed = request('GET', f'{edit_base}/bundles', None, 'application/json').get('bundles', [])
    if not isinstance(listed, list):
        raise ValueError('Play bundles response has no valid bundle list')
    matching = [object_value(item) for item in listed if str(object_value(item).get('versionCode')) == code]
    if len(matching) > 1:
        raise ValueError('Play returned duplicate bundles for the pinned version code')
    if matching:
        bundle = matching[0]
        record['bundleOperation'] = 'reuse-existing-exact-bundle'
    else:
        upload = f'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{package}/edits/{edit_id}/bundles?uploadType=media'
        bundle = request('POST', upload, bundle_path.read_bytes(), 'application/octet-stream')
        record['bundleOperation'] = 'upload-original-signed-bytes'
    if str(bundle.get('versionCode')) != code or bundle.get('sha256') != expected_hash:
        raise ValueError(f'Play bundle identity differs: expected code={code} sha256={expected_hash}, received={bundle}')
    track: dict[str, Json] = {'track': 'production', 'releases': [{'name': name, 'versionCodes': [code], 'status': 'draft'}]}
    updated = request('PUT', f'{edit_base}/tracks/production', json.dumps(track).encode(), 'application/json')
    releases = updated.get('releases')
    if updated.get('track') != 'production' or not isinstance(releases, list) or len(releases) != 1 or any(object_value(releases[0]).get(key) != value for key, value in object_value(track['releases'][0]).items()):
        raise ValueError(f'Play draft track readback differs from the single intended release: {updated}')
    record['track'] = updated
    request('POST', f'{edit_base}:validate', b'', 'application/json')
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    record['commitStatus'] = 'requested-unconfirmed'
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    committed = request('POST', f'{edit_base}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW', b'', 'application/json')
    if committed.get('id') != edit_id:
        raise ValueError(f'Play commit response has an unexpected edit ID: {committed}')
    record['commitStatus'] = 'confirmed'
    record['committed'] = True
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
