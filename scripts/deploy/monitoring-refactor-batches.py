"""Read-only verification of the immutable four-batch migration evidence."""

from __future__ import annotations

import hashlib
from importlib import import_module
import json
from pathlib import Path
import re
from typing import TypeAlias

preparation = import_module("prepare-monitoring-refactor")
driver = import_module("migrate-monitoring-stack")
Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
CORE, TARGET = preparation.CORE, preparation.MONITORING
obj, text, equal = preparation.object_value, preparation.text_value, preparation.require_equal
ROOT = "monitoring-refactor/four-batches"


def digest(value: Json) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def get(aws: driver.Aws, directory: Path, key: str) -> dict[str, Json]:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (hashlib.sha256(key.encode()).hexdigest() + ".private.json")
    response = aws.call("file-publishing", "s3api", "get-object", [
        "--bucket", driver.BUCKET, "--key", key, str(path),
    ])
    path.chmod(0o600)
    equal(response.get("ServerSideEncryption"), "AES256", key + "/encryption")
    return obj(json.loads(path.read_text()), key)


def keys(aws: driver.Aws, prefix: str) -> set[str]:
    return {text(row.get("Key"), "private key") for row in driver.rows(aws.call(
        "file-publishing", "s3api", "list-objects-v2", ["--bucket", driver.BUCKET, "--prefix", prefix],
    ).get("Contents", []), "private objects")}


def pointer_key(source: str) -> str:
    return f"{ROOT}/current/{digest(source)}.private.json"


def current_manifest(aws: driver.Aws, directory: Path, source: str) -> str | None:
    pointer = pointer_key(source)
    if pointer not in keys(aws, pointer):
        return None
    value = get(aws, directory, pointer)
    equal(value.get("source"), source, "current manifest source")
    key = text(value.get("manifest"), "current manifest")
    equal(load_manifest(aws, directory, key)["source"], source, "pointer-bound source")
    return key


def load_manifest(aws: driver.Aws, directory: Path, key: str) -> dict[str, Json]:
    if not re.fullmatch(ROOT + r"/manifests/[0-9a-f]{64}\.private\.json", key):
        raise ValueError("Invalid private four-batch manifest key")
    manifest = get(aws, directory, key)
    equal(key, f"{ROOT}/manifests/{digest(manifest)}.private.json", "manifest content hash")
    equal(manifest.get("version"), 1, "manifest version")
    equal(manifest.get("batches"), memberships(driver.selected(obj(manifest["resources"], "original"))), "saved finite memberships")
    source = text(manifest.get("source"), "manifest source")
    equal(get(aws, directory, pointer_key(source)), {"source": source, "manifest": key}, "bound current manifest")
    return manifest


def memberships(resources: dict[str, Json]) -> list[list[str]]:
    filters = sorted(key for key, value in resources.items() if obj(value, key)["ResourceType"] == "AWS::Logs::MetricFilter")
    alarms = sorted(key for key, value in resources.items() if obj(value, key)["ResourceType"] == "AWS::CloudWatch::Alarm")
    equal([len(filters), len(alarms)], [8, 58], "finite batch membership")
    return [filters, alarms[:25], alarms[25:50], alarms[50:]]


def cumulative(manifest: dict[str, Json], count: int) -> dict[str, Json]:
    if count not in range(5):
        raise ValueError("Batch count must be between zero and four")
    original = obj(manifest["resources"], "original identities")
    return {key: original[key] for batch in memberships(driver.selected(original))[:count] for key in batch}


