"""Retire only the pinned unexecuted, empty first-batch preview."""

from __future__ import annotations

from collections import Counter
import hashlib
from importlib import import_module
import json
import os
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
POINTER = "monitoring-refactor/four-batches/current/66f20a7f1832e276ba437e3679dfb5fdb7853d38bdfab89d4313e8cb0f80043e.private.json"
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


def pointer(aws: migration.Aws, directory: Path) -> dict[str, Json]:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / "pointer.private.json"
    metadata = aws.call("file-publishing", "s3api", "get-object", [
        "--bucket", migration.BUCKET, "--key", POINTER, "--expected-bucket-owner", migration.ACCOUNT, str(path)])
    path.chmod(0o600)
    equal(json.loads(path.read_text()), {"source": STACK_IDS[CORE], "manifest": MANIFEST}, "exact old pointer body")
    equal(metadata.get("ServerSideEncryption"), "AES256", "pointer encryption")
    return {field: metadata[field] for field in ("ETag", "VersionId", "ServerSideEncryption")}


def snapshot(aws: migration.Aws, manifest: dict[str, Json], target_status: str, metadata: dict[str, Json]) -> dict[str, Json]:
    current = {name: stack(aws, name) for name in STACK_IDS}
    batches.prove_snapshot(aws, manifest, [], {CORE: current[CORE]})
    value: dict[str, Json] = {"binding": BINDING, "stacks": current, "pointer": metadata,
        "operation": aws.cf("describe-stack-refactor", ["--stack-refactor-id", PREVIEW]),
        "resourceStatuses": aws.cf("list-stack-resources", ["--stack-name", STACK_IDS[CORE]])["StackResourceSummaries"],
        "resources": migration.inventory(aws, STACK_IDS[CORE]), "targetResources": migration.inventory(aws, STACK_IDS[TARGET]),
        "legacy": migration.template(aws, STACK_IDS[CORE]), "settings": migration.stack_settings(current[CORE]),
        "runtime": migration.runtime(aws, obj(manifest["resources"], "original"), obj(manifest["legacy"], "legacy")),
        "tags": batches.alarm_tags(aws, obj(manifest["resources"], "original")),
        "provenance": {field: text(os.environ.get(variable), variable) for field, variable in
                       (("commit", "GITHUB_SHA"), ("runId", "GITHUB_RUN_ID"), ("runAttempt", "GITHUB_RUN_ATTEMPT"))}}
    validate_evidence(value, manifest, target_status)
    return value


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


def release_pointer(aws: migration.Aws, directory: Path) -> None:
    if POINTER not in batches.keys(aws, POINTER):
        return
    if batches.get(aws, directory, POINTER) != {"source": STACK_IDS[CORE], "manifest": MANIFEST}:
        batches.current_manifest(aws, directory, STACK_IDS[CORE])
        return
    metadata = pointer(aws, directory)
    equal(metadata, batches.get(aws, directory, ROOT + "/before.private.json")["pointer"], "original pointer version before release")
    aws.call("file-publishing", "s3api", "delete-object", ["--bucket", migration.BUCKET, "--key", POINTER,
        "--if-match", text(metadata.get("ETag"), "pointer ETag"), "--expected-bucket-owner", migration.ACCOUNT])
    equal(POINTER in batches.keys(aws, POINTER), False, "old pointer absent after conditional delete")


def pending_operations(aws: migration.Aws) -> None:
    relevant = migration.relevant_refactors(aws)
    equal(set(relevant), {PREVIEW, migration.REVIEWED_REFACTOR, migration.retry.RETRY_REFACTOR}, "only reviewed pending history")
    equal(migration.aborted_attempt(aws, relevant[migration.REVIEWED_REFACTOR]), True, "original retired")
    equal(migration.retry.aborted_attempt(aws, relevant[migration.retry.RETRY_REFACTOR]), True, "retry retired")
    operation(relevant[PREVIEW])


def reconcile(aws: migration.Aws, directory: Path) -> str:
    relevant = migration.relevant_refactors(aws)
    if PREVIEW not in relevant:
        return ""
    if not aborted_attempt(aws, relevant[PREVIEW]):
        pending_operations(aws)
        manifest = originals(aws, directory)
        metadata = pointer(aws, directory)
        state = text(stack(aws, TARGET).get("StackStatus"), "preview target state")
        if state not in ("REVIEW_IN_PROGRESS", "DELETE_IN_PROGRESS", "DELETE_COMPLETE"):
            raise ValueError(f"Unsupported empty preview target state: {state}")
        before_key, after_key = (f"{ROOT}/{phase}.private.json" for phase in ("before", "after"))
        if before_key not in batches.keys(aws, before_key):
            equal(state, "REVIEW_IN_PROGRESS", "interrupted deletion requires preserved before-evidence")
            batches.put(aws, directory, before_key, snapshot(aws, manifest, state, metadata))
        before = batches.get(aws, directory, before_key)
        validate_evidence(before, manifest, "REVIEW_IN_PROGRESS")
        equal(before["pointer"], metadata, "unchanged pointer before retirement")
        pending_operations(aws)
        snapshot(aws, manifest, state, metadata)
        if state == "REVIEW_IN_PROGRESS":
            aws.call("deploy", "cloudformation", "delete-stack", ["--stack-name", STACK_IDS[TARGET],
                "--role-arn", migration.CORE_EXECUTION_ROLE, "--deletion-mode", "STANDARD", "--client-request-token", "retire-" + PREVIEW])
        migration.wait_stack(aws, STACK_IDS[TARGET], "DELETE_COMPLETE")
        after = snapshot(aws, manifest, "DELETE_COMPLETE", pointer(aws, directory))
        pending_operations(aws)
        originals(aws, directory)
        if after_key not in batches.keys(aws, after_key):
            batches.put(aws, directory, after_key, after)
        after = batches.get(aws, directory, after_key)
        validate_evidence(after, manifest, "DELETE_COMPLETE")
        batches.put(aws, directory, RECEIPT, {**BINDING, "beforeHash": batches.digest(before),
                    "afterHash": batches.digest(after), "provenance": after["provenance"]})
    equal(aborted_attempt(aws, aws.cf("describe-stack-refactor", ["--stack-refactor-id", PREVIEW])), True, "verified preview retirement")
    release_pointer(aws, directory)
    return SCHEMA_ANCHOR["commit"]
