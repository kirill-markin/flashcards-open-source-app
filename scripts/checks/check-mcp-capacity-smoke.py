#!/usr/bin/env python3

import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from typing import cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid


def object_value(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label}: expected an object")
    return cast(dict[str, object], value)


def text_value(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label}: expected a nonempty string")
    return value


class AwsError(RuntimeError):
    pass


class Aws:
    def __init__(self, environment: dict[str, str]) -> None:
        self.environment = {**environment, "AWS_PAGER": "", "AWS_RETRY_MODE": "standard", "AWS_MAX_ATTEMPTS": "3"}

    def call(self, service: str, operation: str, arguments: list[str]) -> dict[str, object]:
        result = subprocess.run(
            ["aws", service, operation, *arguments, "--output", "json", "--cli-connect-timeout", "10", "--cli-read-timeout", "30"],
            env=self.environment, capture_output=True, text=True, timeout=100, check=False,
        )
        if result.returncode:
            raise AwsError(f"{service} {operation}: {result.stderr.strip()}")
        return object_value(json.loads(result.stdout or "{}"), f"{service} {operation}")

    def stack(self, name: str) -> dict[str, object] | None:
        try:
            response = self.call("cloudformation", "describe-stacks", ["--stack-name", name])
        except AwsError as error:
            if "(ValidationError)" in str(error) and f"Stack with id {name} does not exist" in str(error):
                return None
            raise
        stacks = response.get("Stacks")
        if not isinstance(stacks, list) or len(stacks) != 1:
            raise ValueError(f"describe-stacks {name}: expected exactly one stack")
        return object_value(stacks[0], name)


def wait_stack(aws: Aws, name: str, expected: str, seconds: int) -> dict[str, object]:
    started = time.monotonic()
    deadline = started + seconds
    while time.monotonic() < deadline:
        stack = aws.stack(name)
        status = "ABSENT" if stack is None else text_value(stack.get("StackStatus"), "StackStatus")
        if status == expected:
            return {} if stack is None else stack
        stale = time.monotonic() - started < 30 and (
            (expected == "CREATE_COMPLETE" and status == "ABSENT")
            or (expected == "UPDATE_COMPLETE" and status == "CREATE_COMPLETE")
            or (expected == "DELETE_COMPLETE" and status in {"CREATE_COMPLETE", "UPDATE_COMPLETE", "ROLLBACK_COMPLETE"})
        )
        if not status.endswith("_IN_PROGRESS") and not stale:
            reason = "" if stack is None else str(stack.get("StackStatusReason", ""))
            raise RuntimeError(f"{name}: expected {expected}, received {status}: {reason}")
        print(json.dumps({"waitingFor": expected, "stack": name, "status": status}), flush=True)
        time.sleep(10)
    raise TimeoutError(f"{name}: did not reach {expected} within {seconds}s")


