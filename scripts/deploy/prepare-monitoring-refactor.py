#!/usr/bin/env python3
"""Compare this repository's two monitoring topologies without modifying templates or AWS."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sys
from typing import TypeAlias

Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
CORE = "FlashcardsOpenSourceApp"
MONITORING = "FlashcardsOpenSourceAppMonitoring"
EXPECTED = {"AWS::CloudWatch::Alarm": 58, "AWS::Logs::MetricFilter": 8}


def object_value(value: Json, label: str) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}: expected an object")
    return value


def text_value(value: Json, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label}: expected a nonempty string")
    return value


def read_template(directory: Path, stack: str) -> dict[str, Json]:
    return object_value(json.loads((directory / f"{stack}.template.json").read_text()), stack)


def differences(before: Json, after: Json, path: str) -> list[str]:
    if isinstance(before, dict) and isinstance(after, dict):
        return [
            difference
            for key in sorted(before.keys() | after.keys())
            for difference in (
                [f"{path}/{key}"] if key not in before or key not in after
                else differences(before[key], after[key], f"{path}/{key}")
            )
        ]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [
            difference
            for index, (left, right) in enumerate(zip(before, after))
            for difference in differences(left, right, f"{path}/{index}")
        ]
    return [] if before == after else [path]


def require_equal(before: Json, after: Json, label: str) -> None:
    changed = differences(before, after, label)
    if changed:
        raise ValueError("Unexplained template delta at " + ", ".join(changed))


def require_resource_ids(
    expected: dict[str, Json], actual: dict[str, Json], label: str, message: str,
) -> None:
    missing = sorted(expected.keys() - actual.keys())
    extra = sorted(actual.keys() - expected.keys())
    if not missing and not extra:
        return
    diagnostics: Json = {
        "missing": [
            {"logicalId": key, "type": text_value(object_value(expected[key], key).get("Type"), key + "/Type")}
            for key in missing
        ],
        "extra": [
            {"logicalId": key, "type": text_value(object_value(actual[key], key).get("Type"), key + "/Type")}
            for key in extra
        ],
        "commonResourceChangedPaths": [
            path
            for key in sorted(expected.keys() & actual.keys())
            for path in differences(expected[key], actual[key], label + "/Resources/" + key)
        ],
    }
    raise ValueError(message + ": " + json.dumps(diagnostics, sort_keys=True))


def resource_path(resource: dict[str, Json], stack: str, logical_id: str) -> str:
    metadata = object_value(resource.get("Metadata", {}), logical_id)
    path = text_value(metadata.get("aws:cdk:path"), logical_id + "/aws:cdk:path")
    if not path.startswith(stack + "/"):
        raise ValueError(f"{logical_id}: construct path is outside expected stack")
    return path[len(stack) + 1:]


def without_path(resource: dict[str, Json]) -> dict[str, Json]:
    metadata = object_value(resource.get("Metadata", {}), "resource Metadata")
    return {
        **resource,
        "Metadata": {key: value for key, value in metadata.items() if key != "aws:cdk:path"},
    }


def core_reference(value: Json, resources: dict[str, Json]) -> bool:
    if not isinstance(value, dict):
        return False
    if set(value) == {"Ref"}:
        return isinstance(value["Ref"], str) and value["Ref"] in resources
    if set(value) == {"Fn::GetAtt"}:
        attribute = value["Fn::GetAtt"]
        return (isinstance(attribute, list) and len(attribute) == 2
                and isinstance(attribute[0], str) and attribute[0] in resources
                and isinstance(attribute[1], str))
    return False


def expand_imports(value: Json, exports: dict[str, Json]) -> Json:
    # Only the literal-name imports CDK emits for this same-environment boundary.
    if isinstance(value, dict):
        if "Fn::ImportValue" in value:
            name = value["Fn::ImportValue"]
            if set(value) != {"Fn::ImportValue"} or not isinstance(name, str) or name not in exports:
                raise ValueError("Unsupported or non-core Fn::ImportValue in monitoring template")
            return exports[name]
        return {key: expand_imports(child, exports) for key, child in value.items()}
    if isinstance(value, list):
        return [expand_imports(child, exports) for child in value]
    return value


def import_names(value: Json) -> set[str]:
    if isinstance(value, dict):
        if "Fn::ImportValue" in value:
            return {text_value(value["Fn::ImportValue"], "Fn::ImportValue")}
        return {name for child in value.values() for name in import_names(child)}
    if isinstance(value, list):
        return {name for child in value for name in import_names(child)}
    return set()


def metadata_resource(resource: Json, label: str) -> dict[str, Json]:
    item = object_value(resource, label)
    if item.get("Type") != "AWS::CDK::Metadata":
        raise ValueError(f"{label}: only CDKMetadata may be additional infrastructure")
    properties = object_value(item.get("Properties"), label + "/Properties")
    if set(properties) != {"Analytics"} or not isinstance(properties["Analytics"], str):
        raise ValueError(f"{label}: unexpected CDK metadata properties")
    return {**without_path(item), "Properties": {"Analytics": "classified CDK telemetry"}}


def compare(legacy: dict[str, Json], core: dict[str, Json], target: dict[str, Json]) -> dict[str, Json]:
    original = object_value(legacy.get("Resources"), "legacy/Resources")
    remaining = object_value(core.get("Resources"), "core/Resources")
    destination = object_value(target.get("Resources"), "monitoring/Resources")
    moved = {
        key: object_value(value, key) for key, value in original.items()
        if object_value(value, key).get("Type") in EXPECTED
    }
    counts = Counter(text_value(item.get("Type"), key) for key, item in moved.items())
    if dict(counts) != EXPECTED:
        raise ValueError(f"Expected 58 alarms and 8 filters; found {dict(counts)}")
    require_resource_ids(
        {key: value for key, value in original.items() if key not in moved}, remaining,
        "core", "Core resource ID set changed beyond the intended 66 moves",
    )
    require_resource_ids(
        dict(moved), {key: value for key, value in destination.items() if key != "CDKMetadata"},
        "monitoring", "Monitoring resource ID set differs from the intended 66 moves",
    )

    require_equal(
        {key: value for key, value in legacy.items() if key not in {"Resources", "Outputs"}},
        {key: value for key, value in core.items() if key not in {"Resources", "Outputs"}},
        "core/template",
    )
    allowed_target_keys = {"Resources", "Parameters", "Rules", "Conditions"}
    if set(target) - allowed_target_keys:
        raise ValueError("Unexpected monitoring template sections")
    target_parameters = object_value(target.get("Parameters", {}), "monitoring/Parameters")
    unexpected_parameters = sorted(target_parameters.keys() - {"BootstrapVersion"})
    if unexpected_parameters:
        raise ValueError("Unexpected monitoring parameters: " + ", ".join(unexpected_parameters))
    legacy_parameters = object_value(legacy.get("Parameters", {}), "legacy/Parameters")
    for key, value in target_parameters.items():
        if key not in legacy_parameters:
            raise ValueError("Missing legacy parameter definition: " + key)
        require_equal(legacy_parameters[key], value, "monitoring/Parameters/" + key)
    require_equal(legacy.get("Rules", {}), target.get("Rules", {}), "monitoring/Rules")
    target_conditions = object_value(target.get("Conditions", {}), "monitoring/Conditions")
    if set(target_conditions) - {"CDKMetadataAvailable"}:
        raise ValueError("Unexpected monitoring conditions")
    for key, value in target_conditions.items():
        require_equal(object_value(legacy.get("Conditions", {}), "legacy/Conditions").get(key),
                      value, "monitoring/Conditions/" + key)

    original_outputs = object_value(legacy.get("Outputs", {}), "legacy/Outputs")
    outputs = object_value(core.get("Outputs", {}), "core/Outputs")
    for key, value in original_outputs.items():
        require_equal(value, outputs.get(key), "core/Outputs/" + key)
    exports: dict[str, Json] = {}
    for key in sorted(outputs.keys() - original_outputs.keys()):
        output = object_value(outputs[key], key)
        if not key.startswith("ExportsOutput") or set(output) != {"Value", "Export"}:
            raise ValueError(f"{key}: unexpected added core output")
        name = text_value(object_value(output["Export"], key).get("Name"), key)
        if name in exports or not name.startswith(CORE + ":") or not core_reference(output["Value"], remaining):
            raise ValueError(f"{key}: export must uniquely reference a surviving core resource")
        exports[name] = output["Value"]
    if import_names(core):
        raise ValueError("Core imports are forbidden: possible reverse dependency")
    if import_names(target) != set(exports):
        raise ValueError("Monitoring imports and new core exports do not match exactly")

    for key, value in remaining.items():
        if key == "CDKMetadata":
            require_equal(metadata_resource(original[key], "legacy/CDKMetadata"),
                          metadata_resource(value, "core/CDKMetadata"), "core/CDKMetadata")
        else:
            require_equal(original[key], value, "core/Resources/" + key)
    if "CDKMetadata" in destination:
        require_equal(metadata_resource(original.get("CDKMetadata"), "legacy/CDKMetadata"),
                      metadata_resource(destination["CDKMetadata"], "monitoring/CDKMetadata"),
                      "monitoring/CDKMetadata")

    mappings: list[Json] = []
    resources: list[Json] = []
    for key, value in sorted(moved.items()):
        candidate = object_value(destination[key], key)
        require_equal(resource_path(value, CORE, key), resource_path(candidate, MONITORING, key), key + "/path")
        normalized = expand_imports(without_path(candidate), exports)
        require_equal(without_path(value), normalized, "monitoring/Resources/" + key)
        properties = object_value(value.get("Properties"), key + "/Properties")
        name_property = "AlarmName" if value["Type"] == "AWS::CloudWatch::Alarm" else "FilterName"
        resources.append({
            "logicalId": key, "type": value["Type"],
            "constructPath": resource_path(value, CORE, key),
            "name": properties.get(name_property, "CloudFormation-generated; server identity validation pending"),
            "changedReferencePaths": differences(without_path(value), without_path(candidate), key),
        })
        mappings.append({
            "Source": {"StackName": CORE, "LogicalResourceId": key},
            "Destination": {"StackName": MONITORING, "LogicalResourceId": key},
        })
    return {
        "status": "template-comparison-passed; AWS server eligibility pending",
        "counts": {"legacy": len(original), "core": len(remaining), "monitoring": len(destination), **dict(counts)},
        "classifiedDeltas": [
            "66 alarm/filter ownership and aws:cdk:path roots",
            "core resource exports and monitoring imports",
            "CDKMetadata Analytics telemetry and new target metadata resource when present",
            "new target BootstrapVersion definition and Rules identical to legacy when present",
        ],
        "exports": exports,
        "resources": resources,
        "resourceMappings": mappings,
    }


def write_private(path: Path, value: Json) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")
    path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-assembly", type=Path, required=True)
    parser.add_argument("--split-assembly", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args()
    args.output_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.output_directory.chmod(0o700)
    report = compare(read_template(args.legacy_assembly, CORE),
                     read_template(args.split_assembly, CORE),
                     read_template(args.split_assembly, MONITORING))
    write_private(args.output_directory / "evidence.private.json", report)
    write_private(args.output_directory / "resource-mappings.json", report["resourceMappings"])
    summary: Json = {"status": report["status"], "counts": report["counts"],
                     "classifiedDeltas": report["classifiedDeltas"]}
    write_private(args.output_directory / "summary.json", summary)
    print(json.dumps(summary))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"Monitoring comparison failed: {error}", file=sys.stderr)
        sys.exit(1)
