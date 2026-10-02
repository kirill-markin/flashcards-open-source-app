#!/usr/bin/env python3
"""Read-only release gate for the completed monitoring ownership split."""

import argparse
from importlib import import_module
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from typing import TypeAlias

preparation = import_module("prepare-monitoring-refactor")
batches = import_module("monitoring-refactor-batches")
retry = import_module("reconcile-monitoring-retry")
preview = import_module("reconcile-monitoring-preview")
Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
CORE = "FlashcardsOpenSourceApp"
TARGET = CORE + "Monitoring"
ACCOUNT = "506210661494"
REGION = "eu-central-1"
BUCKET = f"cdk-hnb659fds-assets-{ACCOUNT}-{REGION}"
EXPECTED = {"AWS::CloudWatch::Alarm": 58, "AWS::Logs::MetricFilter": 8}
REVIEWED_REFACTOR = "b25a93ec-bef4-4f12-9083-bdb41e4a5af3"
STABLE = ("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE")
CORE_EXECUTION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-{ACCOUNT}-{REGION}"
REVIEWED_STACKS = {
    CORE: f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{CORE}/436f3a30-19f9-11f1-b457-0a8d49e96987",
    TARGET: f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{TARGET}/ea541f40-b9a5-11f1-bcb5-020e36761ac3",
}
REVIEWED_EVIDENCE = {
    "operation.private.json": "0dbd4cef8673d0781b6c3379faa107b8eb2fac4891a0fa208b49cf1bdb43c484",
    "before.private.json": "1010627950fc74ff0ff6fbb20a575a3c5cfdf5b69aef506f13da0af9ccb0c47a",
    "actions.private.json": "82ba16ba8acbeee898a16f2e1afe045f415d678f400827dfd07c59c7cfa73513",
}
# Pins the 22 historical alarm failures, including IDs, types, statuses, timestamps and reasons.
REVIEWED_ALARM_FAILURES_HASH = "252dbffda168fe74fcfd1d370f118f519be24630038b95497cdd31a220e76dbf"
REVIEWED_SCHEMA_ANCHOR = {
    "commit": "968ad3a0f06f010ba6a3b51681c2fc145c8965fc",
    "runId": "36241107324", "runAttempt": "1",
}
obj = preparation.object_value
text = preparation.text_value
equal = preparation.require_equal


def rows(value: Json, label: str) -> list[dict[str, Json]]:
    if not isinstance(value, list):
        raise ValueError(f"{label}: expected a list")
    return [obj(item, label) for item in value]


class Aws:
    def __init__(self) -> None:
        self.original = dict(os.environ, AWS_RETRY_MODE="standard", AWS_MAX_ATTEMPTS="4")
        self.environments: dict[str, dict[str, str]] = {"original": self.original}
        equal(self.call("original", "sts", "get-caller-identity", []).get("Account"), ACCOUNT, "AWS account")
        for purpose in ("lookup", "file-publishing"):
            credentials = obj(self.call("original", "sts", "assume-role", [
                "--role-arn", f"arn:aws:iam::{ACCOUNT}:role/cdk-hnb659fds-{purpose}-role-{ACCOUNT}-{REGION}",
                "--role-session-name", "monitoring-ownership", "--duration-seconds", "3600",
            ]).get("Credentials"), "AssumeRole/Credentials")
            self.environments[purpose] = dict(self.original, **{
                key: text(credentials[field], field) for key, field in (
                    ("AWS_ACCESS_KEY_ID", "AccessKeyId"), ("AWS_SECRET_ACCESS_KEY", "SecretAccessKey"),
                    ("AWS_SESSION_TOKEN", "SessionToken"),
                )
            })

    def call(self, role: str, service: str, operation: str, arguments: list[str]) -> dict[str, Json]:
        result = subprocess.run(["aws", service, operation, "--region", REGION, "--output", "json",
                                 "--no-cli-pager", *arguments], env=self.environments[role],
                                capture_output=True, text=True, check=False)
        if result.returncode:
            raise RuntimeError(f"AWS {service}/{operation} failed: {result.stderr.strip()}")
        return obj(json.loads(result.stdout), operation)

    def cf(self, operation: str, arguments: list[str]) -> dict[str, Json]:
        return self.call("lookup", "cloudformation", operation, arguments)


def inventory(aws: Aws, stack: str) -> dict[str, Json]:
    return {text(item.get("LogicalResourceId"), "LogicalResourceId"):
            {key: item[key] for key in ("PhysicalResourceId", "ResourceType")}
            for item in rows(aws.cf("list-stack-resources", ["--stack-name", stack]).get("StackResourceSummaries"), stack)}


