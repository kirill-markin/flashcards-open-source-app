"""Retire only the reviewed second failed monitoring move after full preservation proof."""

from __future__ import annotations

from collections import Counter
import hashlib
from importlib import import_module
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypeAlias

migration = import_module("migrate-monitoring-stack")
Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
RETRY_REFACTOR = "c0decc71-ab5a-4c77-89e1-d0afb7ab650f"
CORE, TARGET = "FlashcardsOpenSourceApp", "FlashcardsOpenSourceAppMonitoring"
ACCOUNT, REGION = "506210661494", "eu-central-1"
STACK_IDS = {
    CORE: f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{CORE}/436f3a30-19f9-11f1-b457-0a8d49e96987",
    TARGET: f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{TARGET}/46bd0490-be5b-11f1-b7ac-06ffd1f6d9f1",
}
EXECUTION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-{ACCOUNT}-{REGION}"
EVIDENCE = {
    "before.private.json": "0ca4239956ab94fc4e4ea75b4f3c2d195ec4ac6119e2833117dff152a7210bff",
    "operation.private.json": "12e14ec5a40b0ae93abc41e2c966114d2993872bbbae7bf3ce348e6763fc3ee8",
    "actions.private.json": "dd93c9b5c5c6b460456911aeb05140d95cc35fc3833c81e47e845eab27410eab",
}
SCHEMA_ANCHOR = {"commit": "e6f5555a5dba581fa8b215a88968ad5df3e36e8d", "runId": "37003818845", "runAttempt": "1"}
FAILURES_HASH = "252dbffda168fe74fcfd1d370f118f519be24630038b95497cdd31a220e76dbf"
ABORTED_KEY = f"monitoring-refactor/aborted/{RETRY_REFACTOR}.private.json"


def operation(status: dict[str, Json]) -> None:
    for key, expected in (("StackRefactorId", RETRY_REFACTOR), ("Status", "CREATE_COMPLETE"),
                          ("ExecutionStatus", "ROLLBACK_COMPLETE")):
        migration.equal(status.get(key), expected, f"retry operation/{key}")
    migration.equal(migration.refactor_stack_ids(status, STACK_IDS[CORE]), STACK_IDS, "retry stack IDs")


def stack(aws: migration.Aws, name: str) -> dict[str, Json]:
    found = migration.rows(aws.cf("describe-stacks", ["--stack-name", CORE if name == CORE else STACK_IDS[name]]).get("Stacks"), name)
    migration.equal(len(found), 1, f"retry {name}/count")
    for key, expected in (("StackId", STACK_IDS[name]), ("StackName", name)):
        migration.equal(found[0].get(key), expected, f"retry {name}/{key}")
    return found[0]


def receipt_fields() -> dict[str, Json]:
    return {"StackRefactorId": RETRY_REFACTOR, "StackIds": dict(STACK_IDS),
            "baselineHash": EVIDENCE["before.private.json"], "outcome": "EMPTY_TARGET_DELETED",
            "schemaAnchor": dict(SCHEMA_ANCHOR)}


def aborted_attempt(aws: migration.Aws, status: dict[str, Json]) -> bool:
    if status.get("StackRefactorId") != RETRY_REFACTOR:
        return False
    operation(status)
    listed = migration.rows(aws.call("file-publishing", "s3api", "list-objects-v2", [
        "--bucket", migration.BUCKET, "--prefix", ABORTED_KEY,
    ]).get("Contents", []), "retry aborted receipts")
    if not any(item.get("Key") == ABORTED_KEY for item in listed):
        return False
    with TemporaryDirectory(prefix="monitoring-retry-aborted-") as directory:
        path = Path(directory) / "aborted.private.json"
        aws.call("file-publishing", "s3api", "get-object", ["--bucket", migration.BUCKET, "--key", ABORTED_KEY, str(path)])
        receipt = migration.obj(json.loads(path.read_text()), "retry aborted receipt")
    for key, expected in receipt_fields().items():
        migration.equal(receipt.get(key), expected, f"retry aborted receipt/{key}")
    migration.text(receipt.get("preservationEvidence"), "retry preservation evidence")
    deleted = stack(aws, TARGET)
    migration.equal(deleted.get("StackStatus"), "DELETE_COMPLETE", "retry deleted target status")
    migration.equal(deleted.get("RoleARN"), EXECUTION_ROLE, "retry deleted target role")
    migration.equal(migration.inventory(aws, STACK_IDS[TARGET]), {}, "retry deleted target inventory")
    stack(aws, CORE)
    return True


