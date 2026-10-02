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
ACCESS_STACK = CORE + "MonitoringRefactorAccess"
ACCESS_ROLE = f"cdk-monitoring-refactor-{ACCOUNT}-{REGION}"
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
        if not result.stdout.strip() and operation in (
            "get-stack-policy", "execute-stack-refactor", "delete-stack", "delete-object",
        ):
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
        if item.get("StackStatus") not in STABLE:
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
    retired = retired_refactors(aws)
    if CORE in current:
        source = text(obj(current[CORE], CORE)["StackId"], "source ID")
        with TemporaryDirectory(prefix="monitoring-ownership-") as directory:
            key = batches.current_manifest(aws, Path(directory), source)
            if key is not None:
                manifest, receipts = batches.verified_prefix(aws, Path(directory), key, retired)
                if len(receipts) == 4:
                    batches.final_ownership(aws, manifest, receipts)
                    if "CDKMetadata" in inventory(aws, TARGET):
                        return "split"
                batches.prove_prefix(aws, manifest, receipts)
                return "finalizing" if len(receipts) == 4 else "partial"
    unexplained = set(relevant_refactors(aws)) - retired
    if unexplained:
        raise ValueError(f"Unexplained monitoring refactors {sorted(unexplained)}; preserve evidence and stop")
    if not current:
        return "fresh"
    if CORE not in current:
        raise ValueError("Monitoring exists without core; inspect ownership")
    core = selected(inventory(aws, CORE))
    target_resources = inventory(aws, TARGET) if TARGET in current else {}
    target = selected(target_resources)
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
            if status in STABLE:
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


def save(aws: Aws, directory: Path, name: str, value: Json) -> str:
    path = directory / name
    preparation.write_private(path, value)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    key = f"monitoring-refactor/{os.environ['GITHUB_RUN_ID']}/{os.environ['GITHUB_RUN_ATTEMPT']}/{digest}/{name}"
    aws.call("file-publishing", "s3api", "put-object", ["--bucket", BUCKET, "--key", key, "--body", str(path), "--server-side-encryption", "AES256"])
    return f"https://{BUCKET}.s3.{REGION}.amazonaws.com/{key}"


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


def wait_stack(aws: Aws, stack_id: str, desired: str) -> dict[str, Json]:
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        found = rows(aws.cf("describe-stacks", ["--stack-name", stack_id]).get("Stacks"), stack_id)
        equal(len(found), 1, "stack count")
        equal(found[0].get("StackId"), stack_id, "stack identity")
        state = found[0].get("StackStatus")
        if state == desired:
            return found[0]
        if state not in ("CREATE_IN_PROGRESS", "DELETE_IN_PROGRESS"):
            raise ValueError(f"{stack_id}: expected {desired}, received {json.dumps(found[0])}")
        time.sleep(5)
    raise ValueError(f"{stack_id}: timed out waiting for {desired}; inspect before retrying")


