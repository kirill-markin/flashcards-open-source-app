#!/usr/bin/env python3
"""CI-only ownership gate and native move of this repository's 66 monitoring resources."""

import argparse
from collections import Counter
import hashlib
from importlib import import_module
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from tempfile import TemporaryDirectory
from typing import TypeAlias

preparation = import_module("prepare-monitoring-refactor")
Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
CORE = "FlashcardsOpenSourceApp"
TARGET = CORE + "Monitoring"
ACCOUNT = "506210661494"
REGION = "eu-central-1"
BUCKET = f"cdk-hnb659fds-assets-{ACCOUNT}-{REGION}"
EXPECTED = {"AWS::CloudWatch::Alarm": 58, "AWS::Logs::MetricFilter": 8}
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
        for purpose in ("lookup", "file-publishing", "deploy"):
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
        if not result.stdout.strip() and operation in ("get-stack-policy", "execute-stack-refactor"):
            return {}
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
        if item.get("StackStatus") not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
            raise ValueError(f"{name}: unstable stack {item.get('StackStatus')}; inspect before continuing")
    return found


def selected(resources: dict[str, Json]) -> dict[str, Json]:
    return {key: item for key, item in resources.items() if obj(item, key).get("ResourceType") in EXPECTED}


def verified_key(refactor: str) -> str:
    return f"monitoring-refactor/verified/{hashlib.sha256(refactor.encode()).hexdigest()}.private.json"


def read_verified_receipt(aws: Aws, refactor: str) -> dict[str, Json]:
    try:
        with TemporaryDirectory(prefix="monitoring-verification-") as directory:
            path = Path(directory) / "verified.private.json"
            aws.call("file-publishing", "s3api", "get-object", [
                "--bucket", BUCKET, "--key", verified_key(refactor), str(path),
            ])
            receipt = obj(json.loads(path.read_text()), "verified receipt")
            equal(receipt.get("StackRefactorId"), refactor, "verified operation")
            return receipt
    except (ValueError, OSError, RuntimeError) as error:
        raise ValueError(f"Refactor {refactor} has no readable matching verified receipt; "
                         f"stop for explicit recovery: {error}") from error


def ownership(aws: Aws) -> str:
    verified: dict[str, dict[str, Json]] = {}
    for summary in rows(aws.cf("list-stack-refactors", []).get("StackRefactorSummaries"), "refactors"):
        refactor = text(summary.get("StackRefactorId"), "StackRefactorId")
        details = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
        ids = details.get("StackIds")
        if not isinstance(ids, list):
            raise ValueError(f"{refactor}: missing StackIds; inspect operation")
        if any(isinstance(item, str) and any(f":stack/{name}/" in item for name in (CORE, TARGET)) for item in ids):
            if details.get("ExecutionStatus") != "EXECUTE_COMPLETE":
                raise ValueError(f"Inspect prior refactor {refactor}: {json.dumps(details)}")
            receipt = read_verified_receipt(aws, refactor)
            receipt_ids = obj(receipt.get("StackIds"), f"{refactor}/verified StackIds")
            equal(set(receipt_ids), {CORE, TARGET}, f"{refactor}/verified stack names")
            equal(sorted(text(value, "StackId") for value in receipt_ids.values()),
                  sorted(text(value, "StackId") for value in ids), f"{refactor}/operation stack IDs")
            verified[refactor] = receipt
    current = stacks(aws)
    if not current:
        if verified:
            raise ValueError(f"Verified refactors {list(verified)} exist without stacks; inspect ownership")
        return "fresh"
    if CORE not in current:
        raise ValueError("Monitoring exists without core; inspect ownership")
    core = selected(inventory(aws, CORE))
    target_resources = inventory(aws, TARGET) if TARGET in current else {}
    target = selected(target_resources)
    for refactor, receipt in verified.items():
        equal(receipt["StackIds"], {name: obj(stack, name)["StackId"] for name, stack in current.items()},
              f"{refactor}/current stack IDs")
        equal(obj(receipt.get("moved"), "verified moved resources"), target, f"{refactor}/current moved identities")
    if any(key != "CDKMetadata" or obj(value, key).get("ResourceType") != "AWS::CDK::Metadata"
           for key, value in target_resources.items() if key not in target):
        raise ValueError("Unexpected non-monitoring target resources; inspect ownership")
    owner = core if core and not target and TARGET not in current else target if target and not core else {}
    equal(dict(Counter(obj(item, key)["ResourceType"] for key, item in owner.items())), EXPECTED, "monitoring ownership")
    return "legacy" if core else "split"


