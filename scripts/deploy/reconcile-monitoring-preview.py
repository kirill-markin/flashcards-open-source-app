"""Validate immutable retirement evidence for the unexecuted first-batch preview."""

from __future__ import annotations

from collections import Counter
import hashlib
from importlib import import_module
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypeAlias

migration = import_module("migrate-monitoring-stack")
batches = import_module("monitoring-refactor-batches")
preparation = import_module("prepare-monitoring-refactor")
Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
obj, text, equal = preparation.object_value, preparation.text_value, preparation.require_equal
CORE, TARGET = "FlashcardsOpenSourceApp", "FlashcardsOpenSourceAppMonitoring"
PREVIEW = "ce6b1fc2-d852-4e99-86d4-1c602f59cb60"
STACK_IDS = {
    CORE: "arn:aws:cloudformation:eu-central-1:506210661494:stack/FlashcardsOpenSourceApp/436f3a30-19f9-11f1-b457-0a8d49e96987",
    TARGET: "arn:aws:cloudformation:eu-central-1:506210661494:stack/FlashcardsOpenSourceAppMonitoring/8121d610-be9c-11f1-be4e-0ac7921eea8d",
}
MANIFEST_HASH = "1188f7b2ed2eb7dd9e7cb0501e6662f6b69a7464af874df415e4f5e02f5afbc0"
MANIFEST = f"monitoring-refactor/four-batches/manifests/{MANIFEST_HASH}.private.json"
JOURNAL_HASH = "7f7ed595e83635fa121508f7296aa023f4d93ed335ab3b54d30f2361e5c2db5c"
ACTIONS_HASH = "139c0bdb63dd077ae1ad78e9ab2be504e64d3648c3ae1101f24d64604c1563e5"
SCHEMA_ANCHOR = {"commit": "5b09625b443307d7ac047faf29375d5dcaa794c6", "runId": "37055002073", "runAttempt": "1"}
ROOT = f"monitoring-refactor/aborted/{PREVIEW}"
RECEIPT = ROOT + ".private.json"
BINDING = {"StackRefactorId": PREVIEW, "StackIds": STACK_IDS, "manifest": MANIFEST, "manifestHash": MANIFEST_HASH,
           "operationHash": JOURNAL_HASH, "actionsHash": ACTIONS_HASH, "schemaAnchor": SCHEMA_ANCHOR,
           "outcome": "UNEXECUTED_EMPTY_PREVIEW_DELETED"}


def operation(status: dict[str, Json]) -> None:
    equal(status.get("StackRefactorId"), PREVIEW, "preview ID")
    equal(status.get("Status"), "CREATE_COMPLETE", "preview creation")
    equal(migration.refactor_stack_ids(status, STACK_IDS[CORE]), STACK_IDS, "preview stack IDs")
    if status.get("ExecutionStatus") not in ("AVAILABLE", "OBSOLETE"):
        raise ValueError(f"Preview must remain unexecuted: {json.dumps(status)}")


def stack(aws: migration.Aws, name: str) -> dict[str, Json]:
    found = migration.rows(aws.cf("describe-stacks", ["--stack-name", CORE if name == CORE else STACK_IDS[name]]).get("Stacks"), name)
    equal(len(found), 1, name + "/count")
    equal([found[0].get("StackId"), found[0].get("StackName")], [STACK_IDS[name], name], name + "/identity")
    return found[0]


def originals(aws: migration.Aws, directory: Path) -> dict[str, Json]:
    manifest = batches.get(aws, directory, MANIFEST)
    equal(batches.digest(manifest), MANIFEST_HASH, "preview manifest hash")
    equal([manifest.get("source"), manifest.get("commit"), manifest.get("run"), manifest.get("attempt")],
          [STACK_IDS[CORE], SCHEMA_ANCHOR["commit"], SCHEMA_ANCHOR["runId"], SCHEMA_ANCHOR["runAttempt"]], "preview provenance")
    equal(len(obj(manifest["resources"], "original resources")), 497, "original count")
    equal(manifest["batches"], batches.memberships(migration.selected(obj(manifest["resources"], "original resources"))), "original batches")
    base = batches.operation_prefix(manifest)
    equal(batches.keys(aws, base + "/operations/"), {base + "/operations/1.private.json"}, "only first preview journal")
    equal(batches.keys(aws, base + "/receipts/"), set(), "no executed batch receipts")
    journal = batches.get(aws, directory, base + "/operations/1.private.json")
    equal(batches.digest(journal), JOURNAL_HASH, "preview journal hash")
    for field, expected in (("StackRefactorId", PREVIEW), ("manifest", MANIFEST), ("index", 1), ("previous", None),
                            ("request", batches.request(manifest, 1)), ("requestHash", batches.digest(batches.request(manifest, 1))),
                            ("templateHash", batches.digest(batches.templates(manifest, 1))), ("mappingHash", batches.digest(batches.mappings(manifest, 1)))):
        equal(journal.get(field), expected, "preview journal/" + field)
    for name, value in batches.templates(manifest, 1).items():
        equal(batches.get(aws, directory, f"{base}/templates/1-{name}-{batches.digest(value)}.private.json"), value, "submitted first template")
    actions = batches.get(aws, directory, base + f"/actions/{batches.digest(PREVIEW)}.private.json")
    equal(batches.digest(actions), ACTIONS_HASH, "original actions hash")
    equal(aws.cf("list-stack-refactor-actions", ["--stack-refactor-id", PREVIEW]), actions, "live exact preview actions")
    status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", PREVIEW])
    operation(status)
    migration.validate_actions(migration.rows(actions.get("StackRefactorActions"), "preview actions"), status, STACK_IDS[CORE], batches.cumulative(manifest, 1))
    return manifest


