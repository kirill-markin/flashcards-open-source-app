#!/usr/bin/env python3
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None

LIFECYCLE_DESCRIPTIONS = {
    'RELEASE_LIFECYCLE_STATE_DRAFT': 'Draft; still editable.',
    'RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW': 'Ready to send for review; developer action required.',
    'RELEASE_LIFECYCLE_STATE_IN_REVIEW': 'Submitted and in review.',
    'RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED': 'Approved; awaiting manual publication.',
    'RELEASE_LIFECYCLE_STATE_NOT_APPROVED': 'Rejected in review.',
    'RELEASE_LIFECYCLE_STATE_PUBLISHED': 'Available on the track; may be fully rolled out, staged, or halted.',
}
LIMITATION = 'The API returns at most 20 non-obsolete releases. It does not establish full rollout or public propagation.'


class ReleaseSummary(TypedDict):
    releaseName: str
    track: str
    activeVersionCodes: list[int]
    releaseLifecycleState: str
    lifecycleMeaning: str


def object_value(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError('Play release-list response contains a non-object value')
    return value


def array_value(value: Json) -> list[Json]:
    if not isinstance(value, list):
        raise ValueError('Play release-list response contains a non-array list field')
    return value


def fetch_releases(url: str, token: str) -> dict[str, Json]:
    request = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'}, method='GET')
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return object_value(json.loads(response.read()))
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace').replace(token, '[REDACTED]')
            failure = RuntimeError(f'Play release-list GET {url} failed: HTTP {error.code}; body={body!r}')
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise failure from None
            print(json.dumps({'warning': 'Play release-list retry', 'attempt': attempt, 'httpStatus': error.code}), file=sys.stderr)
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                detail = str(error).replace(token, '[REDACTED]')
                raise RuntimeError(f'Play release-list GET {url} failed after 3 attempts: {detail}') from None
            print(json.dumps({'warning': 'Play release-list network retry', 'attempt': attempt}), file=sys.stderr)
        time.sleep(attempt * 2)
    raise RuntimeError('Play release-list retry loop ended without a response')


def release_summary(value: Json) -> ReleaseSummary:
    release = object_value(value)
    name = release.get('releaseName')
    state = release.get('releaseLifecycleState')
    if not isinstance(name, str) or not name.strip() or release.get('track') != 'production':
        raise ValueError('Play release-list contains a missing release name or unexpected production track')
    if state == 'RELEASE_LIFECYCLE_STATE_UNSPECIFIED':
        raise ValueError('Play returned an unspecified release lifecycle; publication cannot be determined')
    if not isinstance(state, str) or state not in LIFECYCLE_DESCRIPTIONS:
        raise ValueError('Play returned a missing or unknown release lifecycle; inspect the current API contract')
    codes: list[int] = []
    for artifact in array_value(release.get('activeArtifacts', [])):
        code = object_value(artifact).get('versionCode')
        if type(code) is not int or not 0 < code <= 2100000000:
            raise ValueError('Play activeArtifacts contains a missing or invalid integer versionCode')
        codes.append(code)
    if len(codes) != len(set(codes)):
        raise ValueError('Play returned duplicate active artifact version codes within a release')
    return {'releaseName': name, 'track': 'production', 'activeVersionCodes': codes,
            'releaseLifecycleState': state, 'lifecycleMeaning': LIFECYCLE_DESCRIPTIONS[state]}


def main() -> None:
    package = os.environ['ANDROID_PLAY_PACKAGE_NAME']
    code = os.environ['ANDROID_VERSION_CODE']
    if package != 'com.flashcardsopensourceapp.app' or re.fullmatch(r'[1-9][0-9]{0,9}', code) is None or int(code) > 2100000000:
        raise ValueError('Play status requires com.flashcardsopensourceapp.app and a positive version code at most 2100000000')
    token = os.environ['PLAY_ACCESS_TOKEN']
    if not token:
        raise ValueError('PLAY_ACCESS_TOKEN is empty; inspect the workflow WIF authentication step')
    url = f'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{package}/tracks/production/releases'
    response = fetch_releases(url, token)
    releases = [release_summary(value) for value in array_value(response.get('releases', []))]
    if len(releases) > 20:
        raise ValueError('Play returned more than the documented maximum of 20 releases')
    matches = [release for release in releases if int(code) in release['activeVersionCodes']]
    outcome = 'matched' if len(matches) == 1 else 'missing' if not matches else 'ambiguous'
    record = {'packageName': package, 'track': 'production', 'versionCode': int(code),
              'checkedAt': datetime.now(timezone.utc).isoformat(), 'outcome': outcome,
              'matches': matches, 'returnedReleaseCount': len(releases), 'apiLimitation': LIMITATION}
    encoded = json.dumps(record, indent=2)
    Path(os.environ['PLAY_STATUS_PATH']).write_text(encoded + '\n')
    with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as summary:
        summary.write(f'## Android Play release status\n\n<pre>{html.escape(encoded)}</pre>\n\n{LIMITATION}\n')
    print(json.dumps(record))
    if not matches:
        raise ValueError(f'No exact active artifact match for production versionCode={code}. It may be absent or obsolete; publication is unconfirmed. {LIMITATION}')
    if len(matches) != 1:
        raise ValueError(f'Ambiguous production versionCode={code}: {len(matches)} releases match; publication is unconfirmed')


if __name__ == '__main__':
    main()