def template(aws: Aws, stack: str) -> dict[str, Json]:
    body = aws.cf("get-template", ["--stack-name", stack, "--template-stage", "Original"]).get("TemplateBody")
    return obj(json.loads(body) if isinstance(body, str) else body, "TemplateBody")


def runtime(aws: Aws, resources: dict[str, Json], legacy: dict[str, Json]) -> dict[str, Json]:
    definitions = obj(legacy.get("Resources"), "Resources")
    names = [text(obj(item, key)["PhysicalResourceId"], key) for key, item in selected(resources).items()
             if obj(item, key)["ResourceType"] == "AWS::CloudWatch::Alarm"]
    alarms = rows(aws.call("lookup", "cloudwatch", "describe-alarms", ["--alarm-names", *names]).get("MetricAlarms"), "alarms")
    equal(sorted(text(alarm.get("AlarmName"), "AlarmName") for alarm in alarms), sorted(names), "alarm identities")
    transient = {"StateValue", "StateReason", "StateReasonData", "StateUpdatedTimestamp", "StateTransitionedTimestamp",
                 "AlarmConfigurationUpdatedTimestamp", "EvaluationState"}
    configs: dict[str, Json] = {text(alarm["AlarmName"], "AlarmName"):
                               {key: value for key, value in alarm.items() if key not in transient} for alarm in alarms}
    filters: dict[str, Json] = {}
    for key, item in selected(resources).items():
        if obj(item, key)["ResourceType"] != "AWS::Logs::MetricFilter":
            continue
        group = obj(obj(definitions[key], key).get("Properties"), key)["LogGroupName"]
        if isinstance(group, dict) and set(group) == {"Ref"}:
            group = obj(resources[text(group["Ref"], key)], key)["PhysicalResourceId"]
        elif isinstance(group, dict) and set(group) == {"Fn::GetAtt"}:
            attribute = group["Fn::GetAtt"]
            if not isinstance(attribute, list) or len(attribute) != 2 or attribute[1] != "LogGroupName":
                raise ValueError(f"{key}: unsupported log-group reference")
            group = obj(resources[text(attribute[0], key)], key)["PhysicalResourceId"]
        name = text(obj(item, key)["PhysicalResourceId"], key)
        matches = [entry for entry in rows(aws.call("lookup", "logs", "describe-metric-filters", [
            "--log-group-name", text(group, key), "--filter-name-prefix", name,
        ]).get("metricFilters"), key) if entry.get("filterName") == name and entry.get("logGroupName") == group]
        if len(matches) != 1:
            raise ValueError(f"{key}: expected exactly one filter with the original name and log group")
        filters[key] = {field: value for field, value in matches[0].items() if field != "creationTime"}
    topics = [text(obj(item, key)["PhysicalResourceId"], key) for key, item in resources.items()
              if obj(item, key)["ResourceType"] == "AWS::SNS::Topic"]
    if len(topics) != 1:
        raise ValueError("Expected the single existing alert topic")
    subscriptions = rows(aws.call("lookup", "sns", "list-subscriptions-by-topic", ["--topic-arn", topics[0]]).get("Subscriptions"), "subscriptions")
    if len(subscriptions) != 1 or not text(subscriptions[0].get("SubscriptionArn"), "subscription").startswith("arn:aws:sns:"):
        raise ValueError("Expected one confirmed alert subscription")
    if any(topics[0] not in alarm.get("AlarmActions", []) or alarm.get("ActionsEnabled") is not True for alarm in alarms):
        raise ValueError("Every alarm must retain enabled actions to the existing alert topic")
    return {"alarms": configs, "filters": filters, "subscriptions": subscriptions}