def reject_dangling(template: dict[str, Json]) -> None:
    resources = obj(template.get("Resources"), "template resources")
    parameters = obj(template.get("Parameters", {}), "template parameters")
    def reference(name: str, local: set[str], attribute: bool) -> None:
        if name in local or name in resources or (not attribute and (name in parameters or name.startswith("AWS::"))):
            return
        raise ValueError(f"Unsupported dangling local reference: {name}")
    def visit(value: Json) -> None:
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            for key, child in value.items():
                if key == "Ref":
                    reference(text(child, "Ref"), set(), False)
                elif key == "Fn::GetAtt":
                    name = child.split(".")[0] if isinstance(child, str) else text(child[0], "GetAtt") if isinstance(child, list) and len(child) == 2 else ""
                    reference(name, set(), True)
                elif key == "DependsOn":
                    for name in child if isinstance(child, list) else [child]:
                        reference(text(name, "DependsOn"), set(), True)
                elif key == "Fn::Sub":
                    expression, bindings = (child, {}) if isinstance(child, str) else (child[0], obj(child[1], "Sub bindings")) if isinstance(child, list) and len(child) == 2 else ("", {})
                    expression = text(expression, "Sub expression")
                    for name in re.findall(r"\$\{([^}]+)\}", expression):
                        if not name.startswith("!"):
                            reference(name.split(".")[0], set(bindings), "." in name)
                    visit(bindings)
                else:
                    visit(child)
    visit(template)


def templates(manifest: dict[str, Json], count: int) -> dict[str, Json]:
    legacy = obj(manifest["legacy"], "legacy")
    if count == 0:
        return {CORE: legacy}
    moved = cumulative(manifest, count)
    transport = obj(manifest["transport"], "transport")
    core, target = obj(transport[CORE], CORE), obj(transport[TARGET], TARGET)
    original = obj(legacy["Resources"], "legacy Resources")
    pair: dict[str, Json] = {
        CORE: {**core, "Resources": {**obj(core["Resources"], CORE), **{
            key: original[key] for key in cumulative(manifest, 4) if key not in moved}}},
        TARGET: {**target, "Resources": {key: obj(target["Resources"], TARGET)[key] for key in moved}},
    }
    for value in pair.values():
        reject_dangling(obj(value, "intermediate template"))
    return pair


def active_refactors(aws: driver.Aws, retired: set[str]) -> set[str]:
    retry = import_module("reconcile-monitoring-retry")
    preview = import_module("reconcile-monitoring-preview")
    validators = {driver.REVIEWED_REFACTOR: driver.aborted_attempt, retry.RETRY_REFACTOR: retry.aborted_attempt,
                  preview.PREVIEW: preview.aborted_attempt}
    if retired - set(validators):
        raise ValueError("Only exact receipt-verified historical attempts may be excluded")
    relevant = driver.relevant_refactors(aws)
    for refactor in retired:
        status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
        equal(status.get("StackRefactorId"), refactor, "historical refactor identity")
        check = validators[refactor]
        equal(check(aws, status), True, refactor + "/verified historical retirement")
    return set(relevant) - retired


def operation_prefix(manifest: dict[str, Json]) -> str:
    return f"{ROOT}/runs/{digest(manifest)}"


def mappings(manifest: dict[str, Json], index: int) -> list[Json]:
    members = memberships(driver.selected(obj(manifest["resources"], "original")))[index - 1]
    return [row for row in driver.rows(manifest["mappings"], "mappings") if obj(row["Source"], "mapping")["LogicalResourceId"] in members]