def validate_evidence(value: dict[str, Json], manifest: dict[str, Json], target_status: str) -> None:
    equal(value.get("binding"), BINDING, "preservation binding")
    if target_status == "REVIEW_IN_PROGRESS":
        equal(obj(value.get("operation"), "preserved preview").get("ExecutionStatus"), "AVAILABLE", "unexecuted before-evidence")
    operation(obj(value.get("operation"), "preserved operation"))
    for name, state in ((CORE, "UPDATE_COMPLETE"), (TARGET, target_status)):
        saved = obj(obj(value["stacks"], "preserved stacks")[name], name)
        equal([saved.get("StackId"), saved.get("StackName"), saved.get("StackStatus")], [STACK_IDS[name], name, state], name + "/preserved stack")
        equal(saved.get("RoleARN"), None if name == TARGET and state == "REVIEW_IN_PROGRESS" else migration.CORE_EXECUTION_ROLE, name + "/preserved role")
    equal(migration.stack_settings(obj(obj(value["stacks"], "stacks")[CORE], CORE)), manifest["settings"], "preserved stack settings")
    for field in ("resources", "legacy", "settings", "runtime", "tags"):
        equal(value.get(field), manifest[field], "preserved original/" + field)
    equal(value.get("targetResources"), {}, "preserved empty target")
    resources = migration.rows(value.get("resourceStatuses"), "preserved resource states")
    equal(dict(Counter(item.get("ResourceStatus") for item in resources)),
          {"CREATE_COMPLETE": 325, "UPDATE_COMPLETE": 150, "UPDATE_FAILED": 22}, "exact stable/historical states")
    equal({text(item.get("LogicalResourceId"), "resource ID"): {key: item[key] for key in ("PhysicalResourceId", "ResourceType")}
           for item in resources}, manifest["resources"], "resource status identities")
    failures = [{key: item.get(key) for key in ("LogicalResourceId", "ResourceType", "ResourceStatus", "LastUpdatedTimestamp", "ResourceStatusReason")}
                for item in resources if item.get("ResourceStatus") == "UPDATE_FAILED"]
    fingerprint = json.dumps(sorted(failures, key=lambda item: text(item["LogicalResourceId"], "alarm ID")), sort_keys=True)
    equal(hashlib.sha256(fingerprint.encode()).hexdigest(), migration.REVIEWED_ALARM_FAILURES_HASH, "exact historical failures")
    for field in ("commit", "runId", "runAttempt"):
        text(obj(value.get("provenance"), "preservation CI provenance").get(field), field)
    metadata = obj(value.get("pointer"), "preserved pointer")
    equal(metadata.get("ServerSideEncryption"), "AES256", "preserved pointer encryption")
    for field in ("ETag", "VersionId"):
        text(metadata.get(field), "preserved pointer/" + field)


def aborted_attempt(aws: migration.Aws, status: dict[str, Json]) -> bool:
    if status.get("StackRefactorId") != PREVIEW or RECEIPT not in batches.keys(aws, RECEIPT):
        return False
    operation(status)
    with TemporaryDirectory(prefix="monitoring-preview-retired-") as directory:
        path = Path(directory)
        manifest = originals(aws, path)
        receipt = batches.get(aws, path, RECEIPT)
        evidence = {phase: batches.get(aws, path, f"{ROOT}/{phase}.private.json") for phase in ("before", "after")}
        for phase, state in (("before", "REVIEW_IN_PROGRESS"), ("after", "DELETE_COMPLETE")):
            validate_evidence(evidence[phase], manifest, state)
        equal(evidence["before"]["pointer"], evidence["after"]["pointer"], "preserved pointer version")
        equal(receipt, {**BINDING, **{phase + "Hash": batches.digest(value) for phase, value in evidence.items()},
                        "provenance": evidence["after"]["provenance"]}, "exact content-bound aborted receipt")
    deleted = stack(aws, TARGET)
    equal([deleted.get("StackStatus"), deleted.get("RoleARN")], ["DELETE_COMPLETE", migration.CORE_EXECUTION_ROLE], "deleted preview")
    equal(migration.inventory(aws, STACK_IDS[TARGET]), {}, "deleted preview inventory")
    stack(aws, CORE)
    return True