def transport(legacy: dict[str, Json], core: dict[str, Json], target: dict[str, Json]) -> dict[str, Json]:
    parameters = obj(target.get("Parameters"), "target/Parameters")
    bootstrap = obj(parameters.get("BootstrapVersion"), "BootstrapVersion")
    equal(set(parameters), {"BootstrapVersion"}, "target parameter names")
    equal({key: value for key, value in bootstrap.items() if key != "Description"},
          {"Type": "AWS::SSM::Parameter::Value<String>", "Default": "/cdk-bootstrap/hnb659fds/version"}, "bootstrap definition")
    rules = obj(target.get("Rules"), "target/Rules")
    equal(set(rules), {"CheckBootstrapVersion"}, "target rule names")
    rule = obj(rules["CheckBootstrapVersion"], "bootstrap rule")
    assertions = rows(rule.get("Assertions"), "bootstrap assertions")
    if set(rule) != {"Assertions"} or len(assertions) != 1:
        raise ValueError("Unexpected bootstrap rule")
    equal(assertions[0].get("Assert"), {"Fn::Not": [{"Fn::Contains": [["1", "2", "3", "4", "5"], {"Ref": "BootstrapVersion"}]}]}, "bootstrap assertion")
    if target.get("Conditions") or legacy.get("Conditions"):
        raise ValueError("Unexpected Conditions require a new transport review")
    remaining = {key: value for key, value in target.items() if key not in {"Parameters", "Rules"}}
    if "BootstrapVersion" in json.dumps(remaining):
        raise ValueError("Workload references removed BootstrapVersion parameter")
    return {
        CORE: {**core, "Resources": {**obj(core["Resources"], CORE), "CDKMetadata": obj(legacy["Resources"], CORE)["CDKMetadata"]}},
        TARGET: {**remaining, "Resources": {key: value for key, value in obj(target["Resources"], TARGET).items() if key != "CDKMetadata"}},
    }


def wait_refactor(aws: Aws, refactor: str, desired: str) -> dict[str, Json]:
    for _ in range(120):
        status = aws.cf("describe-stack-refactor", ["--stack-refactor-id", refactor])
        if status.get("Status") == "CREATE_COMPLETE" and status.get("ExecutionStatus") == desired:
            return status
        if status.get("Status") not in ("CREATE_IN_PROGRESS", "CREATE_COMPLETE") or status.get("ExecutionStatus") not in ("UNAVAILABLE", "AVAILABLE", "EXECUTE_IN_PROGRESS"):
            raise ValueError(f"Refactor {refactor} stopped: {json.dumps(status)}")
        time.sleep(5)
    raise ValueError(f"Refactor {refactor} timed out; inspect, do not replay")