def verified_prefix(aws: driver.Aws, directory: Path, key: str, retired: set[str]) -> tuple[dict[str, Json], list[dict[str, Json]]]:
    manifest = load_manifest(aws, directory, key)
    base = operation_prefix(manifest)
    operations = keys(aws, base + "/operations/")
    equal(operations, {f"{base}/operations/{index}.private.json" for index in range(1, len(operations) + 1)}, "contiguous operation journal")
    if len(operations) > 4:
        raise ValueError("More than four operations in finite manifest")
    receipts: list[dict[str, Json]] = []
    known: set[str] = set()
    receipt_keys: set[str] = set()
    for index in range(1, len(operations) + 1):
        operation = get(aws, directory, f"{base}/operations/{index}.private.json")
        refactor = text(operation.get("StackRefactorId"), "journal operation")
        if refactor in known:
            raise ValueError("Repeated operation in batch journal")
        known.add(refactor)
        receipt_key = f"{base}/receipts/{digest(refactor)}.private.json"
        receipt_keys.add(receipt_key)
        if receipt_key not in keys(aws, receipt_key):
            raise ValueError(f"Unreceipted operation {refactor}; preserve evidence and stop for reviewed recovery")
        receipt = get(aws, directory, receipt_key)
        previous = digest(receipts[-1]) if receipts else None
        for field, expected in (("manifest", key), ("index", index), ("previous", previous),
                                ("templateHash", digest(templates(manifest, index))), ("mappingHash", digest(mappings(manifest, index)))):
            equal(operation.get(field), expected, "accepted operation/" + field)
        equal(operation.get("requestHash"), digest(obj(operation.get("request"), "accepted request")), "accepted request hash")
        equal(operation["request"], request(manifest, index), "accepted exact request")
        for field, expected in (("manifest", key), ("index", index), ("previous", previous), ("operationHash", digest(operation)),
                                ("StackRefactorId", refactor), ("members", memberships(driver.selected(obj(manifest["resources"], "original")))[index - 1]),
                                ("moved", cumulative(manifest, index))):
            equal(receipt.get(field), expected, "verified receipt/" + field)
        status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
        equal(status.get("StackRefactorId"), refactor, "journal described operation ID")
        equal(status.get("ExecutionStatus"), "EXECUTE_COMPLETE", refactor + "/execution")
        equal(status.get("Status"), "CREATE_COMPLETE", refactor + "/creation")
        ids = driver.refactor_stack_ids(status, text(manifest["source"], "source"))
        equal(receipt.get("StackIds"), ids, "verified authoritative stack IDs")
        if receipts:
            equal(ids, receipts[-1]["StackIds"], "same cumulative target")
        for name, value in templates(manifest, index).items():
            equal(get(aws, directory, f"{base}/templates/{index}-{name}-{digest(value)}.private.json"),
                  value, "historical submitted template")
        actions = get(aws, directory, f"{base}/actions/{digest(refactor)}.private.json")
        equal(aws.cf("list-stack-refactor-actions", ["--stack-refactor-id", refactor]),
              actions, "historical exact actions")
        action_rows = driver.rows(actions.get("StackRefactorActions"), "historical actions")
        members = memberships(driver.selected(obj(manifest["resources"], "original")))[index - 1]
        driver.validate_actions(action_rows, status, text(manifest["source"], "source"),
                                {name: obj(manifest["resources"], "original")[name] for name in members})
        if index > 1 and any(row.get("Entity") == "STACK" for row in action_rows):
            raise ValueError("Existing target batch must not create a stack")
        receipts.append(receipt)
    equal(keys(aws, base + "/receipts/"), receipt_keys, "all operation-linked receipts")
    equal(active_refactors(aws, retired), known, "all relevant production operations")
    return manifest, receipts


def request(manifest: dict[str, Json], index: int) -> dict[str, Json]:
    pair = templates(manifest, index)
    base = operation_prefix(manifest)
    return {"EnableStackCreation": index == 1, "StackDefinitions": [
        {"StackName": name, "TemplateURL": f"https://{driver.BUCKET}.s3.{driver.REGION}.amazonaws.com/{base}/templates/{index}-{name}-{digest(value)}.private.json"}
        for name, value in pair.items()], "ResourceMappings": mappings(manifest, index),
        "Description": f"Monitoring finite native batch {index}/4; preserve original physical resources"}


def final_ownership(aws: driver.Aws, manifest: dict[str, Json], receipts: list[dict[str, Json]]) -> None:
    equal(len(receipts), 4, "complete four-batch receipt chain")
    current = driver.stacks(aws)
    equal({name: obj(value, name)["StackId"] for name, value in current.items()}, receipts[-1]["StackIds"], "final stack IDs")
    core = driver.inventory(aws, CORE)
    equal(driver.selected(core), {}, "no monitoring left in source")
    target = driver.inventory(aws, TARGET)
    moved = cumulative(manifest, 4)
    equal(set(core) & set(moved), set(), "no original moved logical IDs in source")
    equal({name: target.get(name) for name in moved}, moved, "full 66 moved identities")
    equal(obj(target.get("CDKMetadata"), "split CDKMetadata").get("ResourceType"),
          "AWS::CDK::Metadata", "completed ordinary split deployment")
    for name, resource in target.items():
        if name != "CDKMetadata" and obj(resource, name).get("ResourceType") not in driver.EXPECTED:
            raise ValueError(f"{name}: only alarms and metric filters may be added to monitoring")
