#!/usr/bin/env python3
import hashlib
import json
import os
import re
from pathlib import Path

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None

# Exact Play listing codes from docs/google-play-store-metadata.md.
PLAY_LOCALES = frozenset(
    'en-US ar zh-CN fr-FR de-DE hi-IN ja-JP pt-BR ru-RU es-419 es-ES es-US bg bn-BD ca cs-CZ '
    'da-DK el-GR et fa fi-FI gu iw-IL hr hu-HU id is-IS it-IT kn-IN ko-KR lt lv ml-IN mr-IN '
    'nl-NL no-NO pa pl-PL ro sk sl sv-SE sw ta-IN te-IN th tr-TR uk ur vi zu'.split()
)


def parse_notes(raw: str) -> list[Json]:
    if raw == '':
        return []
    value: Json = json.loads(raw)
    if not isinstance(value, list) or len(value) == 0:
        raise ValueError('Localized release notes must be a nonempty JSON list, or leave the dispatch input empty')
    languages: set[str] = set()
    for note in value:
        if not isinstance(note, dict) or set(note) != {'language', 'text'}:
            raise ValueError('Every localized release note must contain exactly language and text')
        language = note['language']
        text = note['text']
        if not isinstance(language, str) or language not in PLAY_LOCALES:
            raise ValueError(f'Unsupported Play locale {language!r}; use the exact codes in docs/google-play-store-metadata.md')
        if language in languages:
            raise ValueError(f'Duplicate localized release note: {language}')
        languages.add(language)
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise ValueError(f'Release notes for {language} must contain 1–500 Unicode characters with nonempty text')
        if any(0xD800 <= ord(character) <= 0xDFFF for character in text):
            raise ValueError(f'Release notes for {language} contain an invalid Unicode surrogate')
    return value


def read_notes(path: Path, digest: str, source: str, code: str, version: str, run_id: str, attempt: str) -> list[Json]:
    if re.fullmatch(r'[a-f0-9]{64}', digest) is None or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError('Retained release-notes manifest differs from its original SHA-256')
    value: Json = json.loads(path.read_bytes())
    expected = {'sourceSha': source, 'versionCode': code, 'versionName': version, 'runId': run_id, 'runAttempt': attempt}
    if not isinstance(value, dict) or any(value.get(key) != item for key, item in expected.items()):
        raise ValueError('Release-notes source/version/original run/attempt binding differs')
    raw = value.get('input')
    if not isinstance(raw, str):
        raise ValueError('Release-notes manifest is missing the exact original dispatch input')
    return parse_notes(raw)


def main() -> None:
    raw = os.environ['LOCALIZED_RELEASE_NOTES']
    notes = parse_notes(raw)
    record = {
        'sourceSha': os.environ['ARTIFACT_SOURCE_SHA'],
        'versionCode': os.environ['ANDROID_VERSION_CODE'],
        'versionName': os.environ['ANDROID_VERSION_NAME'],
        'runId': os.environ['GITHUB_RUN_ID'],
        'runAttempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'input': raw,
    }
    path = Path(os.environ['PLAY_NOTES_PATH'])
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'sha256={digest}\n')
    print(f'PLAY_NOTES_SHA256={digest}')
    print(json.dumps({'releaseNotesLocales': [note['language'] for note in notes]}))


if __name__ == '__main__':
    main()
