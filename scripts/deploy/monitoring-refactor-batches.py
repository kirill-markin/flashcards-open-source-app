"""Inert four-batch engine; activation and CI credential renewal belong to the driver."""

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


def put(aws: driver.Aws, directory: Path, key: str, value: Json) -> None:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (hashlib.sha256(key.encode()).hexdigest() + ".private.json")
    preparation.write_private(path, value)
    aws.call("file-publishing", "s3api", "put-object", [
        "--bucket", driver.BUCKET, "--key", key, "--body", str(path),
        "--server-side-encryption", "AES256", "--if-none-match", "*",
    ])


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


def put_template(aws: driver.Aws, directory: Path, key: str, value: Json) -> None:
    if key in keys(aws, key):
        equal(digest(get(aws, directory, key)), digest(value), key + "/template content")
    else:
        put(aws, directory, key, value)


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


def assembly(directory: Path) -> dict[str, Json]:
    assets = {path.name: obj(json.loads(path.read_text()), path.name) for path in sorted(directory.glob("*.assets.json"))}
    if not assets:
        raise ValueError("Missing approved split asset manifests")
    return {"templates": {name: preparation.read_template(directory, name) for name in (CORE, TARGET)}, "assets": assets}


def verify_assembly(manifest: dict[str, Json], directory: Path) -> None:
    equal(assembly(directory), manifest["assembly"], "same-commit approved split templates and asset manifests")


def alarm_tags(aws: driver.Aws, resources: dict[str, Json]) -> dict[str, Json]:
    result: dict[str, Json] = {}
    for key, value in driver.selected(resources).items():
        if obj(value, key)["ResourceType"] == "AWS::CloudWatch::Alarm":
            arn = f"arn:aws:cloudwatch:{driver.REGION}:{driver.ACCOUNT}:alarm:" + text(obj(value, key)["PhysicalResourceId"], key)
            tags = driver.rows(aws.call("lookup", "cloudwatch", "list-tags-for-resource", ["--resource-arn", arn]).get("Tags"), key)
            if any(not isinstance(tag.get("Value"), str) for tag in tags):
                raise ValueError(f"{key}: alarm tag value must be a string")
            result[key] = {text(tag.get("Key"), "tag key"): tag["Value"] for tag in tags}
            equal(len(obj(result[key], key)), len(tags), "unique alarm tags")
    return result


def active_refactors(aws: driver.Aws, retired: set[str]) -> set[str]:
    retry = import_module("reconcile-monitoring-retry")
    preview = import_module("reconcile-monitoring-preview")
    validators = {driver.REVIEWED_REFACTOR: driver.aborted_attempt, retry.RETRY_REFACTOR: retry.aborted_attempt,
                  preview.PREVIEW: preview.aborted_attempt}
    if retired - set(validators):
        raise ValueError("Only exact receipt-verified historical attempts may be excluded")
    relevant = driver.relevant_refactors(aws)
    for refactor in retired:
        if refactor not in relevant:
            raise ValueError(f"Retired operation {refactor} missing from complete refactor listing")
        check = validators[refactor]
        equal(check(aws, relevant[refactor]), True, refactor + "/verified historical retirement")
    return set(relevant) - retired


