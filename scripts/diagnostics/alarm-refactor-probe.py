#!/usr/bin/env python3
"""Manual CI experiment using only disposable resources and existing bootstrap roles."""

from collections import Counter
import html
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from typing import TypeAlias

Json: TypeAlias = bool | int | float | str | None | list["Json"] | dict[str, "Json"]
ACCOUNT = "506210661494"
REGION = "eu-central-1"
PREFIX = "FlashcardsAlarmRefactorProbe-"
EXECUTION_ROLE = f"arn:aws:iam::{ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-{ACCOUNT}-{REGION}"
DIRECTORY = Path("alarm-refactor-probe-results")
STABLE = {"CREATE_COMPLETE", "CREATE_FAILED", "ROLLBACK_COMPLETE", "ROLLBACK_FAILED",
          "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "IMPORT_COMPLETE", "IMPORT_ROLLBACK_COMPLETE", "DELETE_FAILED"}


def obj(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def text(value: Json) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("Expected a nonempty string")
    return value


def rows(value: Json) -> list[dict[str, Json]]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON array")
    return [obj(item) for item in value]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def save(report: dict[str, Json]) -> None:
    temporary = DIRECTORY / "results.tmp"
    temporary.write_text(json.dumps(report, indent=2) + "\n")
    temporary.replace(DIRECTORY / "results.json")


class Aws:
    def __init__(self) -> None:
        self.environments = {"original": dict(os.environ, AWS_RETRY_MODE="standard", AWS_MAX_ATTEMPTS="3")}
        require(self.call("original", "sts", "get-caller-identity", {}).get("Account") == ACCOUNT,
                "Wrong AWS account; no writes allowed")
        for role in ("deploy", "lookup"):
            credentials = obj(self.call("original", "sts", "assume-role", {
                "RoleArn": f"arn:aws:iam::{ACCOUNT}:role/cdk-hnb659fds-{role}-role-{ACCOUNT}-{REGION}",
                "RoleSessionName": "alarm-refactor-probe", "DurationSeconds": 3600,
            }).get("Credentials"))
            self.environments[role] = dict(self.environments["original"], **{
                key: text(credentials.get(field)) for key, field in (
                    ("AWS_ACCESS_KEY_ID", "AccessKeyId"), ("AWS_SECRET_ACCESS_KEY", "SecretAccessKey"),
                    ("AWS_SESSION_TOKEN", "SessionToken"),
                )
            })
            require(self.call(role, "sts", "get-caller-identity", {}).get("Account") == ACCOUNT,
                    "Wrong assumed-role account")

    def call(self, role: str, service: str, operation: str, request: dict[str, Json]) -> dict[str, Json]:
        result = subprocess.run(
            ["aws", service, operation, "--region", REGION, "--output", "json", "--no-cli-pager",
             "--cli-connect-timeout", "10", "--cli-read-timeout", "30", "--cli-input-json", json.dumps(request)],
            env=self.environments[role], capture_output=True, text=True, check=False, timeout=100,
        )
        if result.returncode:
            message = result.stderr.strip()
            for environment in self.environments.values():
                for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
                    if environment.get(key):
                        message = message.replace(environment[key], "[REDACTED]")
            raise RuntimeError(f"{role} {service}/{operation}: {message}")
        return obj(json.loads(result.stdout)) if result.stdout.strip() else {}

    def cf(self, operation: str, request: dict[str, Json]) -> dict[str, Json]:
        return self.call("lookup", "cloudformation", operation, request)


def stack_id(identifier: str, name: str) -> str:
    require(re.fullmatch(PREFIX + r"[0-9]+-[0-9]+-[a-z-]+-(source|target)", name) is not None,
            "Unsafe probe stack name")
    require(identifier.startswith(f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:stack/{name}/")
            and re.fullmatch(r"[a-f0-9-]+", identifier.rsplit("/", 1)[-1]) is not None,
            "Unsafe probe stack ID")
    return identifier


def describe(aws: Aws, identifier: str, name: str) -> dict[str, Json]:
    stack_id(identifier, name)
    found = rows(aws.cf("describe-stacks", {"StackName": identifier}).get("Stacks"))
    require(len(found) == 1 and found[0].get("StackId") == identifier and found[0].get("StackName") == name,
            "Stack identity changed")
    require(found[0].get("RoleARN") == EXECUTION_ROLE, "Unexpected stack execution role")
    return found[0]


def wait_stack(aws: Aws, identifier: str, name: str, desired: str) -> dict[str, Json]:
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        current = describe(aws, identifier, name)
        status = text(current.get("StackStatus"))
        if status == desired:
            return current
        require(status.endswith("_IN_PROGRESS"), f"Stack {identifier}: {status}: {current.get('StackStatusReason')}")
        time.sleep(5)
    raise TimeoutError(f"Stack {identifier} did not reach {desired}")


def inventory(aws: Aws, identifier: str) -> list[dict[str, Json]]:
    return rows(aws.cf("list-stack-resources", {"StackName": identifier}).get("StackResourceSummaries"))


def template(resources: dict[str, Json]) -> dict[str, Json]:
    return {"AWSTemplateFormatVersion": "2010-09-09", "Resources": resources}


def definition(case_name: str, variant: str) -> dict[str, Json]:
    if variant == "sns-control":
        return {"Type": "AWS::SNS::Topic", "Properties": {"TopicName": case_name + "-move"}}
    properties: dict[str, Json] = {
        "Namespace": "FlashcardsAlarmRefactorProbe/Unpublished", "MetricName": case_name,
        "ComparisonOperator": "GreaterThanThreshold", "Threshold": 1, "Period": 60,
        "EvaluationPeriods": 1, "Statistic": "Sum", "TreatMissingData": "notBreaching",
        "ActionsEnabled": False,
    }
    if "explicit-" in variant:
        properties["AlarmName"] = case_name + "-alarm"
    if variant.endswith("-empty"):
        properties["Tags"] = []
    elif variant.endswith("-tagged"):
        properties["Tags"] = [{"Key": "Probe", "Value": "alarm-refactor"}]
    return {"Type": "AWS::CloudWatch::Alarm", "Properties": properties}


def expected_physical(case_name: str, resource: dict[str, Json], moving: dict[str, Json], side: str) -> None:
    logical = text(resource.get("LogicalResourceId"))
    require(logical in ("Anchor", "ProbeResource"), "Unknown logical resource; refusing cleanup")
    expected_type = "AWS::SNS::Topic" if logical == "Anchor" else moving["Type"]
    require(resource.get("ResourceType") == expected_type, "Unknown resource type; refusing cleanup")
    physical = resource.get("PhysicalResourceId")
    if physical is None:
        require(resource.get("ResourceStatus") in ("CREATE_FAILED", "DELETE_COMPLETE"),
                "Resource has no physical identity")
        return
    physical = text(physical)
    if logical == "Anchor":
        expected = f"arn:aws:sns:{REGION}:{ACCOUNT}:{case_name}-{side}-anchor"
        require(physical == expected, "Unknown anchor identity")
    elif expected_type == "AWS::SNS::Topic":
        require(physical == f"arn:aws:sns:{REGION}:{ACCOUNT}:{case_name}-move", "Unknown topic identity")
    elif "AlarmName" in obj(moving["Properties"]):
        require(physical == case_name + "-alarm", "Unknown named alarm identity")
    else:
        require(physical.startswith(case_name + "-source-ProbeResource-")
                and re.fullmatch(r"[A-Za-z0-9-]+", physical) is not None, "Unknown generated alarm identity")


def snapshot(aws: Aws, case_name: str, stacks: dict[str, str], moving: dict[str, Json]) -> dict[str, Json]:
    result: dict[str, Json] = {}
    for side, identifier in stacks.items():
        resources = inventory(aws, identifier)
        for resource in resources:
            expected_physical(case_name, resource, moving, side)
        result[side] = {"stack": describe(aws, identifier, case_name + "-" + side), "resources": resources}
    return result


def resource_tags(aws: Aws, physical: str, kind: str) -> dict[str, Json]:
    if kind == "AWS::CloudWatch::Alarm":
        alarms = rows(aws.call("lookup", "cloudwatch", "describe-alarms", {"AlarmNames": [physical]}).get("MetricAlarms"))
        require(len(alarms) == 1 and alarms[0].get("AlarmName") == physical, "Probe alarm missing")
        require(all(not alarms[0].get(key) for key in ("AlarmActions", "OKActions", "InsufficientDataActions")),
                "Probe alarm unexpectedly has actions")
        require(alarms[0].get("Namespace") == "FlashcardsAlarmRefactorProbe/Unpublished"
                and alarms[0].get("ActionsEnabled") is False
                and alarms[0].get("TreatMissingData") == "notBreaching", "Unexpected alarm configuration")
        arn = text(alarms[0].get("AlarmArn"))
        require(arn == f"arn:aws:cloudwatch:{REGION}:{ACCOUNT}:alarm:{physical}", "Wrong alarm ARN")
        transient = {"StateValue", "StateReason", "StateReasonData", "StateUpdatedTimestamp",
                     "StateTransitionedTimestamp", "AlarmConfigurationUpdatedTimestamp", "EvaluationState"}
        return {**aws.call("lookup", "cloudwatch", "list-tags-for-resource", {"ResourceARN": arn}),
                "configuration": {key: value for key, value in alarms[0].items() if key not in transient}}
    require(physical.startswith(f"arn:aws:sns:{REGION}:{ACCOUNT}:{PREFIX}"), "Wrong topic ARN")
    require(not rows(aws.call("lookup", "sns", "list-subscriptions-by-topic", {"TopicArn": physical}).get("Subscriptions")),
            "Probe topic unexpectedly has subscriptions")
    return aws.call("lookup", "sns", "list-tags-for-resource", {"ResourceArn": physical})


def wait_refactor(aws: Aws, refactor: str, stacks: dict[str, str], report: dict[str, Json], case: dict[str, Json],
                  terminal: tuple[str, ...]) -> dict[str, Json]:
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        status = aws.cf("describe-stack-refactor", {"StackRefactorId": refactor})
        case["refactor"] = status
        save(report)
        require(status.get("StackRefactorId") == refactor and set(status.get("StackIds", [])) == set(stacks.values()),
                "Refactor includes unexpected stack IDs")
        execution = status.get("ExecutionStatus")
        if status.get("Status") == "CREATE_FAILED" or execution in terminal:
            return status
        require(status.get("Status") in ("CREATE_IN_PROGRESS", "CREATE_COMPLETE") and execution in (
            "UNAVAILABLE", "AVAILABLE", "EXECUTE_IN_PROGRESS", "ROLLBACK_IN_PROGRESS",
        ), "Unexpected refactor state; preserve evidence")
        time.sleep(5)
    raise TimeoutError(f"Refactor {refactor} did not reach a terminal state")


def validate_preview(actions: dict[str, Json], stacks: dict[str, str], case_name: str, physical: str) -> None:
    changes = rows(actions.get("StackRefactorActions"))
    require(len(changes) == 1 and not actions.get("NextToken"), "Expected exactly one refactor action")
    action = changes[0]
    require(action.get("Action") == "MOVE" and action.get("Entity") == "RESOURCE"
            and action.get("PhysicalResourceId") == physical, "Expected the probe resource MOVE only")
    mapping = obj(action.get("ResourceMapping"))
    for label, side in (("Source", "source"), ("Destination", "target")):
        location = obj(mapping.get(label))
        require(location.get("StackName") in (stacks[side], case_name + "-" + side)
                and location.get("LogicalResourceId") == "ProbeResource", "Unexpected resource mapping")
    tags = {"aws:cloudformation:stack-name": case_name + "-target",
            "aws:cloudformation:stack-id": stacks["target"], "aws:cloudformation:logical-id": "ProbeResource"}
    for tag in rows(action.get("TagResources", [])):
        require(tag.get("Key") in tags and tag.get("Value") == tags[text(tag.get("Key"))], "Unexpected preview tag")
    removed = action.get("UntagResources", [])
    require(isinstance(removed, list) and all(tag in tags for tag in removed), "Unexpected tag removal")


def classify(reason: str) -> str:
    lower = reason.lower()
    if any(word in lower for word in ("accessdenied", "access denied", "not authorized", "unauthorized", "permission")):
        return "inconclusive-permission"
    if any(word in lower for word in ("unsupported", "not supported", "does not support")):
        return "unsupported"
    return "inconclusive-infrastructure"


def cleanup(aws: Aws, case_name: str, stacks: dict[str, str], moving: dict[str, Json],
            report: dict[str, Json], case: dict[str, Json]) -> None:
    cleanup_report: dict[str, Json] = {"verified": False, "unresolvedStackIds": list(stacks.values())}
    case["cleanup"] = cleanup_report
    save(report)
    if case.get("unsafeRefactor") or case.get("retainedAlarm"):
        raise ValueError("Unsafe operation or retained alarm; preserving exact probe identities for inspection")
    before = snapshot(aws, case_name, stacks, moving)
    cleanup_report["before"] = before
    save(report)
    for side, identifier in stacks.items():
        require(obj(obj(before[side])["stack"]).get("StackStatus") in STABLE,
                f"Unstable stack {identifier}; refusing deletion")
    for side, identifier in reversed(list(stacks.items())):
        name = case_name + "-" + side
        stack_id(identifier, name)
        for resource in inventory(aws, identifier):
            expected_physical(case_name, resource, moving, side)
        aws.call("deploy", "cloudformation", "delete-stack", {"StackName": identifier, "RoleARN": EXECUTION_ROLE})
        cleanup_report[side] = wait_stack(aws, identifier, name, "DELETE_COMPLETE")
        cleanup_report["unresolvedStackIds"] = [value for value in stacks.values()
                                                if value != identifier and value not in [
                                                    obj(cleanup_report[key]).get("StackId")
                                                    for key in ("source", "target") if key in cleanup_report]]
        save(report)
    physical = case.get("physicalId")
    if isinstance(physical, str):
        if moving["Type"] == "AWS::CloudWatch::Alarm":
            require(not rows(aws.call("lookup", "cloudwatch", "describe-alarms", {"AlarmNames": [physical]}).get("MetricAlarms")),
                    "Deleted stacks left an orphan probe alarm")
        else:
            try:
                aws.call("lookup", "sns", "get-topic-attributes", {"TopicArn": physical})
            except RuntimeError as error:
                require("NotFound" in str(error), str(error))
            else:
                raise ValueError("Deleted stacks left an orphan probe topic")
    cleanup_report["verified"] = True
    save(report)


def update(aws: Aws, identifier: str, name: str, body: dict[str, Json]) -> None:
    stack_id(identifier, name)
    aws.call("deploy", "cloudformation", "update-stack", {
        "StackName": identifier, "TemplateBody": json.dumps(body), "RoleARN": EXECUTION_ROLE,
    })
    wait_stack(aws, identifier, name, "UPDATE_COMPLETE")
    stored = aws.cf("get-template", {"StackName": identifier, "TemplateStage": "Original"}).get("TemplateBody")
    require((json.loads(stored) if isinstance(stored, str) else stored) == body, "Updated template differs")


def wait_change_set(aws: Aws, identifier: str, change_set: str, case: dict[str, Json], report: dict[str, Json]) -> dict[str, Json]:
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        response = aws.cf("describe-change-set", {"StackName": identifier, "ChangeSetName": change_set})
        case["importPreview"] = response
        save(report)
        require(response.get("StackId") == identifier, "Import preview changed stack")
        if response.get("Status") == "CREATE_COMPLETE":
            return response
        require(response.get("Status") in ("CREATE_PENDING", "CREATE_IN_PROGRESS"),
                f"Import preview failed: {response.get('StatusReason')}")
        time.sleep(5)
    raise TimeoutError("Import change set did not become available")


def run_import(aws: Aws, case_name: str, stacks: dict[str, str], moving: dict[str, Json],
               initial: dict[str, Json], final: dict[str, Json], report: dict[str, Json], case: dict[str, Json]) -> None:
    physical = text(case["physicalId"])
    retained = {**moving, "DeletionPolicy": "Retain"}
    source_retained = template({**obj(obj(initial["source"])["Resources"]), "ProbeResource": retained})
    target_retained = template({**obj(obj(final["target"])["Resources"]), "ProbeResource": retained})
    case["stage"] = "retain-policy"
    case["retainedAlarm"] = {"AlarmName": physical, "AlarmArn": f"arn:aws:cloudwatch:{REGION}:{ACCOUNT}:alarm:{physical}"}
    save(report)
    update(aws, stacks["source"], case_name + "-source", source_retained)
    case["stage"] = "detach"
    save(report)
    update(aws, stacks["source"], case_name + "-source", obj(final["source"]))
    detached = snapshot(aws, case_name, stacks, moving)
    require(all(row["LogicalResourceId"] == "Anchor" for row in rows(obj(detached["source"])["resources"])),
            "Source did not detach exactly the probe alarm")
    case["detached"] = detached
    case["tagsDetached"] = resource_tags(aws, physical, "AWS::CloudWatch::Alarm")
    require(obj(case["tagsDetached"])["configuration"] == obj(case["tagsBefore"])["configuration"],
            "Retain/detach changed alarm configuration")
    case["stage"] = "import"
    save(report)
    change_name = case_name + "-import"
    response = aws.call("deploy", "cloudformation", "create-change-set", {
        "StackName": stacks["target"], "ChangeSetName": change_name, "ChangeSetType": "IMPORT",
        "TemplateBody": json.dumps(target_retained), "RoleARN": EXECUTION_ROLE,
        "ResourcesToImport": [{"ResourceType": "AWS::CloudWatch::Alarm", "LogicalResourceId": "ProbeResource",
                               "ResourceIdentifier": {"AlarmName": physical}}],
    })
    change_set = text(response.get("Id"))
    require(change_set.startswith(f"arn:aws:cloudformation:{REGION}:{ACCOUNT}:changeSet/{change_name}/"),
            "Unexpected import change set ID")
    case["changeSetId"] = change_set
    save(report)
    preview = wait_change_set(aws, stacks["target"], change_set, case, report)
    changes = rows(preview.get("Changes"))
    require(len(changes) == 1 and not preview.get("NextToken"), "Expected exactly one import change")
    change = obj(changes[0].get("ResourceChange"))
    require(change.get("Action") == "Import" and change.get("LogicalResourceId") == "ProbeResource"
            and change.get("ResourceType") == "AWS::CloudWatch::Alarm", "Unexpected import change")
    aws.call("deploy", "cloudformation", "execute-change-set", {
        "StackName": stacks["target"], "ChangeSetName": change_set,
    })
    wait_stack(aws, stacks["target"], case_name + "-target", "IMPORT_COMPLETE")
    case["afterImport"] = snapshot(aws, case_name, stacks, moving)
    imported = {text(row["LogicalResourceId"]): row["PhysicalResourceId"]
                for row in rows(obj(obj(case["afterImport"])["target"])["resources"])}
    require(imported == {"ProbeResource": physical,
                         "Anchor": f"arn:aws:sns:{REGION}:{ACCOUNT}:{case_name}-target-anchor"},
            "Import changed physical identity")
    case["tagsAfterImport"] = resource_tags(aws, physical, "AWS::CloudWatch::Alarm")
    require(obj(case["tagsAfterImport"])["configuration"] == obj(case["tagsBefore"])["configuration"],
            "Import changed alarm configuration")
    tags = {text(row["Key"]): row["Value"] for row in rows(obj(case["tagsAfterImport"])["Tags"])}
    require(all(tags.get(key) == value for key, value in {
        "aws:cloudformation:stack-name": case_name + "-target", "aws:cloudformation:stack-id": stacks["target"],
        "aws:cloudformation:logical-id": "ProbeResource",
    }.items()), "Import did not establish system-tag ownership")
    case["stage"] = "post-import-update"
    changed = {**retained, "Properties": {**obj(moving["Properties"]), "AlarmDescription": "Disposable import update control"}}
    updated = template({**obj(target_retained["Resources"]), "ProbeResource": changed})
    update(aws, stacks["target"], case_name + "-target", updated)
    case["tagsAfterUpdate"] = resource_tags(aws, physical, "AWS::CloudWatch::Alarm")
    require(obj(case["tagsAfterUpdate"])["configuration"] == {
        **obj(obj(case["tagsBefore"])["configuration"]), "AlarmDescription": "Disposable import update control",
    }, "Normal post-import update changed identity or unrelated configuration")
    case["stage"] = "remove-retain-policy"
    save(report)
    managed = {key: value for key, value in changed.items() if key != "DeletionPolicy"}
    update(aws, stacks["target"], case_name + "-target", template({**obj(updated["Resources"]), "ProbeResource": managed}))
    case.pop("retainedAlarm")
    case["after"] = snapshot(aws, case_name, stacks, moving)
    case["tagsAfter"] = resource_tags(aws, physical, "AWS::CloudWatch::Alarm")
    require(case["tagsAfter"] == case["tagsAfterUpdate"], "Policy-only update changed alarm")
    case["outcome"] = "passed"
    save(report)


def run_case(aws: Aws, prefix: str, variant: str, report: dict[str, Json], case: dict[str, Json]) -> None:
    case_name = prefix + variant
    moving = definition(case_name, variant)
    stacks: dict[str, str] = {}
    case["stackIds"] = stacks
    case["stage"] = "setup"
    initial: dict[str, Json] = {}
    final: dict[str, Json] = {}
    for side in ("source", "target"):
        anchor: dict[str, Json] = {"Type": "AWS::SNS::Topic", "Properties": {"TopicName": case_name + "-" + side + "-anchor"}}
        initial[side] = template({"Anchor": anchor, **({"ProbeResource": moving} if side == "source" else {})})
        final[side] = template({"Anchor": anchor, **({"ProbeResource": moving} if side == "target" else {})})
    case["templates"] = {"before": initial, "after": final}
    save(report)
    try:
        for side in ("source", "target"):
            name = case_name + "-" + side
            require(re.fullmatch(PREFIX + r"[0-9]+-[0-9]+-[a-z-]+-(source|target)", name) is not None,
                    "Unsafe stack creation name")
            try:
                aws.cf("describe-stacks", {"StackName": name})
            except RuntimeError as error:
                require("ValidationError" in str(error) and f"Stack with id {name} does not exist" in str(error), str(error))
            else:
                raise ValueError(f"Stack name already exists; never adopt: {name}")
            case["creating"] = name
            save(report)
            try:
                response = aws.call("deploy", "cloudformation", "create-stack", {
                    "StackName": name, "TemplateBody": json.dumps(initial[side]), "RoleARN": EXECUTION_ROLE,
                    "ClientRequestToken": name, "TimeoutInMinutes": 5,
                })
            except (RuntimeError, OSError, subprocess.TimeoutExpired):
                try:
                    found = rows(aws.cf("describe-stacks", {"StackName": name}).get("Stacks"))
                    require(len(found) == 1, "Ambiguous create response")
                    identifier = stack_id(text(found[0].get("StackId")), name)
                    case["unresolvedCreateId"] = identifier
                    events = rows(aws.cf("describe-stack-events", {"StackName": identifier}).get("StackEvents"))
                    require(any(event.get("ClientRequestToken") == name
                                and event.get("ResourceType") == "AWS::CloudFormation::Stack"
                                and event.get("ResourceStatus") == "CREATE_IN_PROGRESS" for event in events),
                            "Cannot prove this run created the stack; refusing adoption")
                    stacks[side] = identifier
                    case.pop("creating")
                except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as discovery_error:
                    case["createDiscoveryError"] = str(discovery_error)
                save(report)
                raise
            stacks[side] = stack_id(text(response.get("StackId")), name)
            case.pop("creating")
            save(report)
            wait_stack(aws, stacks[side], name, "CREATE_COMPLETE")
        before = snapshot(aws, case_name, stacks, moving)
        case["before"] = before
        source_resources = rows(obj(before["source"])["resources"])
        physical = text(next(resource["PhysicalResourceId"] for resource in source_resources
                             if resource["LogicalResourceId"] == "ProbeResource"))
        case["physicalId"] = physical
        case["tagsBefore"] = resource_tags(aws, physical, text(moving["Type"]))
        if variant.startswith("import-"):
            run_import(aws, case_name, stacks, moving, initial, final, report, case)
            return
        case["stage"] = "native"
        case["unsafeRefactor"] = True
        save(report)
        try:
            response = aws.call("deploy", "cloudformation", "create-stack-refactor", {
                "EnableStackCreation": False, "Description": case_name,
                "StackDefinitions": [{"StackName": stacks[side], "TemplateBody": json.dumps(final[side])}
                                     for side in ("source", "target")],
                "ResourceMappings": [{"Source": {"StackName": stacks["source"], "LogicalResourceId": "ProbeResource"},
                                      "Destination": {"StackName": stacks["target"], "LogicalResourceId": "ProbeResource"}}],
            })
        except RuntimeError:
            case["unsafeRefactor"] = False
            raise
        refactor = text(response.get("StackRefactorId"))
        case["refactorId"] = refactor
        save(report)
        status = wait_refactor(aws, refactor, stacks, report, case, ("AVAILABLE",))
        if status.get("Status") == "CREATE_FAILED":
            case["unsafeRefactor"] = False
            case["outcome"] = classify(str(status.get("StatusReason")))
        else:
            require(status.get("Status") == "CREATE_COMPLETE" and status.get("ExecutionStatus") == "AVAILABLE",
                    "Unexpected preview state")
            case["unsafeRefactor"] = False
            actions = aws.cf("list-stack-refactor-actions", {"StackRefactorId": refactor})
            case["preview"] = actions
            save(report)
            validate_preview(actions, stacks, case_name, physical)
            require(snapshot(aws, case_name, stacks, moving) == before, "Stack changed during preview")
            case["unsafeRefactor"] = True
            save(report)
            try:
                aws.call("deploy", "cloudformation", "execute-stack-refactor", {"StackRefactorId": refactor})
            except RuntimeError:
                rejected = aws.cf("describe-stack-refactor", {"StackRefactorId": refactor})
                case["refactor"] = rejected
                if rejected.get("ExecutionStatus") == "AVAILABLE" and set(rejected.get("StackIds", [])) == set(stacks.values()):
                    case["unsafeRefactor"] = False
                raise
            status = wait_refactor(aws, refactor, stacks, report, case,
                                   ("EXECUTE_COMPLETE", "ROLLBACK_COMPLETE", "EXECUTE_FAILED", "ROLLBACK_FAILED", "OBSOLETE"))
            require(status.get("ExecutionStatus") in ("EXECUTE_COMPLETE", "ROLLBACK_COMPLETE"),
                    "Unexpected execution/rollback state; stop experiments")
            case["unsafeRefactor"] = False
            case["outcome"] = ("passed" if status["ExecutionStatus"] == "EXECUTE_COMPLETE"
                               else classify(str(status.get("ExecutionStatusReason"))))
        case["after"] = snapshot(aws, case_name, stacks, moving)
        case["tagsAfter"] = resource_tags(aws, physical, text(moving["Type"]))
        require(obj(case["tagsAfter"]).get("configuration") == obj(case["tagsBefore"]).get("configuration"),
                "Native refactor changed probe configuration")
        if case["outcome"] == "passed":
            after = obj(case["after"])
            for side in ("source", "target"):
                actual = {text(row["LogicalResourceId"]): row["PhysicalResourceId"]
                          for row in rows(obj(after[side])["resources"])}
                expected = {text(row["LogicalResourceId"]): row["PhysicalResourceId"]
                            for row in rows(obj(before[side])["resources"]) if row["LogicalResourceId"] == "Anchor"}
                if side == "target":
                    expected["ProbeResource"] = physical
                require(actual == expected, "Physical identity/ownership changed unexpectedly")
            tags = {text(row["Key"]): row["Value"] for row in rows(obj(case["tagsAfter"]).get("Tags"))}
            require(all(tags.get(key) == value for key, value in {
                "aws:cloudformation:stack-name": case_name + "-target", "aws:cloudformation:stack-id": stacks["target"],
                "aws:cloudformation:logical-id": "ProbeResource",
            }.items()), "Refactor completed without correct system-tag ownership")
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        case["error"] = str(error)
        case["outcome"] = classify(str(error))
        if (case.get("stage") != "native" or case.get("unsafeRefactor") is not False
                or case["outcome"] not in ("inconclusive-permission", "unsupported")):
            raise
    finally:
        try:
            cleanup(aws, case_name, stacks, moving, report, case)
            if "creating" in case:
                obj(case["cleanup"])["verified"] = False
                raise ValueError("Create response unresolved; inspect exact attempted stack name")
        except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            case["cleanupError"] = str(error)
            case["outcome"] = "inconclusive-cleanup"
            save(report)
            raise
        save(report)


def interrupted(signum: int, frame: object) -> None:
    raise InterruptedError(f"Runner signal {signum}; stopping experiments")


def main() -> int:
    os.umask(0o077)
    DIRECTORY.mkdir(exist_ok=False)
    report: dict[str, Json] = {"account": ACCOUNT, "region": REGION, "cases": [], "complete": False}
    cases = rows(report["cases"])
    report["cases"] = cases
    exit_code = 1
    try:
        for key, expected in (("GITHUB_ACTIONS", "true"), ("GITHUB_REF", "refs/heads/main"),
                              ("GITHUB_EVENT_NAME", "workflow_dispatch"),
                              ("GITHUB_REPOSITORY", "kirill-markin/flashcards-open-source-app"), ("AWS_REGION", REGION)):
            require(os.environ.get(key) == expected, f"Invalid CI guard: {key}")
        run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
        require(re.fullmatch(r"[0-9]+", run_id) is not None and re.fullmatch(r"[0-9]+", attempt) is not None,
                "Invalid run identity")
        report["runId"], report["runAttempt"] = run_id, attempt
        save(report)
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        signal.signal(signal.SIGALRM, interrupted)
        signal.alarm(2700)
        aws = Aws()
        deadline = time.monotonic() + 1800
        native_permission_blocked = False
        variants = ["sns-control"] + [name + "-" + tags for name in ("generated", "explicit")
                                     for tags in ("absent", "empty", "tagged")] + [
                                         "import-generated-absent", "import-explicit-absent"]
        for variant in variants:
            if native_permission_blocked and not variant.startswith("import-"):
                cases.append({"variant": variant, "outcome": "skipped-native-permission"})
                continue
            require(time.monotonic() < deadline, "Experiment time budget exhausted; no new stacks")
            case: dict[str, Json] = {"variant": variant, "outcome": "started"}
            cases.append(case)
            save(report)
            run_case(aws, f"{PREFIX}{run_id}-{attempt}-", variant, report, case)
            print(json.dumps({"variant": variant, "outcome": case["outcome"], "cleanupVerified": True}), flush=True)
            if case["outcome"] == "inconclusive-permission":
                native_permission_blocked = True
            else:
                require(case["outcome"] in ("passed", "unsupported"), "Inconclusive experiment; stop independent cases")
        report["complete"] = True
        exit_code = 1 if native_permission_blocked else 0
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        report["error"] = str(error)
    finally:
        report["counts"] = dict(Counter(text(case["outcome"]) for case in cases))
        save(report)
        summary = ["## Disposable alarm refactor probe", "", json.dumps(report["counts"]), "",
                   "| Variant | Outcome | Cleanup verified |", "| --- | --- | --- |"]
        for case in cases:
            summary.append(f"| {case['variant']} | {case['outcome']} | {obj(case.get('cleanup', {})).get('verified', False)} |")
        for case in cases:
            reason = case.get("error") or obj(case.get("refactor", {})).get("ExecutionStatusReason") or obj(case.get("refactor", {})).get("StatusReason")
            if reason:
                summary.extend(["", str(case["variant"]), "<pre>" + html.escape(str(reason)) + "</pre>"])
            if case.get("retainedAlarm") or case.get("cleanupError"):
                summary.extend(["", "<pre>" + html.escape(json.dumps({
                    "retainedAlarm": case.get("retainedAlarm"), "stackIds": case.get("stackIds"),
                    "cleanupError": case.get("cleanupError"),
                })) + "</pre>"])
        if report.get("error"):
            summary.extend(["", "<pre>" + html.escape(str(report["error"])) + "</pre>"])
        summary.extend(["", "Only probe evidence is attached. An inconclusive result does not establish an alarm provider defect or workaround."])
        output = "\n".join(summary) + "\n"
        (DIRECTORY / "summary.md").write_text(output)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
                stream.write(output)
        print(json.dumps({"complete": report["complete"], "counts": report["counts"]}))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