def refactor_stack_ids(status: dict[str, Json], source: str) -> dict[str, str]:
    ids = status.get("StackIds")
    if not isinstance(ids, list) or len(ids) != 2 or source not in ids:
        raise ValueError("Preview must contain only the two intended stacks")
    targets = [item for item in ids if isinstance(item, str) and item.startswith(f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{TARGET}/")]
    if len(targets) != 1:
        raise ValueError("Preview target stack identity is not authoritative")
    return {CORE: source, TARGET: targets[0]}


def wait_stacks(aws: Aws, refactor: str, stack_ids: dict[str, str]) -> dict[str, Json]:
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        current: dict[str, Json] = {}
        for name, stack_id in stack_ids.items():
            response = rows(aws.cf("describe-stacks", ["--stack-name", stack_id]).get("Stacks"), stack_id)
            if len(response) != 1 or response[0].get("StackId") != stack_id or response[0].get("StackName") != name:
                raise ValueError(f"Refactor {refactor}: unexpected stack identity for {stack_id}")
            stack = response[0]
            status = stack.get("StackStatus")
            if status in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
                current[name] = stack
            elif status not in ("UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS") and not (
                name == TARGET and status == "CREATE_IN_PROGRESS"
            ):
                raise ValueError(f"Refactor {refactor}: stack {stack_id} stopped: {json.dumps(stack)}")
        if len(current) == len(stack_ids):
            return current
        time.sleep(5)
    raise ValueError(f"Refactor {refactor}: stacks {stack_ids} did not stabilize within 600 seconds; "
                     "stop for explicit recovery")


def validate_actions(actions: list[dict[str, Json]], status: dict[str, Json], source: str, resources: dict[str, Json]) -> None:
    target = refactor_stack_ids(status, source)[TARGET]
    moves: dict[str, Json] = {}
    creates = 0
    for action in actions:
        if action.get("Entity") == "STACK" and action.get("Action") == "CREATE":
            if action.get("PhysicalResourceId") not in (TARGET, target) or action.get("ResourceMapping") or action.get("TagResources") or action.get("UntagResources"):
                raise ValueError("Unexpected STACK/CREATE identity or changes")
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
        if action.get("Description") != "No configuration changes detected.":
            raise ValueError(f"{key}: AWS has not confirmed unchanged configuration; inspect private actions")
        tags = {"aws:cloudformation:stack-name": TARGET, "aws:cloudformation:stack-id": target, "aws:cloudformation:logical-id": key}
        for tag in rows(action.get("TagResources", []), "TagResources"):
            if tag.get("Key") not in tags or tag.get("Value") != tags[tag["Key"]]:
                raise ValueError(f"{key}: unexpected resource tag change")
        removed = action.get("UntagResources", [])
        if not isinstance(removed, list) or any(tag not in tags for tag in removed):
            raise ValueError(f"{key}: unexpected removed tag")
        moves[key] = resources[key]
    equal(moves, resources, "exact server moves")
    if len(moves) != 66:
        raise ValueError("Preview must move exactly 66 resources")
    if creates > 1:
        raise ValueError("Duplicate target STACK/CREATE")


def save(aws: Aws, directory: Path, name: str, value: Json) -> str:
    path = directory / name
    preparation.write_private(path, value)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    key = f"monitoring-refactor/{os.environ['GITHUB_RUN_ID']}/{os.environ['GITHUB_RUN_ATTEMPT']}/{digest}/{name}"
    aws.call("file-publishing", "s3api", "put-object", ["--bucket", BUCKET, "--key", key, "--body", str(path), "--server-side-encryption", "AES256"])
    return f"https://{BUCKET}.s3.{REGION}.amazonaws.com/{key}"


def migrate(aws: Aws, directory: Path) -> None:
    equal(ownership(aws), "legacy", "pre-move ownership")
    legacy = preparation.read_template(directory / "legacy", CORE)
    core = preparation.read_template(directory / "split", CORE)
    target = preparation.read_template(directory / "split", TARGET)
    report = preparation.compare(legacy, core, target)
    deployed = template(aws, CORE)
    equal(deployed, legacy, "fresh deployed legacy template")
    if aws.cf("get-stack-policy", ["--stack-name", CORE]).get("StackPolicyBody"):
        raise ValueError("Core stack policy prevents native refactor")
    for kind in EXPECTED:
        equal(aws.cf("describe-type", ["--type", "RESOURCE", "--type-name", kind]).get("ProvisioningType"), "FULLY_MUTABLE", kind)
    before_stacks, before = stacks(aws), inventory(aws, CORE)
    moved = selected(before)
    equal(set(before), set(obj(legacy["Resources"], "legacy")), "source inventory/template logical IDs")
    equal(set(moved), {text(obj(row.get("Source"), "Source").get("LogicalResourceId"), "mapping")
                       for row in rows(report["resourceMappings"], "resourceMappings")}, "selected logical IDs")
    snapshot = runtime(aws, before, legacy)
    save(aws, directory, "before.private.json", {"stacks": before_stacks, "resources": before, "runtime": snapshot, "template": deployed})
    definitions = [{"StackName": name, "TemplateURL": save(aws, directory, name + ".private.json", value)}
                   for name, value in transport(deployed, core, target).items()]
    request = directory / "request.private.json"
    preparation.write_private(request, {"EnableStackCreation": True, "StackDefinitions": definitions,
        "ResourceMappings": report["resourceMappings"], "Description": "Move exactly 58 alarms and 8 filters; preserve all physical resources"})
    response = aws.call("deploy", "cloudformation", "create-stack-refactor", ["--cli-input-json", "file://" + str(request)])
    refactor = text(response.get("StackRefactorId"), "StackRefactorId")
    save(aws, directory, "operation.private.json", response)
    print(json.dumps({"StackRefactorId": refactor, "stage": "preview"}), flush=True)
    status = wait_refactor(aws, refactor, "AVAILABLE")
    actions = aws.cf("list-stack-refactor-actions", ["--stack-refactor-id", refactor])
    save(aws, directory, "actions.private.json", actions)
    validate_actions(rows(actions.get("StackRefactorActions"), "actions"), status, text(obj(before_stacks[CORE], CORE)["StackId"], "StackId"), moved)
    equal(template(aws, CORE), deployed, "source template freshness")
    equal(inventory(aws, CORE), before, "source identity freshness")
    equal(runtime(aws, before, legacy), snapshot, "configuration freshness")
    equal(aws.cf("describe-stacks", ["--stack-name", CORE]).get("Stacks"), [before_stacks[CORE]], "source stack freshness")
    aws.call("deploy", "cloudformation", "execute-stack-refactor", ["--stack-refactor-id", refactor])
    completed = wait_refactor(aws, refactor, "EXECUTE_COMPLETE")
    stack_ids = refactor_stack_ids(status, text(obj(before_stacks[CORE], CORE)["StackId"], "StackId"))
    equal(refactor_stack_ids(completed, stack_ids[CORE]), stack_ids, f"{refactor}/executed stack IDs")
    after_stacks = wait_stacks(aws, refactor, stack_ids)
    after_core, after_target = inventory(aws, stack_ids[CORE]), inventory(aws, stack_ids[TARGET])
    equal(after_core, {key: value for key, value in before.items() if key not in moved}, "all surviving core identities")
    equal(after_target, moved, "all moved identities")
    for key, value in obj(before_stacks[CORE], CORE).items():
        if key == "Outputs":
            outputs = {item["OutputKey"]: item for item in rows(obj(after_stacks[CORE], CORE).get(key), key)}
            for output in rows(value, key):
                equal(output, outputs.get(output["OutputKey"]), "original core output")
    after_runtime = runtime(aws, {**after_core, **after_target}, legacy)
    equal(after_runtime, snapshot, "monitoring configuration and notification subscription")
    save(aws, directory, "after.private.json", {"stacks": after_stacks, "core": after_core, "monitoring": after_target, "runtime": after_runtime})
    receipt = directory / "verified.private.json"
    preparation.write_private(receipt, {"StackRefactorId": refactor, "StackIds": stack_ids, "moved": moved})
    aws.call("file-publishing", "s3api", "put-object", [
        "--bucket", BUCKET, "--key", verified_key(refactor), "--body", str(receipt),
        "--server-side-encryption", "AES256", "--if-none-match", "*",
    ])
    print(json.dumps({"StackRefactorId": refactor, "ExecutionStatus": "EXECUTE_COMPLETE", "moves": 66}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ownership", "migrate"))
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("AWS_REGION") != REGION:
        raise ValueError("Run only in the serialized eu-central-1 GitHub release job")
    os.umask(0o077)
    aws = Aws()
    if args.command == "ownership":
        state = ownership(aws)
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"state={state}\ntopology={'legacy' if state == 'legacy' else 'split'}\n")
        print(json.dumps({"monitoringOwnership": state}))
    else:
        migrate(aws, args.directory)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        print(f"Monitoring migration stopped: {error}", file=sys.stderr)
        sys.exit(1)