def prepare(aws: driver.Aws, directory: Path, commit: str, run: str, attempt: str, retired: set[str]) -> str:
    current = driver.stacks(aws)
    equal(set(current), {CORE}, "fresh legacy stack topology")
    source = text(obj(current[CORE], CORE)["StackId"], "source ID")
    if current_manifest(aws, directory, source) is not None or active_refactors(aws, retired):
        raise ValueError("Existing manifest or unexplained refactor; inspect before preparing")
    legacy = preparation.read_template(directory / "legacy", CORE)
    approved = assembly(directory / "split")
    pair = obj(approved["templates"], "approved pair")
    report = preparation.compare(legacy, obj(pair[CORE], CORE), obj(pair[TARGET], TARGET))
    equal(driver.template(aws, source), legacy, "fresh deployed legacy template")
    resources = driver.inventory(aws, source)
    equal(len(resources), 497, "original identity count")
    equal(set(resources), set(obj(legacy["Resources"], "legacy resources")), "original logical IDs")
    for key, resource in resources.items():
        equal(obj(resource, key)["ResourceType"], obj(obj(legacy["Resources"], "legacy")[key], key)["Type"], key + "/type")
    if aws.cf("get-stack-policy", ["--stack-name", source]).get("StackPolicyBody"):
        raise ValueError("Core stack policy prevents native refactor")
    for kind in driver.EXPECTED:
        equal(aws.cf("describe-type", ["--type", "RESOURCE", "--type-name", kind]).get("ProvisioningType"), "FULLY_MUTABLE", kind)
    manifest: dict[str, Json] = {
        "version": 1, "source": source, "commit": text(commit, "commit"), "run": text(run, "run"), "attempt": text(attempt, "attempt"),
        "legacy": legacy, "resources": resources, "settings": driver.stack_settings(obj(current[CORE], CORE)),
        "runtime": driver.runtime(aws, resources, legacy), "tags": alarm_tags(aws, resources), "assembly": approved,
        "transport": driver.transport(legacy, obj(pair[CORE], CORE), obj(pair[TARGET], TARGET)),
        "batches": memberships(driver.selected(resources)), "mappings": report["resourceMappings"],
    }
    for count in range(1, 5):
        templates(manifest, count)
    key = f"{ROOT}/manifests/{digest(manifest)}.private.json"
    put(aws, directory, key, manifest)
    put(aws, directory, pointer_key(source), {"source": source, "manifest": key})
    prove_prefix(aws, manifest, [])
    return key


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
        receipts.append(receipt)
    equal(keys(aws, base + "/receipts/"), receipt_keys, "all operation-linked receipts")
    equal(active_refactors(aws, retired), known, "all relevant production operations")
    return manifest, receipts


def prove_prefix(aws: driver.Aws, manifest: dict[str, Json], receipts: list[dict[str, Json]]) -> None:
    prove_snapshot(aws, manifest, receipts, driver.stacks(aws))


def prove_snapshot(aws: driver.Aws, manifest: dict[str, Json], receipts: list[dict[str, Json]], current: dict[str, Json]) -> None:
    count = len(receipts)
    for name, stack in current.items():
        if obj(stack, name).get("StackStatus") not in driver.STABLE:
            raise ValueError(f"{name}: source or cumulative target is no longer stable")
    expected_ids = receipts[-1]["StackIds"] if receipts else {CORE: manifest["source"]}
    equal({name: obj(value, name)["StackId"] for name, value in current.items()}, expected_ids, "current authoritative stacks")
    moved = cumulative(manifest, count)
    original = obj(manifest["resources"], "original")
    expected = {CORE: {key: value for key, value in original.items() if key not in moved}, TARGET: moved}
    for name, definition in templates(manifest, count).items():
        stack_id = text(obj(current[name], name)["StackId"], name)
        equal(driver.inventory(aws, stack_id), expected[name], name + "/full original partition")
        equal(driver.template(aws, stack_id), definition, name + "/exact cumulative template")
    settings = driver.stack_settings(obj(current[CORE], CORE))
    baseline = obj(manifest["settings"], "baseline settings")
    for field in ("Parameters", "Tags", "RoleARN"):
        equal(settings[field], baseline[field], "preserved source/" + field)
    outputs = obj(settings["Outputs"], "current Outputs")
    for name, value in obj(baseline["Outputs"], "baseline Outputs").items():
        equal(outputs.get(name), value, "preserved original output/" + name)
    equal(set(outputs), set(obj(obj(templates(manifest, count)[CORE], CORE).get("Outputs", {}), "approved outputs")), "exact approved output keys")
    equal(driver.runtime(aws, original, obj(manifest["legacy"], "legacy")), manifest["runtime"], "all alarm/filter/SNS configurations")
    tags = alarm_tags(aws, original)
    for name, value in obj(manifest["tags"], "baseline tags").items():
        expected_tags = obj(value, name)
        if name in moved:
            expected_tags = {**expected_tags, "aws:cloudformation:stack-name": TARGET,
                             "aws:cloudformation:stack-id": obj(expected_ids, "stack IDs")[TARGET], "aws:cloudformation:logical-id": name}
        equal(tags[name], expected_tags, name + "/preserved user and cumulative ownership tags")