def fixture_template(source: dict[str, object], name: str) -> dict[str, object]:
    code = object_value(source.get("Code"), "dispatcher Code")
    if set(code) != {"S3Bucket", "S3Key"}:
        raise ValueError("Dispatcher must use an unversioned S3 ZIP artifact")
    for key in code:
        text_value(code[key], f"Code.{key}")
    environment = object_value(source.get("Environment"), "dispatcher Environment")
    if set(object_value(environment.get("Variables"), "dispatcher Variables")) != {"MCP_WORKER_FUNCTION_NAME"}:
        raise ValueError("Unsupported dispatcher environment; fixture must not copy production secrets")
    if source.get("Runtime") != "nodejs24.x" or source.get("Architectures", ["x86_64"]) != ["x86_64"]:
        raise ValueError("Unsupported dispatcher runtime or architecture")
    if any(key in source for key in ("Layers", "VpcConfig", "FileSystemConfigs", "CodeSigningConfigArn")):
        raise ValueError("Unsupported dispatcher execution dependencies")
    copied = {key: source[key] for key in ("Code", "Handler", "Runtime", "MemorySize", "Timeout")}
    text_value(copied["Handler"], "dispatcher Handler")
    for key in ("MemorySize", "Timeout"):
        if type(copied[key]) is not int or cast(int, copied[key]) <= 0:
            raise ValueError(f"dispatcher {key}: expected a positive integer")
    resources: dict[str, object] = {}
    for function in ("Worker", "Dispatcher"):
        resources[f"{function}Logs"] = {"Type": "AWS::Logs::LogGroup", "DeletionPolicy": "Delete", "Properties": {
            "LogGroupName": f"/aws/lambda/{name}-{function}", "RetentionInDays": 1,
        }}
        statements: list[object] = [{"Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
                                     "Resource": {"Fn::GetAtt": [f"{function}Logs", "Arn"]}}]
        if function == "Dispatcher":
            statements.append({"Effect": "Allow", "Action": "lambda:InvokeFunction", "Resource": {"Fn::GetAtt": ["Worker", "Arn"]}})
        resources[f"{function}Role"] = {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "FixtureRuntime", "PolicyDocument": {"Version": "2012-10-17", "Statement": statements}}],
        }}
    worker_code = """import base64

def handler(event, context):
    failed = event["path"] == "/failure"
    body = '{"error":"fixture worker failure"}' if failed else event["body"]
    return {"statusCode": 500 if failed else 201,
            "headers": {"Content-Type": "application/json", "X-Fixture-Worker": "executed",
                        "X-Request-Id": event["requestContext"]["requestId"]},
            "body": base64.b64encode(body.encode()).decode(), "isBase64Encoded": True}
"""
    resources["Worker"] = {"Type": "AWS::Lambda::Function", "DependsOn": "WorkerLogs", "Properties": {
        "FunctionName": f"{name}-Worker", "Runtime": "python3.12", "Handler": "index.handler", "Timeout": 5,
        "Role": {"Fn::GetAtt": ["WorkerRole", "Arn"]}, "Code": {"ZipFile": worker_code},
        "ReservedConcurrentExecutions": {"Ref": "WorkerConcurrency"},
    }}
    resources["Dispatcher"] = {"Type": "AWS::Lambda::Function", "DependsOn": "DispatcherLogs", "Properties": {
        **copied, "FunctionName": f"{name}-Dispatcher", "Role": {"Fn::GetAtt": ["DispatcherRole", "Arn"]},
        "Environment": {"Variables": {"MCP_WORKER_FUNCTION_NAME": {"Ref": "Worker"}}},
    }}
    resources["Api"] = {"Type": "AWS::ApiGatewayV2::Api", "Properties": {"Name": name, "ProtocolType": "HTTP"}}
    resources["Integration"] = {"Type": "AWS::ApiGatewayV2::Integration", "Properties": {
        "ApiId": {"Ref": "Api"}, "IntegrationType": "AWS_PROXY", "IntegrationMethod": "POST",
        "IntegrationUri": {"Fn::GetAtt": ["Dispatcher", "Arn"]}, "PayloadFormatVersion": "1.0", "TimeoutInMillis": 29000,
    }}
    resources["Route"] = {"Type": "AWS::ApiGatewayV2::Route", "Properties": {
        "ApiId": {"Ref": "Api"}, "RouteKey": "POST /{proxy+}",
        "Target": {"Fn::Join": ["/", ["integrations", {"Ref": "Integration"}]]},
    }}
    resources["Permission"] = {"Type": "AWS::Lambda::Permission", "Properties": {
        "FunctionName": {"Ref": "Dispatcher"}, "Action": "lambda:InvokeFunction", "Principal": "apigateway.amazonaws.com",
        "SourceArn": {"Fn::Sub": "arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/POST/*"},
    }}
    resources["Stage"] = {"Type": "AWS::ApiGatewayV2::Stage", "DependsOn": ["Route", "Permission"], "Properties": {
        "ApiId": {"Ref": "Api"}, "StageName": "$default", "AutoDeploy": True,
    }}
    return {"Parameters": {"WorkerConcurrency": {"Type": "Number", "AllowedValues": [0, 1]}},
            "Resources": resources, "Outputs": {"Endpoint": {"Value": {"Fn::GetAtt": ["Api", "ApiEndpoint"]}}}}


