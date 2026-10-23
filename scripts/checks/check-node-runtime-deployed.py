#!/usr/bin/env python3
import base64
from datetime import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen
import zipfile


def aws(arguments: list[str]) -> dict[str, object]:
    result = subprocess.run(["aws", *arguments, "--output", "json"], check=True, capture_output=True, text=True,
        env={**os.environ, "AWS_PAGER": "", "AWS_RETRY_MODE": "standard", "AWS_MAX_ATTEMPTS": "3"})
    return json.loads(result.stdout)


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Deployed Lambda runtime evidence is collected only by release CI")
    root = Path(__file__).resolve().parents[2]
    evidence_directory = Path(sys.argv[1])
    expected = json.loads((evidence_directory / "node-runtime-evidence.json").read_text())
    resources = aws(["cloudformation", "list-stack-resources", "--stack-name", os.environ["STACK_NAME"]])["StackResourceSummaries"]
    physical = {item["LogicalResourceId"]: item["PhysicalResourceId"] for item in resources}
    live_ids = {item["LogicalResourceId"] for item in resources if item["ResourceType"] == "AWS::Lambda::Function"}
    if live_ids != {item["logicalId"] for item in expected["functions"]}:
        raise AssertionError("Deployed function inventory differs from the synthesized runtime coverage")
    manifests = {}
    verified_layers = set()
    configurations = []
    for function in expected["functions"]:
        architecture = function["architecture"]
        manifest = json.loads((evidence_directory / architecture / "manifest.json").read_text())
        manifests[architecture] = manifest
        layer_arn = physical[function["layerLogicalId"]]
        if layer_arn not in verified_layers:
            layer = aws(["lambda", "get-layer-version-by-arn", "--arn", layer_arn])
            with tempfile.TemporaryFile() as archive:
                for attempt in range(3):
                    try:
                        archive.seek(0)
                        archive.truncate()
                        with urlopen(layer["Content"]["Location"], timeout=60) as response:
                            while chunk := response.read(65536):
                                archive.write(chunk)
                        break
                    except (URLError, TimeoutError) as error:
                        print(json.dumps({"layerDownloadRetry": attempt + 1, "errorType": type(error).__name__}), flush=True)
                        if attempt == 2:
                            raise
                        time.sleep(2)
                archive.seek(0)
                if base64.b64encode(hashlib.file_digest(archive, "sha256").digest()).decode() != layer["Content"]["CodeSha256"]:
                    raise AssertionError("Downloaded runtime layer ZIP does not match AWS CodeSha256")
                archive.seek(0)
                with zipfile.ZipFile(archive) as package:
                    for name, source in (("bin/nibomo-node-wrapper", "wrapper.sh"),
                            ("nibomo-node/extract.cjs", "extract.cjs"), ("nibomo-node/verify.cjs", "verify.cjs")):
                        if package.read(name) != (root / "infra/aws/runtime" / source).read_bytes():
                            raise AssertionError(f"Deployed layer startup source differs: {name}")
                    if json.loads(package.read("nibomo-node/manifest.json")) != manifest:
                        raise AssertionError("Deployed runtime manifest differs from checksum-verified CI asset")
                    with package.open("nibomo-node/node.gz") as compressed, gzip.GzipFile(fileobj=compressed) as binary:
                        if hashlib.file_digest(binary, "sha256").hexdigest() != manifest["sha256"]:
                            raise AssertionError("Deployed executable differs from checksum-verified official Node")
            verified_layers.add(layer_arn)
        names = [physical[function["logicalId"]]] + [physical[item["logicalId"]] for item in expected["versions"]
            if item["functionLogicalId"] == function["logicalId"]]
        for name in names:
            config = aws(["lambda", "get-function-configuration", "--function-name", name])
            variables = config["Environment"]["Variables"]
            if (config["Runtime"] != "nodejs24.x" or config["Handler"] != function["handler"]
                    or config.get("Architectures", ["x86_64"]) != [architecture]
                    or [item["Arn"] for item in config.get("Layers", [])] != [layer_arn]
                    or variables.get("AWS_LAMBDA_EXEC_WRAPPER") != "/opt/bin/nibomo-node-wrapper"
                    or variables.get("NIBOMO_NODE_RUNTIME_ID") != function["runtimeId"]
                    or config["EphemeralStorage"]["Size"] != function["scratch"]
                    or config["MemorySize"] != function["actualMemorySize"]):
                raise AssertionError(f"Deployed runtime configuration differs: {name}")
            configurations.append((config, function, manifest))
            print(json.dumps({"runtimeConfiguration": "verified", "function": name, "layer": layer_arn,
                "officialNode": manifest["version"], "runtimeId": function["runtimeId"],
                "actualMemorySize": config["MemorySize"]}), flush=True)
    observed = set()
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline and observed != set(manifests):
        for config, function, manifest in configurations:
            if function["architecture"] in observed:
                continue
            group = config.get("LoggingConfig", {}).get("LogGroup", "/aws/lambda/" + config["FunctionName"])
            start = int(datetime.fromisoformat(config["LastModified"].replace("Z", "+00:00")).timestamp() * 1000) - 2000
            try:
                events = aws(["logs", "filter-log-events", "--log-group-name", group,
                    "--start-time", str(start), "--filter-pattern", '"nibomo_node_runtime"'])["events"]
            except subprocess.CalledProcessError as error:
                if "ResourceNotFoundException" in error.stderr:
                    continue
                raise
            for event in events:
                record = json.loads(event["message"])
                if (record.get("event") == "nibomo_node_runtime" and record.get("version") == manifest["version"]
                        and record.get("arch") == manifest["arch"] and record.get("sha256") == manifest["sha256"]
                        and record.get("runtimeId") == function["runtimeId"] and record.get("functionName") == config["FunctionName"]):
                    observed.add(function["architecture"])
                    print(json.dumps({"runtimeProcess": "verified", "logGroup": group, "eventId": event["eventId"], **record}), flush=True)
        if observed != set(manifests):
            time.sleep(5)
    if observed != set(manifests):
        raise AssertionError(f"Existing release invocations have no direct patched-process proof for: {set(manifests) - observed}")
    summary = {"runtimeConfigurationsVerified": len(configurations), "immutableLayersVerified": len(verified_layers),
        "directProcessArchitectures": sorted(observed)}
    print(json.dumps(summary), flush=True)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write("\nPatched Node runtime evidence: `" + json.dumps(summary) + "`\n")


if __name__ == "__main__":
    main()