def request(manifest: dict[str, Json], index: int) -> dict[str, Json]:
    pair = templates(manifest, index)
    base = operation_prefix(manifest)
    return {"EnableStackCreation": index == 1, "StackDefinitions": [
        {"StackName": name, "TemplateURL": f"https://{driver.BUCKET}.s3.{driver.REGION}.amazonaws.com/{base}/templates/{index}-{name}-{digest(value)}.private.json"}
        for name, value in pair.items()], "ResourceMappings": mappings(manifest, index),
        "Description": f"Monitoring finite native batch {index}/4; preserve original physical resources"}


def prove_first_preview(aws: driver.Aws, manifest: dict[str, Json], ids: dict[str, str]) -> None:
    # A new native target has no GetTemplate before execution. Its submitted URL and operation bind it.
    equal(driver.inventory(aws, ids[TARGET]), {}, "first native target empty inventory")
    fresh = {text(row.get("StackName"), "stack name"): row for row in driver.rows(
        aws.cf("describe-stacks", []).get("Stacks"), "preview stacks") if row.get("StackName") in (CORE, TARGET)}
    if TARGET in fresh:
        equal(obj(fresh[TARGET], TARGET)["StackId"], ids[TARGET], "first target authoritative ID")
        if obj(fresh[TARGET], TARGET).get("StackStatus") not in ("REVIEW_IN_PROGRESS", "CREATE_IN_PROGRESS", "CREATE_COMPLETE"):
            raise ValueError("First native target is not new and empty")
    prove_snapshot(aws, manifest, [], {name: value for name, value in fresh.items() if name != TARGET})


def authorize_resume(aws: driver.Aws, directory: Path, source: str, requested_key: str, commit: str, retired: set[str]) -> int:
    equal(current_manifest(aws, directory, source), text(requested_key, "explicit resume manifest"), "explicit bound manifest")
    manifest, receipts = verified_prefix(aws, directory, requested_key, retired)
    equal(manifest["commit"], commit, "resume exact commit")
    prove_prefix(aws, manifest, receipts)
    return len(receipts)