def probe(endpoint: str, path: str, expected: int) -> None:
    payload = b'{"probe":"capacity-smoke"}'
    deadline = time.monotonic() + 120
    last_failure = "no response"
    while time.monotonic() < deadline:
        try:
            request = Request(endpoint + path, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            try:
                response = urlopen(request, timeout=35)
            except HTTPError as error:
                response = error
            with response:
                status, body = response.status, response.read()
                headers = {key.lower(): value for key, value in response.headers.items()}
        except (URLError, TimeoutError) as error:
            last_failure = f"{type(error).__name__}: {error}"
        else:
            last_failure = f"HTTP {status}: {body[:1000]!r}"
            if status == expected:
                if expected == 429:
                    result = object_value(json.loads(body), "capacity body")
                    if result.get("code") != "MCP_CONCURRENCY_LIMIT_REACHED":
                        raise AssertionError(f"Wrong capacity code: {last_failure}")
                    message = text_value(result.get("error"), "capacity error")
                    if "Retry-After" not in message or "retry" not in message.lower():
                        raise AssertionError(f"Capacity response lacks actionable retry advice: {last_failure}")
                    retry = headers.get("retry-after", "")
                    if not retry.isdigit() or int(retry) <= 0:
                        raise AssertionError(f"Expected positive Retry-After, received {retry!r}")
                    request_id = text_value(result.get("requestId"), "capacity requestId")
                    if request_id != headers.get("x-request-id"):
                        raise AssertionError("Capacity requestId does not match X-Request-Id")
                else:
                    wanted = payload if expected == 201 else b'{"error":"fixture worker failure"}'
                    if body != wanted or headers.get("x-fixture-worker") != "executed":
                        raise AssertionError(f"Worker proxy response changed: {last_failure}; headers={headers}")
                    if "retry-after" in headers or not headers.get("x-request-id"):
                        raise AssertionError(f"Worker response headers changed: {headers}")
                if "application/json" not in headers.get("content-type", ""):
                    raise AssertionError(f"Unexpected Content-Type: {headers}")
                print(json.dumps({"probe": path, "status": status, "requestId": headers["x-request-id"], "result": "passed"}), flush=True)
                return
            if status not in {404, 429, 502, 503, 504}:
                raise AssertionError(f"Expected HTTP {expected}, received {last_failure}")
        print(json.dumps({"readinessRetry": path, "expectedStatus": expected, "failure": last_failure}), flush=True)
        time.sleep(5)
    raise AssertionError(f"{path}: expected HTTP {expected} within 120s; last failure: {last_failure}")


def cleanup(aws: Aws, name: str, owner: str, role: str) -> None:
    stack = aws.stack(name)
    if stack is None:
        print(json.dumps({"fixture": name, "cleanup": "confirmed absent"}), flush=True)
        return
    tags = stack.get("Tags")
    if not isinstance(tags, list) or {"Key": "McpCapacitySmokeOwner", "Value": owner} not in tags:
        raise RuntimeError(f"Refusing to delete {name}: fixture ownership tag does not match")
    stack_id = text_value(stack.get("StackId"), "fixture StackId")
    deadline = time.monotonic() + 300
    while str(stack.get("StackStatus", "")).endswith("_IN_PROGRESS"):
        if stack.get("StackStatus") in {"CREATE_IN_PROGRESS", "DELETE_IN_PROGRESS"}:
            break
        if time.monotonic() >= deadline:
            raise TimeoutError(f"{name}: update still running; cannot safely delete fixture")
        time.sleep(10)
        stack = aws.stack(stack_id)
        if stack is None:
            raise RuntimeError(f"{name}: stack disappeared during cleanup readiness")
    if stack.get("StackStatus") != "DELETE_IN_PROGRESS":
        aws.call("cloudformation", "delete-stack", ["--stack-name", stack_id, "--role-arn", role])
    wait_stack(aws, stack_id, "DELETE_COMPLETE", 600)
    print(json.dumps({"fixture": name, "cleanup": "DELETE_COMPLETE"}), flush=True)


def interrupt(signum: int, frame: object) -> None:
    raise InterruptedError(f"Received signal {signum}; deleting fixture")


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("GITHUB_REPOSITORY") != "kirill-markin/flashcards-open-source-app":
        raise RuntimeError("Run only through this repository's AWS/Web Release CI workflow")
    region, core = os.environ["AWS_REGION"], os.environ["STACK_NAME"]
    original = Aws(dict(os.environ))
    stack = original.stack(core)
    if stack is None:
        raise RuntimeError(f"Core stack {core} is absent")
    role = text_value(stack.get("RoleARN"), "core RoleARN")
    match = re.fullmatch(r"arn:aws:iam::(\d{12}):role/cdk-([a-z0-9]+)-cfn-exec-role-\1-" + re.escape(region), role)
    if match is None:
        raise ValueError("Core execution role does not match the supported CDK bootstrap naming convention")
    account, qualifier = match.groups()
    deploy_role = f"arn:aws:iam::{account}:role/cdk-{qualifier}-deploy-role-{account}-{region}"
    credentials = object_value(original.call("sts", "assume-role", ["--role-arn", deploy_role,
        "--role-session-name", "mcp-capacity-smoke", "--duration-seconds", "3600"]).get("Credentials"), "STS Credentials")
    aws = Aws({**os.environ, **{env: text_value(credentials.get(key), key) for env, key in (
        ("AWS_ACCESS_KEY_ID", "AccessKeyId"), ("AWS_SECRET_ACCESS_KEY", "SecretAccessKey"), ("AWS_SESSION_TOKEN", "SessionToken"))}})
    template = aws.call("cloudformation", "get-template", ["--stack-name", core, "--template-stage", "Original"])["TemplateBody"]
    if isinstance(template, str):
        template = json.loads(template)
    resources = object_value(object_value(template, "core template").get("Resources"), "core Resources")
    dispatcher = object_value(resources.get("McpDispatcher61BE30A2"), "deployed dispatcher")
    if dispatcher.get("Type") != "AWS::Lambda::Function":
        raise ValueError("Deployed dispatcher is not a Lambda function")
    owner = f"{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}-{uuid.uuid4().hex[:10]}"
    name = f"mcp-capacity-{owner}"
    fixture = fixture_template(object_value(dispatcher.get("Properties"), "dispatcher Properties"), name)
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    with tempfile.TemporaryDirectory(prefix="mcp-capacity-") as directory:
        path = Path(directory) / "fixture.json"
        path.write_text(json.dumps(fixture), encoding="utf-8")
        print(json.dumps({"fixture": name, "sourceStack": core, "sourceLogicalId": "McpDispatcher61BE30A2"}), flush=True)
        try:
            aws.call("cloudformation", "create-stack", ["--stack-name", name, "--template-body", f"file://{path}",
                "--parameters", "ParameterKey=WorkerConcurrency,ParameterValue=0", "--capabilities", "CAPABILITY_IAM",
                "--role-arn", role, "--client-request-token", owner, "--timeout-in-minutes", "7",
                "--tags", f"Key=McpCapacitySmokeOwner,Value={owner}"])
            ready = wait_stack(aws, name, "CREATE_COMPLETE", 480)
            outputs = ready.get("Outputs")
            if not isinstance(outputs, list):
                raise ValueError("Fixture stack Outputs missing")
            endpoints = [item.get("OutputValue") for item in outputs if isinstance(item, dict) and item.get("OutputKey") == "Endpoint"]
            if len(endpoints) != 1:
                raise ValueError("Fixture stack must expose exactly one Endpoint")
            endpoint = text_value(endpoints[0], "Endpoint")
            if re.fullmatch(r"https://[a-z0-9]+\.execute-api\." + re.escape(region) + r"\.amazonaws\.com", endpoint) is None:
                raise ValueError("Unexpected fixture Endpoint")
            probe(endpoint, "/mcp", 429)
            aws.call("cloudformation", "update-stack", ["--stack-name", name, "--use-previous-template",
                "--parameters", "ParameterKey=WorkerConcurrency,ParameterValue=1", "--capabilities", "CAPABILITY_IAM", "--role-arn", role])
            wait_stack(aws, name, "UPDATE_COMPLETE", 300)
            probe(endpoint, "/mcp", 201)
            probe(endpoint, "/failure", 500)
        finally:
            cleanup(aws, name, owner, role)


if __name__ == "__main__":
    main()
