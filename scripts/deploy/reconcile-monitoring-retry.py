"""Validate the immutable retirement receipt for the second failed monitoring move."""

from __future__ import annotations

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
