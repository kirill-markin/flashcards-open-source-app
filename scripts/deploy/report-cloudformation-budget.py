#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path
from typing import Iterator, cast

RESOURCE_LIMIT = 500
WARNING_THRESHOLD = 450


def require_object(value: object, location: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{location}: expected a JSON object")
    return cast(dict[str, object], value)


def require_string(value: object, location: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{location}: expected a non-empty string")
    return value


def read_object(path: Path) -> dict[str, object]:
    try:
        return require_object(json.loads(path.read_text(encoding="utf-8")), str(path))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{path}: cannot read assembly JSON: {error}") from error


def template_counts(
    path: Path, name: str, assembly: Path, ancestors: tuple[Path, ...],
) -> Iterator[tuple[str, Path, int]]:
    if path.resolve() in ancestors:
        raise ValueError(f"{path}: cyclic nested template reference")
    resources = require_object(read_object(path).get("Resources"), f"{path}: Resources")
    yield name, path, len(resources)
    for logical_id, value in resources.items():
        location = f"{path}: Resources.{logical_id}"
        resource = require_object(value, location)
        resource_type = require_string(resource.get("Type"), f"{location}.Type")
        if resource_type == "AWS::CloudFormation::Stack":
            metadata = require_object(resource.get("Metadata"), f"{location}.Metadata")
            # CDK writes nested templates as assets, not stack artifacts in manifest.json.
            nested_file = require_string(metadata.get("aws:asset:path"), f"{location}.Metadata.aws:asset:path")
            yield from template_counts(
                assembly / nested_file, f"{name}/{logical_id}", assembly, (*ancestors, path.resolve()),
            )


def assembly_counts(
    directory: Path, ancestors: tuple[Path, ...],
) -> Iterator[tuple[str, Path, int]]:
    manifest_path = directory / "manifest.json"
    if directory.resolve() in ancestors:
        raise ValueError(f"{manifest_path}: cyclic cloud assembly reference")
    artifacts = require_object(read_object(manifest_path).get("artifacts"), f"{manifest_path}: artifacts")
    for artifact_id, value in artifacts.items():
        location = f"{manifest_path}: artifacts.{artifact_id}"
        artifact = require_object(value, location)
        artifact_type = require_string(artifact.get("type"), f"{location}.type")
        if artifact_type not in ("aws:cloudformation:stack", "cdk:cloud-assembly"):
            continue
        properties = require_object(artifact.get("properties"), f"{location}.properties")
        if artifact_type == "cdk:cloud-assembly":
            nested_directory = require_string(properties.get("directoryName"), f"{location}.properties.directoryName")
            yield from assembly_counts(directory / nested_directory, (*ancestors, directory.resolve()))
        else:
            template = require_string(properties.get("templateFile"), f"{location}.properties.templateFile")
            name = require_string(properties.get("stackName", artifact_id), f"{location}.properties.stackName")
            yield from template_counts(directory / template, name, directory, ())


def main() -> None:
    parser = argparse.ArgumentParser(description="Report per-template CloudFormation resource headroom.")
    parser.add_argument("assembly", type=Path)
    args = parser.parse_args()
    counts = list(assembly_counts(args.assembly, ()))
    if not counts:
        raise ValueError(f"{args.assembly / 'manifest.json'}: no CloudFormation stack templates found")
    lines = [
        "## CloudFormation resource budget", "",
        "Each template has a 500-resource limit; warnings start at 450. Nested stacks use parent/logical ID.", "",
        "| Stack | Template | Resources | Remaining | Status |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    exceeded: list[str] = []
    for name, path, count in counts:
        remaining = RESOURCE_LIMIT - count
        status = "OVER LIMIT" if count > RESOURCE_LIMIT else "WARNING" if count >= WARNING_THRESHOLD else "OK"
        lines.append(f"| {name} | `{path}` | {count}/{RESOURCE_LIMIT} | {remaining} | {status} |")
        if count >= WARNING_THRESHOLD:
            level = "error" if count > RESOURCE_LIMIT else "warning"
            print(f"::{level}::{name} ({path}): {count}/{RESOURCE_LIMIT} resources, {remaining} remaining")
        if count > RESOURCE_LIMIT:
            exceeded.append(str(path))
    report = "\n".join(lines) + "\n"
    print(report)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path is not None:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write(report)
    if exceeded:
        raise ValueError(f"CloudFormation resource limit exceeded: {', '.join(exceeded)}")


if __name__ == "__main__":
    main()