def preservation(aws: migration.Aws, baseline: dict[str, Json], target_status: str) -> dict[str, Json]:
    status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", RETRY_REFACTOR])
    operation(status)
    original_stacks = migration.obj(baseline.get("stacks"), "retry original stacks")
    migration.equal(set(original_stacks), {CORE}, "retry original source-only snapshot")
    original = migration.obj(original_stacks[CORE], CORE)
    migration.equal(original.get("StackId"), STACK_IDS[CORE], "retry original source ID")
    migration.equal(original.get("RoleARN"), EXECUTION_ROLE, "retry original source role")
    before = migration.obj(baseline.get("resources"), "retry original resources")
    migration.equal(len(before), 497, "retry original resource count")
    current_stacks = {name: stack(aws, name) for name in STACK_IDS}
    migration.equal(current_stacks[CORE].get("StackStatus"), "UPDATE_ROLLBACK_COMPLETE", "retry source status")
    migration.equal(current_stacks[TARGET].get("StackStatus"), target_status, "retry target status")
    if target_status not in ("UPDATE_ROLLBACK_COMPLETE", "DELETE_IN_PROGRESS", "DELETE_COMPLETE"):
        raise ValueError(f"Retry target {STACK_IDS[TARGET]} has unsafe status {target_status}")
    migration.equal(current_stacks[TARGET].get("RoleARN"),
                    None if target_status == "UPDATE_ROLLBACK_COMPLETE" else EXECUTION_ROLE, "retry target role")
    migration.equal(migration.stack_settings(current_stacks[CORE]), migration.stack_settings(original), "retry source settings")
    resources = migration.rows(aws.cf("list-stack-resources", ["--stack-name", STACK_IDS[CORE]]).get("StackResourceSummaries"), "retry resource states")
    migration.equal(len(resources), 497, "retry live resource count")
    failures = [{key: item.get(key) for key in ("LogicalResourceId", "ResourceType", "ResourceStatus",
                "LastUpdatedTimestamp", "ResourceStatusReason")} for item in resources if item.get("ResourceStatus") == "UPDATE_FAILED"]
    migration.equal(len(failures), 22, "retry historical alarm failures")
    fingerprint = json.dumps(sorted(failures, key=lambda item: migration.text(item["LogicalResourceId"], "alarm ID")), sort_keys=True)
    migration.equal(hashlib.sha256(fingerprint.encode()).hexdigest(), FAILURES_HASH, "retry historical failure fingerprint")
    for resource in resources:
        if resource.get("ResourceStatus") == "UPDATE_FAILED":
            migration.equal(resource.get("ResourceType"), "AWS::CloudWatch::Alarm", "retry failed resource type")
        elif resource.get("ResourceStatus") not in ("CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"):
            raise ValueError(f"Retry unsafe resource: {json.dumps(resource)}")
    current = migration.inventory(aws, STACK_IDS[CORE])
    migration.equal(current, before, "retry all original identities")
    migration.equal(migration.inventory(aws, STACK_IDS[TARGET]), {}, "retry empty target")
    legacy = migration.template(aws, STACK_IDS[CORE])
    migration.equal(legacy, baseline.get("template"), "retry source template")
    configuration = migration.runtime(aws, current, legacy)
    migration.equal(configuration, baseline.get("runtime"), "retry alarm/filter/SNS configuration")
    return {"operation": status, "stacks": current_stacks, "resources": current,
            "resourceStatuses": resources, "template": legacy, "runtime": configuration}


def reconcile(aws: migration.Aws, directory: Path) -> str:
    relevant = migration.relevant_refactors(aws)
    if RETRY_REFACTOR not in relevant:
        return ""
    if aborted_attempt(aws, relevant[RETRY_REFACTOR]):
        return SCHEMA_ANCHOR["commit"]
    for refactor, details in relevant.items():
        if refactor == RETRY_REFACTOR or (refactor == migration.REVIEWED_REFACTOR and migration.aborted_attempt(aws, details)):
            continue
        migration.equal(details.get("ExecutionStatus"), "EXECUTE_COMPLETE", f"retry other operation/{refactor}")
        migration.read_verified_receipt(aws, refactor)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    evidence: dict[str, dict[str, Json]] = {}
    for name, digest in EVIDENCE.items():
        path = directory / name
        aws.call("file-publishing", "s3api", "get-object", [
            "--bucket", migration.BUCKET, "--key", f"monitoring-refactor/37003818845/1/{digest}/{name}", str(path),
        ])
        migration.equal(hashlib.sha256(path.read_bytes()).hexdigest(), digest, f"retry evidence hash/{name}")
        evidence[name] = migration.obj(json.loads(path.read_text()), name)
    migration.equal(evidence["operation.private.json"].get("StackRefactorId"), RETRY_REFACTOR, "retry private operation")
    baseline = evidence["before.private.json"]
    moved = migration.selected(migration.obj(baseline.get("resources"), "retry baseline resources"))
    migration.equal(dict(Counter(migration.obj(item, key)["ResourceType"] for key, item in moved.items())),
                    {"AWS::CloudWatch::Alarm": 58, "AWS::Logs::MetricFilter": 8}, "retry original selection")
    actions = aws.cf("list-stack-refactor-actions", ["--stack-refactor-id", RETRY_REFACTOR])
    migration.equal(actions, evidence["actions.private.json"], "retry exact original actions")
    migration.validate_actions(migration.rows(actions.get("StackRefactorActions"), "retry actions"),
                               relevant[RETRY_REFACTOR], STACK_IDS[CORE], moved)
    target_status = migration.text(stack(aws, TARGET).get("StackStatus"), "retry target status")
    before = preservation(aws, baseline, target_status)
    migration.save(aws, directory, "retry-abort-before.private.json", before)
    if target_status == "UPDATE_ROLLBACK_COMPLETE":
        aws.call("deploy", "cloudformation", "delete-stack", [
            "--stack-name", STACK_IDS[TARGET], "--role-arn", EXECUTION_ROLE,
        ])
    migration.wait_stack(aws, STACK_IDS[TARGET], "DELETE_COMPLETE")
    after = preservation(aws, baseline, "DELETE_COMPLETE")
    proof = migration.save(aws, directory, "retry-abort-after.private.json", after)
    path = directory / "aborted.private.json"
    migration.preparation.write_private(path, {**receipt_fields(), "preservationEvidence": proof})
    aws.call("file-publishing", "s3api", "put-object", [
        "--bucket", migration.BUCKET, "--key", ABORTED_KEY, "--body", str(path),
        "--server-side-encryption", "AES256", "--if-none-match", "*",
    ])
    migration.equal(aborted_attempt(aws, migration.obj(after["operation"], "retry final operation")), True, "retry retirement receipt")
    return SCHEMA_ANCHOR["commit"]