def stacks(aws: Aws) -> dict[str, Json]:
    found = {text(item.get("StackName"), "StackName"): item
             for item in rows(aws.cf("describe-stacks", []).get("Stacks"), "Stacks")
             if item.get("StackName") in (CORE, TARGET)}
    for name, item in found.items():
        if item.get("StackStatus") not in STABLE:
            raise ValueError(f"{name}: unstable stack {item.get('StackStatus')}; inspect before continuing")
    return found


def selected(resources: dict[str, Json]) -> dict[str, Json]:
    return {key: item for key, item in resources.items() if obj(item, key).get("ResourceType") in EXPECTED}


def relevant_refactors(aws: Aws) -> dict[str, dict[str, Json]]:
    relevant: dict[str, dict[str, Json]] = {}
    for summary in rows(aws.cf("list-stack-refactors", ["--execution-status-filter",
        "UNAVAILABLE", "AVAILABLE", "OBSOLETE", "EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE",
        "EXECUTE_FAILED", "ROLLBACK_IN_PROGRESS", "ROLLBACK_COMPLETE", "ROLLBACK_FAILED",
    ]).get("StackRefactorSummaries"), "refactors"):
        refactor = text(summary.get("StackRefactorId"), "StackRefactorId")
        details = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
        equal(details.get("StackRefactorId"), refactor, "listed refactor identity")
        ids = details.get("StackIds")
        if not isinstance(ids, list):
            raise ValueError(f"{refactor}: missing StackIds; inspect operation")
        if any(isinstance(item, str) and any(f":stack/{name}/" in item for name in (CORE, TARGET)) for item in ids):
            relevant[refactor] = details
    return relevant


def retired_refactors(aws: Aws) -> set[str]:
    relevant = relevant_refactors(aws)
    return {refactor for refactor, validator in (
        (REVIEWED_REFACTOR, aborted_attempt), (retry.RETRY_REFACTOR, retry.aborted_attempt),
        (preview.PREVIEW, preview.aborted_attempt),
    ) if refactor in relevant and validator(aws, relevant[refactor])}


def ownership(aws: Aws) -> str:
    current = stacks(aws)
    relevant = relevant_refactors(aws)
    if not current:
        if relevant:
            raise ValueError("Monitoring operations exist without managed stacks; preserve evidence and stop")
        return "fresh"
    if set(current) != {CORE, TARGET}:
        raise ValueError("Both completed split stacks are required; legacy or partial ownership blocks releases")
    retired = retired_refactors(aws)
    equal(retired, {REVIEWED_REFACTOR, retry.RETRY_REFACTOR, preview.PREVIEW},
          "all three historical attempts must have verified retirement evidence")
    source = text(obj(current[CORE], CORE)["StackId"], "source ID")
    with TemporaryDirectory(prefix="monitoring-ownership-") as directory:
        key = batches.current_manifest(aws, Path(directory), source)
        if key is None:
            raise ValueError("Completed monitoring split has no bound manifest; preserve evidence and stop")
        manifest, receipts = batches.verified_prefix(aws, Path(directory), key, retired)
        if len(receipts) != 4:
            raise ValueError("Monitoring migration is incomplete; ordinary releases cannot resume it")
        batches.final_ownership(aws, manifest, receipts)
    return "split"


