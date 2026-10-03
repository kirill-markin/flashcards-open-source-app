#!/usr/bin/env python3
"""Asset-only cache: validate before reuse, retain only final assembly references."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat

SCHEMA = 1
ASSET_NAME = re.compile(r"asset\.[a-f0-9]{64}")
REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / ".cache/lambda-assets/v1"


def read_manifest(file: Path) -> dict[str, str]:
    data = json.loads(file.read_text())
    if not isinstance(data, dict) or data.get("schema") != SCHEMA or not isinstance(data.get("assets"), dict):
        raise ValueError(f"Invalid Lambda cache manifest: {file}")
    assets = data["assets"]
    for name, digest in assets.items():
        if not ASSET_NAME.fullmatch(name) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError(f"Invalid Lambda cache asset identity: {file}: {name}")
    return assets


def write_manifest(file: Path, assets: dict[str, str]) -> None:
    temporary = file.with_suffix(".tmp")
    temporary.write_text(json.dumps({"schema": SCHEMA, "assets": assets}, sort_keys=True))
    temporary.replace(file)


def asset_digest(directory: Path) -> str:
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError(f"Lambda cache asset must be a directory: {directory}")
    for required in ("index.js", "index.js.map"):
        file = directory / required
        if not file.is_file() or file.is_symlink() or file.stat().st_size == 0:
            raise ValueError(f"Incomplete Lambda cache asset: {file}")
    digest = hashlib.sha256()
    for file in sorted(directory.rglob("*")):
        relative = file.relative_to(directory).as_posix()
        mode = file.lstat().st_mode
        if stat.S_ISLNK(mode):
            target = os.readlink(file)
            if os.path.isabs(target) or not file.resolve().is_relative_to(directory.resolve()) or not file.exists():
                raise ValueError(f"Unsafe or broken Lambda asset symlink: {file}")
            content = target
            kind = "symlink"
        elif stat.S_ISREG(mode):
            content = hashlib.sha256(file.read_bytes()).hexdigest()
            kind = "file"
        elif stat.S_ISDIR(mode):
            content = ""
            kind = "directory"
        else:
            raise ValueError(f"Unsupported Lambda asset file type: {file}")
        digest.update(json.dumps([relative, kind, stat.S_IMODE(mode), content], separators=(",", ":")).encode())
    return digest.hexdigest()


def restore(outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)
    # CDK trusts any existing asset directory. Never let stale/partial staging
    # bypass the integrity check, including output from an interrupted synth.
    for file in outdir.iterdir():
        if file.name.startswith("asset.") or file.name.startswith("bundling-temp-"):
            if file.is_dir() and not file.is_symlink():
                shutil.rmtree(file)
            else:
                file.unlink()
    references = outdir / "lambda-cache-references"
    if references.exists():
        shutil.rmtree(references)
    verified: dict[str, str] = {}
    if CACHE.exists():
        manifest = read_manifest(CACHE / "manifest.json")
        for name, expected in manifest.items():
            source = CACHE / name
            if asset_digest(source) != expected:
                raise ValueError(f"Corrupt Lambda cache asset; delete the CI cache and rerun: {name}")
            shutil.copytree(source, outdir / name, symlinks=True)
            verified[name] = expected
    write_manifest(outdir / "lambda-cache-integrity.json", verified)
    print(json.dumps({"event": "lambda_cache_restore", "assets": len(verified)}))


def verify(outdir: Path, asset: str, result: str) -> None:
    if not ASSET_NAME.fullmatch(asset):
        raise ValueError(f"Invalid Lambda asset name: {asset}")
    file = outdir / "lambda-cache-integrity.json"
    manifest = read_manifest(file) if file.exists() else {}
    actual = asset_digest(outdir / asset)
    if result == "reused" and manifest.get(asset) != actual:
        raise ValueError(f"Unverified or corrupt staged Lambda asset: {asset}; run cache restore before synthesis")
    manifest[asset] = actual
    write_manifest(file, manifest)


def save(outdir: Path) -> None:
    integrity = read_manifest(outdir / "lambda-cache-integrity.json")
    references = outdir / "lambda-cache-references"
    # Asset manifests are read privately, never copied into the cache.
    referenced_paths: set[str] = set()
    for file in outdir.glob("*.assets.json"):
        data = json.loads(file.read_text())
        for entry in data.get("files", {}).values():
            source = entry["source"].get("path")
            if isinstance(source, str):
                referenced_paths.add(source)
    assets: dict[str, str] = {}
    for file in references.glob("*.json"):
        data = json.loads(file.read_text())
        asset = data["asset"]
        if data.get("schema") != SCHEMA or not ASSET_NAME.fullmatch(asset):
            raise ValueError(f"Invalid Lambda cache reference: {file}")
        if asset not in referenced_paths:
            continue
        actual = asset_digest(outdir / asset)
        if integrity.get(asset) != actual:
            raise ValueError(f"Lambda asset changed after bundling: {asset}")
        assets[asset] = actual
    if not assets:
        raise ValueError(f"No Lambda assets referenced by final assembly: {outdir}")
    temporary = CACHE.with_name("v1-saving")
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(parents=True)
    for asset in assets:
        shutil.copytree(outdir / asset, temporary / asset, symlinks=True)
    write_manifest(temporary / "manifest.json", assets)
    if CACHE.exists():
        shutil.rmtree(CACHE)
    temporary.replace(CACHE)
    print(json.dumps({"event": "lambda_cache_save", "assets": len(assets)}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("restore", "verify", "save"))
    parser.add_argument("outdir", type=Path)
    parser.add_argument("asset", nargs="?")
    parser.add_argument("result", nargs="?", choices=("built", "reused"))
    args = parser.parse_args()
    if args.operation == "restore":
        restore(args.outdir)
    elif args.operation == "save":
        save(args.outdir)
    elif args.asset is None or args.result is None:
        parser.error("verify requires an asset name and built/reused result")
    else:
        verify(args.outdir, args.asset, args.result)


if __name__ == "__main__":
    main()