def access_template(source: str, resources: dict[str, Json]) -> dict[str, Json]:
    alarms = sorted(f"arn:aws:cloudwatch:{REGION}:{ACCOUNT}:alarm:" + text(
        obj(value, key).get("PhysicalResourceId"), key) for key, value in resources.items()
        if obj(value, key).get("ResourceType") == "AWS::CloudWatch::Alarm")
    equal(len(alarms), 58, "temporary caller alarm scope")
    return {"Resources": {"NativeCaller": {"Type": "AWS::IAM::Role", "Properties": {
        "RoleName": ACCESS_ROLE,
        "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{
            "Effect": "Allow", "Principal": {"AWS": f"arn:aws:iam::{ACCOUNT}:role/flashcards-open-source-app-github-deploy"},
            "Action": "sts:AssumeRole",
        }]},
        "ManagedPolicyArns": ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
        "Policies": [{"PolicyName": "MonitoringNativeMove", "PolicyDocument": {
            "Version": "2012-10-17", "Statement": [
                {"Effect": "Allow", "Action": ["cloudformation:CreateStackRefactor", "cloudformation:ExecuteStackRefactor"],
                 "Resource": [source, f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{TARGET}/*"]},
                {"Effect": "Allow", "Action": ["cloudwatch:TagResource", "cloudwatch:UntagResource"], "Resource": alarms},
            ],
        }}],
    }}}}


def access_stack(aws: Aws) -> dict[str, Json] | None:
    found = [row for row in rows(aws.cf("describe-stacks", []).get("Stacks"), "stacks")
             if row.get("StackName") == ACCESS_STACK]
    if len(found) > 1:
        raise ValueError("Multiple temporary access stacks")
    return found[0] if found else None


def verify_access(aws: Aws, stack: dict[str, Json], expected: dict[str, Json]) -> str:
    stack_id = text(stack.get("StackId"), "access StackId")
    if not stack_id.startswith(f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{ACCESS_STACK}/"):
        raise ValueError("Unexpected temporary access stack identity")
    equal(stack.get("RoleARN"), CORE_EXECUTION_ROLE, "access execution role")
    equal(template(aws, stack_id), expected, "temporary access template")
    equal(inventory(aws, stack_id), {"NativeCaller": {
        "PhysicalResourceId": ACCESS_ROLE, "ResourceType": "AWS::IAM::Role",
    }}, "temporary access resources")
    return stack_id


def prepare_native_caller(aws: Aws, directory: Path, source: str, resources: dict[str, Json]) -> None:
    expected = access_template(source, resources)
    stack = access_stack(aws)
    if stack is None:
        raise ValueError("The reviewed monitoring refactor access stack must already exist; do not create or expand IAM")
    equal(stack.get("StackStatus"), "CREATE_COMPLETE", "temporary access status")
    verify_access(aws, stack, expected)
    deadline = time.monotonic() + 120
    while True:
        try:
            credentials = obj(aws.call("original", "sts", "assume-role", [
                "--role-arn", f"arn:aws:iam::{ACCOUNT}:role/{ACCESS_ROLE}",
                "--role-session-name", "monitoring-native-move", "--duration-seconds", "3600",
            ]).get("Credentials"), "native Credentials")
            break
        except RuntimeError as error:
            if "AccessDenied" not in str(error) or time.monotonic() >= deadline:
                raise
            print(f"::warning::Waiting for temporary role propagation: {error}", flush=True)
            time.sleep(5)
    aws.environments["native"] = dict(aws.original, **{
        key: text(credentials[field], field) for key, field in (
            ("AWS_ACCESS_KEY_ID", "AccessKeyId"), ("AWS_SECRET_ACCESS_KEY", "SecretAccessKey"),
            ("AWS_SESSION_TOKEN", "SessionToken"),
        )
    })
    databases = [text(obj(value, key)["PhysicalResourceId"], key) for key, value in resources.items()
                 if obj(value, key).get("ResourceType") == "AWS::RDS::DBInstance"]
    equal(len(databases), 1, "original database count")
    caller = aws.call("native", "sts", "get-caller-identity", [])
    equal(caller.get("Account"), ACCOUNT, "native caller account")
    equal(caller.get("Arn"), f"arn:aws:sts::{ACCOUNT}:assumed-role/{ACCESS_ROLE}/monitoring-native-move",
          "native caller identity")
    source_stacks = rows(aws.cf("describe-stacks", ["--stack-name", source]).get("Stacks"), "native source")
    equal(len(source_stacks), 1, "native source count")
    equal(source_stacks[0].get("StackId"), source, "native source identity")
    equal(source_stacks[0].get("RoleARN"), CORE_EXECUTION_ROLE, "native source execution role")
    save(aws, directory, "native-roles.private.json", {
        "caller": caller, "sourceStackId": source, "sourceExecutionRole": source_stacks[0]["RoleARN"],
        "accessExecutionRole": stack["RoleARN"], "database": databases[0],
    })
    print(json.dumps({"nativeCallerRole": ACCESS_ROLE,
                      "storedExecutionRole": CORE_EXECUTION_ROLE.rsplit("/", 1)[1],
                      "stage": "native caller RDS preflight"}), flush=True)
    described = rows(aws.call("native", "rds", "describe-db-instances", [
        "--db-instance-identifier", databases[0],
    ]).get("DBInstances"), "native RDS preflight")
    equal(len(described), 1, "native RDS preflight count")
    equal(described[0].get("DBInstanceIdentifier"), databases[0], "native RDS preflight identity")
    print(json.dumps({"nativeCallerRole": ACCESS_ROLE, "rdsDescribePreflight": "passed"}), flush=True)


def cleanup_access(aws: Aws) -> None:
    if ownership(aws) not in ("split", "finalizing"):
        raise ValueError("Full verified monitoring ownership is required before access cleanup")
    stack = access_stack(aws)
    if stack is None:
        return
    source = text(obj(stacks(aws)[CORE], CORE)["StackId"], "source StackId")
    stack_id = verify_access(aws, stack, access_template(source, inventory(aws, TARGET)))
    if stack.get("StackStatus") == "CREATE_COMPLETE":
        aws.call("deploy", "cloudformation", "delete-stack", [
            "--stack-name", stack_id, "--role-arn", CORE_EXECUTION_ROLE,
        ])
    elif stack.get("StackStatus") != "DELETE_IN_PROGRESS":
        raise ValueError(f"Unexpected access cleanup state: {stack.get('StackStatus')}")
    wait_stack(aws, stack_id, "DELETE_COMPLETE")


def save_failure(aws: Aws, directory: Path, stage: str, error: Exception) -> None:
    try:
        current = {text(row.get("StackName"), "StackName"): row
                   for row in rows(aws.cf("describe-stacks", []).get("Stacks"), "failure stacks")
                   if row.get("StackName") in (CORE, TARGET)}
        save(aws, directory, stage + "-failure.private.json", {
            "error": str(error), "stacks": current,
            "resources": {name: inventory(aws, text(obj(row, name)["StackId"], name))
                          for name, row in current.items()},
        })
    except (ValueError, OSError, RuntimeError) as evidence_error:
        print(f"::warning::Could not save failure ownership evidence: {evidence_error}", flush=True)


def reviewed_status(aws: Aws) -> dict[str, Json]:
    relevant = relevant_refactors(aws)
    if REVIEWED_REFACTOR not in relevant:
        raise ValueError(f"Refactor {REVIEWED_REFACTOR}: reviewed operation disappeared")
    for refactor, details in relevant.items():
        if refactor != REVIEWED_REFACTOR:
            equal(details.get("ExecutionStatus"), "EXECUTE_COMPLETE", f"{refactor}/other relevant refactor")
            read_verified_receipt(aws, refactor)
    status = relevant[REVIEWED_REFACTOR]
    equal(status.get("StackRefactorId"), REVIEWED_REFACTOR, "reviewed operation identity")
    equal(refactor_stack_ids(status, REVIEWED_STACKS[CORE]), REVIEWED_STACKS, "reviewed stack IDs")
    equal(status.get("Status"), "CREATE_COMPLETE", f"{REVIEWED_REFACTOR}/Status")
    return status


def reviewed_evidence(aws: Aws, directory: Path) -> dict[str, dict[str, Json]]:
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    evidence: dict[str, dict[str, Json]] = {}
    prefix = f"monitoring-refactor/{REVIEWED_SCHEMA_ANCHOR['runId']}/{REVIEWED_SCHEMA_ANCHOR['runAttempt']}"
    for name, digest in REVIEWED_EVIDENCE.items():
        path = directory / name
        aws.call("file-publishing", "s3api", "get-object", [
            "--bucket", BUCKET, "--key", f"{prefix}/{digest}/{name}", str(path),
        ])
        equal(hashlib.sha256(path.read_bytes()).hexdigest(), digest, f"reviewed evidence hash/{name}")
        evidence[name] = obj(json.loads(path.read_text()), name)
    equal(evidence["operation.private.json"].get("StackRefactorId"), REVIEWED_REFACTOR, "private operation binding")
    return evidence


def recovery_snapshot(aws: Aws, baseline: dict[str, Json], target_status: str) -> dict[str, Json]:
    status = reviewed_status(aws)
    equal(status.get("ExecutionStatus"), "ROLLBACK_FAILED", "recovery native status")
    original = obj(obj(baseline.get("stacks"), "original stacks").get(CORE), CORE)
    equal(original.get("StackId"), REVIEWED_STACKS[CORE], "recovery original core ID")
    equal(original.get("RoleARN"), CORE_EXECUTION_ROLE, "recovery original execution role")
    before = obj(baseline.get("resources"), "original resources")
    equal(len(before), 497, "recovery original resource count")
    resources = rows(aws.cf("list-stack-resources", [
        "--stack-name", REVIEWED_STACKS[CORE],
    ]).get("StackResourceSummaries"), "recovery resource statuses")
    equal(len(resources), 497, "recovery live resource count")
    failures = [{key: item.get(key) for key in (
        "LogicalResourceId", "ResourceType", "ResourceStatus", "LastUpdatedTimestamp", "ResourceStatusReason",
    )} for item in resources if item.get("ResourceStatus") == "UPDATE_FAILED"]
    equal(len(failures), 22, "reviewed historical alarm failure count")
    fingerprint = json.dumps(sorted(failures, key=lambda item: text(item["LogicalResourceId"], "alarm ID")),
                             sort_keys=True)
    equal(hashlib.sha256(fingerprint.encode()).hexdigest(), REVIEWED_ALARM_FAILURES_HASH,
          "reviewed historical alarm failure identities/timestamps/reasons")
    for resource in resources:
        if resource.get("ResourceStatus") == "UPDATE_FAILED":
            equal(resource.get("ResourceType"), "AWS::CloudWatch::Alarm", "failed alarm type")
            continue
        if resource.get("ResourceStatus") not in (
            "CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE", "UPDATE_ROLLBACK_COMPLETE",
        ):
            raise ValueError(f"Recovery unsafe resource: {resource.get('LogicalResourceId')} "
                             f"{resource.get('ResourceStatus')}: {resource.get('ResourceStatusReason')}")
    current = inventory(aws, REVIEWED_STACKS[CORE])
    equal(current, before, "recovery all original identities")
    equal(inventory(aws, REVIEWED_STACKS[TARGET]), {}, "recovery empty target")
    legacy = template(aws, REVIEWED_STACKS[CORE])
    equal(legacy, baseline.get("template"), "recovery original template")
    configuration = runtime(aws, current, legacy)
    equal(configuration, baseline.get("runtime"), "recovery original alarm/filter/SNS configuration")
    current_stacks: dict[str, Json] = {}
    for name, stack_id in REVIEWED_STACKS.items():
        found = rows(aws.cf("describe-stacks", ["--stack-name", stack_id]).get("Stacks"), name)
        equal(len(found), 1, f"recovery {name}/count")
        for field, expected in (("StackId", stack_id), ("StackName", name),
                                ("StackStatus", "UPDATE_ROLLBACK_COMPLETE" if name == CORE else target_status)):
            equal(found[0].get(field), expected, f"recovery {name}/{field}")
        current_stacks[name] = found[0]
    equal(stack_settings(obj(current_stacks[CORE], CORE)), stack_settings(original), "recovery core settings")
    return {"operation": status, "stacks": current_stacks, "resources": current,
            "resourceStatuses": resources, "template": legacy, "runtime": configuration}


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
    deleted = wait_stack(aws, REVIEWED_STACKS[TARGET], "DELETE_COMPLETE")
    equal(deleted.get("StackName"), TARGET, "deleted target name")
    equal(inventory(aws, REVIEWED_STACKS[TARGET]), {}, "deleted target resources")
    source = rows(aws.cf("describe-stacks", ["--stack-name", CORE]).get("Stacks"), CORE)
    equal(len(source), 1, "retired attempt source count")
    equal(source[0].get("StackId"), REVIEWED_STACKS[CORE], "retired attempt source identity")
    return True


def reconcile(aws: Aws, directory: Path) -> str:
    relevant = relevant_refactors(aws)
    retired = REVIEWED_REFACTOR in relevant and aborted_attempt(aws, relevant[REVIEWED_REFACTOR])
    if REVIEWED_REFACTOR not in relevant or retired:
        if ownership(aws) == "split":
            cleanup_access(aws)
        return REVIEWED_SCHEMA_ANCHOR["commit"] if retired else ""
    status = reviewed_status(aws)
    equal(status.get("ExecutionStatus"), "ROLLBACK_FAILED", "failed attempt status")
    baseline = reviewed_evidence(aws, directory)["before.private.json"]
    target = rows(aws.cf("describe-stacks", ["--stack-name", REVIEWED_STACKS[TARGET]]).get("Stacks"), TARGET)
    equal(len(target), 1, "failed target count")
    target_status = text(target[0].get("StackStatus"), "failed target status")
    if target_status == "UPDATE_ROLLBACK_COMPLETE":
        before = recovery_snapshot(aws, baseline, target_status)
        save(aws, directory, "abort-before.private.json", before)
        aws.call("deploy", "cloudformation", "delete-stack", [
            "--stack-name", REVIEWED_STACKS[TARGET], "--role-arn", CORE_EXECUTION_ROLE,
        ])
    elif target_status in ("DELETE_IN_PROGRESS", "DELETE_COMPLETE"):
        recovery_snapshot(aws, baseline, target_status)
    else:
        raise ValueError(f"Unexpected original target state: {target_status}")
    wait_stack(aws, REVIEWED_STACKS[TARGET], "DELETE_COMPLETE")
    after = recovery_snapshot(aws, baseline, "DELETE_COMPLETE")
    evidence = save(aws, directory, "abort-after.private.json", after)
    receipt = directory / "aborted.private.json"
    preparation.write_private(receipt, {
        "StackRefactorId": REVIEWED_REFACTOR, "StackIds": REVIEWED_STACKS,
        "baselineHash": REVIEWED_EVIDENCE["before.private.json"], "outcome": "EMPTY_TARGET_DELETED",
        "preservationEvidence": evidence, "schemaAnchor": REVIEWED_SCHEMA_ANCHOR,
    })
    aws.call("file-publishing", "s3api", "put-object", [
        "--bucket", BUCKET, "--key", aborted_key(), "--body", str(receipt),
        "--server-side-encryption", "AES256", "--if-none-match", "*",
    ])
    equal(ownership(aws), "legacy", "reconciled ownership")
    return REVIEWED_SCHEMA_ANCHOR["commit"]


def remember_manifest(directory: Path, key: str) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / "manifest-key.private.txt"
    path.write_text(key + "\n")
    path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("ownership", "reconcile", "prepare", "batch", "finalize"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--manifest", default="")
    parser.add_argument("--resume-manifest", default="")
    parser.add_argument("--batch-index", type=int, choices=range(1, 5))
    parser.add_argument("--assembly", type=Path)
    args = parser.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("AWS_REGION") != REGION:
        raise ValueError("Run only in the serialized eu-central-1 GitHub release job")
    os.umask(0o077)
    aws = Aws()
    commit, run, attempt = (text(os.environ.get(name), name) for name in (
        "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    if args.command == "ownership":
        state = ownership(aws)
        if args.manifest and state not in ("partial", "finalizing"):
            raise ValueError("Explicit monitoring continuation requires a pending native migration")
        if state in ("partial", "finalizing"):
            source = text(obj(stacks(aws)[CORE], CORE)["StackId"], "source ID")
            key = batches.current_manifest(aws, args.directory, source)
            if not args.manifest:
                manifest = batches.load_manifest(aws, args.directory, text(key, "bound manifest"))
                raise ValueError(f"Verified migration pending; dispatch AWS/Web Release at commit {manifest['commit']} "
                                 f"with monitoring_manifest={key}. No ordinary deployments are permitted")
            batches.authorize_resume(aws, args.directory, source, args.manifest, commit, retired_refactors(aws))
            remember_manifest(args.directory, args.manifest)
            state = "resume"
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"state={state}\ntopology={'legacy' if state == 'legacy' else 'split'}\n")
        print(json.dumps({"monitoringOwnership": state}))
    elif args.command == "reconcile":
        preview_anchor = preview.reconcile(aws, args.directory / "preview")
        retry_anchor = retry.reconcile(aws, args.directory / "retry")
        original_anchor = reconcile(aws, args.directory / "original")
        ownership(aws)
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"schema_anchor={preview_anchor or retry_anchor or original_anchor}\n")
    elif args.command == "prepare":
        equal(ownership(aws), "legacy", "fresh preparation ownership")
        key = batches.prepare(aws, args.directory, commit, run, attempt, retired_refactors(aws))
        remember_manifest(args.directory, key)
    elif args.command == "batch":
        if args.batch_index is None:
            raise ValueError("batch requires --batch-index 1..4")
        try:
            batches.run_batch(aws, args.directory, text(args.manifest, "manifest"), args.batch_index,
                              commit, run, attempt, args.resume_manifest, retired_refactors(aws))
        except (ValueError, RuntimeError) as error:
            save_failure(aws, args.directory, f"batch-{args.batch_index}", error)
            raise
    else:
        if args.assembly is None:
            raise ValueError("finalize requires --assembly with the standard cdk.out directory")
        manifest, receipts = batches.verified_prefix(aws, args.directory, text(args.manifest, "manifest"), retired_refactors(aws))
        equal(manifest["commit"], commit, "finalize exact commit")
        if [run, attempt] != [manifest["run"], manifest["attempt"]] or args.resume_manifest:
            equal(args.resume_manifest, args.manifest, "finalize explicit same-commit resume")
        equal(len(receipts), 4, "four verified batches before ordinary deployment")
        batches.prove_prefix(aws, manifest, receipts)
        batches.verify_assembly(manifest, args.assembly)
        cleanup_access(aws)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError) as error:
        print(f"Monitoring migration stopped: {error}", file=sys.stderr)
        sys.exit(1)