def refactor_stack_ids(status: dict[str, Json], source: str) -> dict[str, str]:
    ids = status.get("StackIds")
    if not isinstance(ids, list) or len(ids) != 2 or source not in ids:
        raise ValueError("Preview must contain only the two intended stacks")
    targets = [item for item in ids if isinstance(item, str) and item.startswith(f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{TARGET}/")]
    if len(targets) != 1:
        raise ValueError("Preview target stack identity is not authoritative")
    return {CORE: source, TARGET: targets[0]}


def validate_actions(actions: list[dict[str, Json]], status: dict[str, Json], source: str, resources: dict[str, Json]) -> None:
    target = refactor_stack_ids(status, source)[TARGET]
    moves: dict[str, Json] = {}
    creates = 0
    for action in actions:
        if action.get("Entity") == "STACK" and action.get("Action") == "CREATE":
            if action.get("PhysicalResourceId") not in (None, TARGET, target):
                raise ValueError("Unexpected STACK/CREATE identity")
            if action.get("TagResources") or action.get("UntagResources"):
                raise ValueError("Unexpected STACK/CREATE tags")
            creates += 1
            continue
        if action.get("Entity") != "RESOURCE" or action.get("Action") != "MOVE":
            raise ValueError("Preview includes an action other than the approved monitoring moves")
        mapping = obj(action.get("ResourceMapping"), "ResourceMapping")
        before, after = obj(mapping.get("Source"), "Source"), obj(mapping.get("Destination"), "Destination")
        key = text(before.get("LogicalResourceId"), "LogicalResourceId")
        if before.get("StackName") not in (CORE, source) or after.get("StackName") not in (TARGET, target) or after.get("LogicalResourceId") != key or key in moves or key not in resources:
            raise ValueError(f"{key}: unexpected or duplicate server mapping")
        equal(action.get("PhysicalResourceId"), obj(resources[key], key)["PhysicalResourceId"], key + "/physical ID")
        if action.get("ResourceType") is not None:
            equal(action["ResourceType"], obj(resources[key], key)["ResourceType"], key + "/type")
        tags = {"aws:cloudformation:stack-name": TARGET, "aws:cloudformation:stack-id": target, "aws:cloudformation:logical-id": key}
        for tag in rows(action.get("TagResources", []), "TagResources"):
            if tag.get("Key") not in tags or tag.get("Value") != tags[tag["Key"]]:
                raise ValueError(f"{key}: unexpected resource tag change")
        removed = action.get("UntagResources", [])
        if not isinstance(removed, list) or any(tag not in tags for tag in removed):
            raise ValueError(f"{key}: unexpected removed tag")
        moves[key] = resources[key]
    equal(moves, resources, "exact server moves")
    if creates > 1:
        raise ValueError("Duplicate target STACK/CREATE")


def stack_settings(stack: dict[str, Json]) -> dict[str, Json]:
    return {
        "Outputs": {text(row.get("OutputKey"), "OutputKey"):
                    {key: value for key, value in row.items() if key != "Description"}
                    for row in rows(stack.get("Outputs", []), "Outputs")},
        "Parameters": {text(row.get("ParameterKey"), "ParameterKey"): row
                       for row in rows(stack.get("Parameters", []), "Parameters")},
        "Tags": {text(row.get("Key"), "tag key"): row.get("Value")
                 for row in rows(stack.get("Tags", []), "Tags")},
        "RoleARN": stack.get("RoleARN"),
    }


def deleted_stack(aws: Aws, stack_id: str) -> dict[str, Json]:
    found = rows(aws.cf("describe-stacks", ["--stack-name", stack_id]).get("Stacks"), stack_id)
    equal(len(found), 1, "deleted stack count")
    equal(found[0].get("StackId"), stack_id, "deleted stack identity")
    equal(found[0].get("StackStatus"), "DELETE_COMPLETE", "historical target retirement")
    return found[0]


def aborted_key() -> str:
    return f"monitoring-refactor/aborted/{REVIEWED_REFACTOR}.private.json"


def aborted_attempt(aws: Aws, status: dict[str, Json]) -> bool:
    listed = rows(aws.call("file-publishing", "s3api", "list-objects-v2", [
        "--bucket", BUCKET, "--prefix", aborted_key(),
    ]).get("Contents", []), "aborted receipts")
    if not any(item.get("Key") == aborted_key() for item in listed):
        return False
    with TemporaryDirectory(prefix="monitoring-aborted-") as directory:
        path = Path(directory) / "aborted.private.json"
        aws.call("file-publishing", "s3api", "get-object", [
            "--bucket", BUCKET, "--key", aborted_key(), str(path),
        ])
        receipt = obj(json.loads(path.read_text()), "aborted receipt")
    for key, expected in (("StackRefactorId", REVIEWED_REFACTOR), ("StackIds", REVIEWED_STACKS),
                          ("baselineHash", REVIEWED_EVIDENCE["before.private.json"]),
                          ("outcome", "EMPTY_TARGET_DELETED"), ("schemaAnchor", REVIEWED_SCHEMA_ANCHOR)):
        equal(receipt.get(key), expected, f"aborted receipt/{key}")
    text(receipt.get("preservationEvidence"), "aborted preservation evidence")
    equal(status.get("ExecutionStatus"), "ROLLBACK_FAILED", "aborted native status")
    equal(refactor_stack_ids(status, REVIEWED_STACKS[CORE]), REVIEWED_STACKS, "aborted operation stack IDs")
    deleted = deleted_stack(aws, REVIEWED_STACKS[TARGET])
    equal(deleted.get("StackName"), TARGET, "deleted target name")
    equal(inventory(aws, REVIEWED_STACKS[TARGET]), {}, "deleted target resources")
    source = rows(aws.cf("describe-stacks", ["--stack-name", CORE]).get("Stacks"), CORE)
    equal(len(source), 1, "retired attempt source count")
    equal(source[0].get("StackId"), REVIEWED_STACKS[CORE], "retired attempt source identity")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ownership",))
    parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("AWS_REGION") != REGION:
        raise ValueError("Run only in the serialized eu-central-1 GitHub release job")
    os.umask(0o077)
    print(json.dumps({"monitoringOwnership": ownership(Aws())}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        print(f"Monitoring ownership verification failed: {error}", file=sys.stderr)
        sys.exit(1)
