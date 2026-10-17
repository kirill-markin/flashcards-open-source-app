#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile

from catalog import BUNDLE_ROOTS, REPOSITORY, ROOT, BundleRecord, FileRecord, Manifest, is_media, sha256_file


def package_bundle(name: str, relative_root: str, output_dir: Path) -> BundleRecord:
    source = ROOT / relative_root
    if not source.is_dir():
        raise FileNotFoundError(f"Missing bundle source {source}; download the current archive before publishing")
    archive_path = output_dir / f"{name}.tar.gz"
    if archive_path.exists():
        raise FileExistsError(f"Archive already exists: {archive_path}; choose a new output directory")
    files: list[FileRecord] = []
    with tarfile.open(archive_path, "w:gz") as archive:
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Bundle source contains a symlink: {path}")
            if not path.is_file() or not is_media(path):
                continue
            contents = path.read_bytes()
            relative_path = path.relative_to(ROOT).as_posix()
            info = tarfile.TarInfo(relative_path)
            info.size = len(contents)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(contents))
            files.append({"path": relative_path, "sha256": hashlib.sha256(contents).hexdigest(), "size": len(contents)})
    if not files:
        raise ValueError(f"No media found in {source}; refusing to publish an empty bundle")
    return {"root": relative_root, "asset": archive_path.name, "sha256": sha256_file(archive_path), "size": archive_path.stat().st_size, "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description="Package local marketing media and update the pinned download manifest")
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    if not args.release_tag.startswith("media-archive-") or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_." for character in args.release_tag):
        raise ValueError("Release tag must start with media-archive- and contain only letters, digits, -, _, or .")
    output_dir = args.output_dir.resolve()
    if output_dir.is_relative_to(ROOT):
        raise ValueError("Archive output must be outside the repository")
    output_dir.mkdir(parents=True, exist_ok=True)
    bundles = {name: package_bundle(name, path, output_dir) for name, path in BUNDLE_ROOTS.items()}
    manifest: Manifest = {"schemaVersion": 1, "repository": REPOSITORY, "releaseTag": args.release_tag, "bundles": bundles}
    contents = json.dumps(manifest, indent=2) + "\n"
    (ROOT / "scripts/media/manifest.json").write_text(contents)
    (output_dir / "manifest.json").write_text(contents)
    print(f"Packaged {sum(len(bundle['files']) for bundle in bundles.values())} files in {len(bundles)} bundles: {output_dir}")


if __name__ == "__main__":
    main()
