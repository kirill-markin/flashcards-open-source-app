#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import time
from typing import cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from catalog import BUNDLE_ROOTS, REPOSITORY, ROOT, BundleRecord, FileRecord, Manifest, sha256_file


def validate_hash(value: object) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise ValueError(f"Invalid SHA-256 in media manifest: {value!r}")


def validate_size(value: object) -> None:
    if type(value) is not int or value < 0:
        raise ValueError(f"Invalid byte size in media manifest: {value!r}")


def read_manifest(path: Path) -> Manifest:
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or data.get("repository") != REPOSITORY:
        raise ValueError(f"Unsupported media manifest: {path}")
    tag = data.get("releaseTag")
    if not isinstance(tag, str) or re.fullmatch(r"media-archive-[A-Za-z0-9_.-]+", tag) is None:
        raise ValueError("Invalid release tag in media manifest")
    bundles = data.get("bundles")
    if not isinstance(bundles, dict) or set(bundles) != set(BUNDLE_ROOTS):
        raise ValueError("Media manifest must contain the seven known bundles")
    for name, root in BUNDLE_ROOTS.items():
        bundle = bundles[name]
        if not isinstance(bundle, dict) or bundle.get("root") != root or bundle.get("asset") != f"{name}.tar.gz":
            raise ValueError(f"Invalid bundle location: {name}")
        validate_hash(bundle.get("sha256"))
        validate_size(bundle.get("size"))
        files = bundle.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError(f"Missing file inventory: {name}")
        seen: set[str] = set()
        for entry in files:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                raise ValueError(f"Invalid file record: {name}")
            filename = entry["path"]
            relative = PurePosixPath(filename)
            if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != filename or not filename.startswith(root + "/") or "\\" in filename or filename in seen:
                raise ValueError(f"Unsafe or duplicate media path: {filename}")
            seen.add(filename)
            validate_hash(entry.get("sha256"))
            validate_size(entry.get("size"))
    return cast(Manifest, data)


def fetch_archive(url: str, path: Path, bundle: BundleRecord) -> None:
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "Nibomo-media-downloader"})
            with urlopen(request, timeout=120) as response, path.open("wb") as output:
                shutil.copyfileobj(response, output)
            break
        except (HTTPError, URLError, TimeoutError) as error:
            if attempt == 2:
                raise
            print(f"Warning: media download failed ({url}): {error}; retrying")
            time.sleep(attempt + 1)
    if path.stat().st_size != bundle["size"] or sha256_file(path) != bundle["sha256"]:
        raise ValueError(f"Downloaded archive size or SHA-256 mismatch: {url}")


def unpack_archive(archive_path: Path, staging: Path, files: list[FileRecord]) -> None:
    expected = {entry["path"]: entry for entry in files}
    seen: set[str] = set()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            entry = expected.get(member.name)
            if entry is None or member.name in seen or not member.isfile() or member.size != entry["size"]:
                raise ValueError(f"Unexpected, duplicate, or unsafe archive entry: {member.name}")
            seen.add(member.name)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Cannot read archived media: {member.name}")
            target = staging / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            if sha256_file(target) != entry["sha256"]:
                raise ValueError(f"Archived media SHA-256 mismatch: {member.name}")
    if seen != set(expected):
        raise ValueError(f"Archive is missing media: {sorted(set(expected) - seen)}")


def verify_destination(destination: Path, files: list[FileRecord]) -> None:
    for entry in files:
        target = destination / entry["path"]
        for parent in (target, *target.parents):
            if parent == destination:
                break
            if parent.is_symlink():
                raise ValueError(f"Refusing media destination symlink: {parent}")
        if target.exists() and (not target.is_file() or target.stat().st_size != entry["size"] or sha256_file(target) != entry["sha256"]):
            raise FileExistsError(f"Local media differs from the pinned archive: {target}. Move it aside before downloading")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download pinned public media bundles with SHA-256 verification")
    parser.add_argument("bundles", nargs="+", choices=["all", *BUNDLE_ROOTS])
    parser.add_argument("--destination", type=Path, default=ROOT)
    parser.add_argument("--manifest", type=Path, default=ROOT / "scripts/media/manifest.json")
    args = parser.parse_args()
    if "all" in args.bundles and len(args.bundles) != 1:
        raise ValueError("Use all alone, or name individual bundles")
    manifest = read_manifest(args.manifest)
    names = list(BUNDLE_ROOTS) if args.bundles == ["all"] else list(dict.fromkeys(args.bundles))
    destination = args.destination.resolve()
    files = [entry for name in names for entry in manifest["bundles"][name]["files"]]
    verify_destination(destination, files)
    with tempfile.TemporaryDirectory(prefix="nibomo-media-") as temporary:
        staging = Path(temporary)
        for name in names:
            bundle = manifest["bundles"][name]
            archive_path = staging / bundle["asset"]
            url = f"https://github.com/{REPOSITORY}/releases/download/{manifest['releaseTag']}/{bundle['asset']}"
            fetch_archive(url, archive_path, bundle)
            unpack_archive(archive_path, staging, bundle["files"])
        verify_destination(destination, files)
        for entry in files:
            target = destination / entry["path"]
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with (staging / entry["path"]).open("rb") as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
    print(f"Verified {len(files)} media files in {len(names)} bundles at {destination}")


if __name__ == "__main__":
    main()
