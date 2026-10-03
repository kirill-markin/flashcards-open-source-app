#!/usr/bin/env python3

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import cast


@dataclass(frozen=True)
class LambdaSourceMaps:
    release: str
    directory: Path


def require_object(value: object, location: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{location}: expected a JSON object")
    return cast(dict[str, object], value)


def require_string(value: object, location: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{location}: expected a non-empty string")
    return value


def read_object(path: Path) -> dict[str, object]:
    return require_object(json.loads(path.read_text(encoding="utf-8")), str(path))


def assembly_path(directory: Path, value: object, location: str) -> Path:
    path = (directory / require_string(value, location)).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise ValueError(f"{location}: path escapes the cloud assembly")
    return path


def emitted_source_maps(assembly: Path) -> list[LambdaSourceMaps]:
    manifest = read_object(assembly / "manifest.json")
    artifacts = require_object(manifest.get("artifacts"), "assembly artifacts")
    assets: dict[str, Path] = {}
    templates: list[Path] = []
    for artifact_id, value in artifacts.items():
        artifact = require_object(value, artifact_id)
        artifact_type = artifact.get("type")
        if artifact_type not in ("cdk:asset-manifest", "aws:cloudformation:stack"):
            continue
        properties = require_object(artifact.get("properties"), f"{artifact_id} properties")
        if artifact_type == "aws:cloudformation:stack":
            templates.append(assembly_path(assembly, properties.get("templateFile"), artifact_id))
            continue
        asset_manifest = assembly_path(assembly, properties.get("file"), artifact_id)
        files = require_object(read_object(asset_manifest).get("files"), f"{asset_manifest} files")
        for asset_id, file_value in files.items():
            asset = require_object(file_value, asset_id)
            source = require_object(asset.get("source"), f"{asset_id} source")
            if source.get("packaging") != "zip":
                continue
            directory = assembly_path(assembly, source.get("path"), asset_id)
            destinations = require_object(asset.get("destinations"), f"{asset_id} destinations")
            for destination_value in destinations.values():
                destination = require_object(destination_value, f"{asset_id} destination")
                key = require_string(destination.get("objectKey"), f"{asset_id} objectKey")
                if key in assets and assets[key] != directory:
                    raise ValueError(f"{key}: multiple emitted directories for one code asset")
                assets[key] = directory

    uploads: dict[str, LambdaSourceMaps] = {}
    for template in templates:
        resources = require_object(read_object(template).get("Resources"), f"{template} Resources")
        for logical_id, value in resources.items():
            resource = require_object(value, logical_id)
            if resource.get("Type") != "AWS::Lambda::Function":
                continue
            properties = require_object(resource.get("Properties"), f"{logical_id} Properties")
            environment = require_object(properties.get("Environment", {}), f"{logical_id} Environment")
            variables = require_object(environment.get("Variables", {}), f"{logical_id} Variables")
            if "SENTRY_RELEASE" not in variables:
                continue
            release = require_string(variables["SENTRY_RELEASE"], f"{logical_id} SENTRY_RELEASE")
            code = require_object(properties.get("Code"), f"{logical_id} Code")
            key = require_string(code.get("S3Key"), f"{logical_id} S3Key")
            match = re.search(r"(?:^|/)([a-f0-9]{64})\.zip$", key)
            if match is None or not re.fullmatch(r"lambda-[^@]+@" + match[1], release):
                raise ValueError(f"{logical_id}: Sentry release {release} does not match code asset {key}")
            if key not in assets:
                raise ValueError(f"{logical_id}: code asset {key} is absent from the emitted asset manifests")
            upload = LambdaSourceMaps(release, assets[key])
            if release in uploads and uploads[release] != upload:
                raise ValueError(f"{release}: multiple code assets for one Sentry release")
            uploads[release] = upload
    if not uploads:
        raise ValueError(f"{assembly}: no Lambda Sentry releases found in emitted stack templates")
    return sorted(uploads.values(), key=lambda upload: upload.release)


def verify_debug_id(upload: LambdaSourceMaps) -> None:
    source_map = read_object(upload.directory / "index.js.map")
    debug_id = require_string(source_map.get("debugId", source_map.get("debug_id")), f"{upload.release} debug ID")
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", debug_id):
        raise ValueError(f"{upload.release}: invalid source-map debug ID")
    code = (upload.directory / "index.js").read_text(encoding="utf-8")
    if re.search(r"(?m)^//# debugId=" + re.escape(debug_id) + r"\s*$", code) is None:
        raise ValueError(f"{upload.release}: emitted JavaScript and source map debug IDs do not match")


def upload_source_maps(cli: Path, upload: LambdaSourceMaps, org: str, project: str) -> None:
    command = [
        str(cli), "sourcemaps", "upload", "index.js", "index.js.map",
        "--org", org, "--project", project, "--release", upload.release,
        "--url-prefix", "/var/task", "--no-rewrite", "--strict", "--wait",
    ]
    for attempt in range(1, 4):
        try:
            subprocess.run(command, cwd=upload.directory, check=True)
            return
        except subprocess.CalledProcessError as error:
            if attempt == 3:
                raise RuntimeError(
                    f"Sentry upload failed for {upload.release} after {attempt} attempts, exit status {error.returncode}"
                ) from error
            print(
                f"WARNING: Sentry upload failed for {upload.release}, exit status {error.returncode}; retrying attempt {attempt + 1}/3",
                file=sys.stderr,
            )
            time.sleep(attempt + 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload maps from the deployed CDK cloud assembly.")
    parser.add_argument("assembly", type=Path)
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise ValueError("Lambda source maps may only be uploaded from GitHub Actions")
    for name in ("SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"):
        require_string(os.environ.get(name), name)
    cli = Path(__file__).resolve().parents[2] / "apps/backend/node_modules/.bin/sentry-cli"
    if not cli.is_file() or not os.access(cli, os.X_OK):
        raise ValueError(f"Sentry CLI is not executable at {cli}; install apps/backend dependencies first")
    uploads = emitted_source_maps(args.assembly.resolve())
    for upload in uploads:
        verify_debug_id(upload)
    for upload in uploads:
        print(f"Uploading emitted Lambda source maps: {upload.release}", flush=True)
        upload_source_maps(cli, upload, os.environ["SENTRY_ORG"], os.environ["SENTRY_PROJECT"])
    print(f"Uploaded source maps for {len(uploads)} deployed Lambda releases")


if __name__ == "__main__":
    main()