def run_batch(aws: driver.Aws, directory: Path, key: str, index: int, commit: str, run: str, attempt: str, resume_key: str, retired: set[str]) -> None:
    if index not in range(1, 5):
        raise ValueError("Only batches one through four are supported")
    manifest, receipts = verified_prefix(aws, directory, key, retired)
    equal(manifest["commit"], commit, "batch exact commit")
    if [run, attempt] != [manifest["run"], manifest["attempt"]]:
        equal(resume_key, key, "different run requires explicit same-commit manifest resume")
    elif resume_key:
        equal(resume_key, key, "explicit resume manifest")
    prove_prefix(aws, manifest, receipts)
    if index <= len(receipts):
        return
    equal(index, len(receipts) + 1, "only next unexecuted batch")
    source = text(manifest["source"], "source")
    driver.prepare_native_caller(aws, directory, source, obj(manifest["resources"], "original"))
    base = operation_prefix(manifest)
    pair = templates(manifest, index)
    for name, value in pair.items():
        put_template(aws, directory, f"{base}/templates/{index}-{name}-{digest(value)}.private.json", value)
    submitted = request(manifest, index)
    path = directory / f"request-{index}.private.json"
    preparation.write_private(path, submitted)
    # Recheck after credential preflight and uploads, before the first native mutation.
    verified_prefix(aws, directory, key, retired)
    prove_prefix(aws, manifest, receipts)
    response = aws.call("native", "cloudformation", "create-stack-refactor", ["--cli-input-json", "file://" + str(path)])
    refactor = text(response.get("StackRefactorId"), "accepted operation ID")
    operation: dict[str, Json] = {"StackRefactorId": refactor, "manifest": key, "index": index,
        "previous": digest(receipts[-1]) if receipts else None, "request": submitted, "requestHash": digest(submitted),
        "templateHash": digest(pair), "mappingHash": digest(mappings(manifest, index))}
    put(aws, directory, f"{base}/operations/{index}.private.json", operation)
    status = driver.wait_refactor(aws, refactor, "AVAILABLE")
    equal(status.get("StackRefactorId"), refactor, "accepted preview operation ID")
    ids = driver.refactor_stack_ids(status, source)
    if receipts:
        equal(ids, receipts[-1]["StackIds"], "existing target authoritative ID")
    actions = aws.cf("list-stack-refactor-actions", ["--stack-refactor-id", refactor])
    put(aws, directory, f"{base}/actions/{digest(refactor)}.private.json", actions)
    action_rows = driver.rows(actions.get("StackRefactorActions"), "preview actions")
    members = memberships(driver.selected(obj(manifest["resources"], "original")))[index - 1]
    subset = {name: obj(manifest["resources"], "original")[name] for name in members}
    driver.validate_actions(action_rows, status, source, subset)
    if index > 1 and any(row.get("Entity") == "STACK" for row in action_rows):
        raise ValueError("Existing target batch must not create a stack")
    equal(active_refactors(aws, retired), {text(row["StackRefactorId"], "operation") for row in receipts} | {refactor}, "pre-execution known operations")
    if index == 1:
        prove_first_preview(aws, manifest, ids)
    else:
        prove_prefix(aws, manifest, receipts)
    fresh_status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
    equal(fresh_status.get("ExecutionStatus"), "AVAILABLE", "last pre-execution status")
    equal(driver.refactor_stack_ids(fresh_status, source), ids, "last pre-execution stack IDs")
    aws.call("native", "cloudformation", "execute-stack-refactor", ["--stack-refactor-id", refactor])
    completed = driver.wait_refactor(aws, refactor, "EXECUTE_COMPLETE")
    equal(driver.refactor_stack_ids(completed, source), ids, "completed operation IDs")
    driver.wait_stacks(aws, refactor, ids)
    receipt: dict[str, Json] = {"StackRefactorId": refactor, "manifest": key, "index": index,
        "previous": operation["previous"], "operationHash": digest(operation), "StackIds": ids,
        "members": members, "moved": cumulative(manifest, index)}
    prove_prefix(aws, manifest, [*receipts, receipt])
    equal(active_refactors(aws, retired), {text(row["StackRefactorId"], "operation") for row in receipts} | {refactor}, "post-proof known operations")
    put(aws, directory, f"{base}/receipts/{digest(refactor)}.private.json", receipt)


def final_ownership(aws: driver.Aws, manifest: dict[str, Json], receipts: list[dict[str, Json]]) -> None:
    equal(len(receipts), 4, "complete four-batch receipt chain")
    current = driver.stacks(aws)
    equal({name: obj(value, name)["StackId"] for name, value in current.items()}, receipts[-1]["StackIds"], "final stack IDs")
    equal(driver.selected(driver.inventory(aws, CORE)), {}, "no monitoring left in source")
    target = driver.inventory(aws, TARGET)
    equal(driver.selected(target), cumulative(manifest, 4), "full 66 moved identities")
    for name, resource in target.items():
        if name not in cumulative(manifest, 4):
            equal([name, obj(resource, name)["ResourceType"]], ["CDKMetadata", "AWS::CDK::Metadata"], "only ordinary split metadata may be additional")
