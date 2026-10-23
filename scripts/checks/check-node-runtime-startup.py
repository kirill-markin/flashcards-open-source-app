#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


def docker(arguments: list[str]) -> str:
    try:
        return subprocess.run(["docker", *arguments], check=True, capture_output=True, text=True).stdout.strip()
    except subprocess.CalledProcessError as error:
        print(json.dumps({"dockerError": error.stderr, "exitCode": error.returncode}), file=sys.stderr, flush=True)
        raise


def check_startup(architecture: str, node_arch: str, layer: Path, manifest: dict[str, object],
        original_abi: dict[str, str], memory: int, deadline: int) -> None:
    with tempfile.TemporaryDirectory(prefix="lambda-startup-") as temporary:
        handler = Path(temporary) / "index.js"
        handler.write_text("exports.handler = async () => ({version:process.version,arch:process.arch,execPath:process.execPath,args:process.execArgv,entrypoint:process.argv[1],modules:process.versions.modules,napi:process.versions.napi});")
        scratch = Path(temporary) / "scratch"
        scratch.mkdir(mode=0o700)
        container = docker(["run", "--detach", "--read-only", "--user", f"{os.getuid()}:{os.getgid()}",
            "--memory", f"{memory}m", "--memory-swap", f"{memory}m",
            "--cpus", f"{memory / 1769:.6f}", "--mount", f"type=bind,src={scratch},dst=/tmp",
            "--publish", "127.0.0.1::8080", "--mount", f"type=bind,src={layer},dst=/opt,readonly",
            "--mount", f"type=bind,src={handler},dst=/var/task/index.js,readonly",
            "--env", "AWS_LAMBDA_EXEC_WRAPPER=/opt/bin/nibomo-node-wrapper",
            "--env", "NIBOMO_NODE_RUNTIME_ID=" + "0" * 64,
            "--env", f"AWS_LAMBDA_FUNCTION_MEMORY_SIZE={memory}",
            "--env", "AWS_LAMBDA_FUNCTION_NAME=runtime-startup-preflight",
            "public.ecr.aws/lambda/nodejs:24", "index.handler"])
        try:
            endpoint = "http://" + docker(["port", container, "8080/tcp"]) + "/2015-03-31/functions/function/invocations"
            ready = time.monotonic() + 30
            while True:
                started = time.monotonic()
                try:
                    with urlopen(Request(endpoint, data=b"{}", method="POST"), timeout=30) as response:
                        result = json.load(response)
                    break
                except URLError as error:
                    if not isinstance(error.reason, ConnectionRefusedError) or time.monotonic() >= ready:
                        raise
                    time.sleep(0.1)
            elapsed = time.monotonic() - started
            if result.get("version") != manifest["version"] or result.get("arch") != node_arch:
                raise AssertionError(f"AWS runtime did not execute patched Node: {result}")
            if result.get("execPath") != f"/tmp/nibomo-node-{manifest['sha256']}/node":
                raise AssertionError(f"Unexpected AWS runtime invocation: {result}")
            if result.get("modules") != original_abi["modules"] or int(result.get("napi", "0")) < int(original_abi["napi"]):
                raise AssertionError(f"Patched Node changes the native module or Node-API ABI: {result}")
            arguments = result.get("args", [])
            if ("--expose-gc" not in arguments or "--require" not in arguments
                    or result.get("entrypoint") != "/var/runtime/index.mjs" or elapsed >= deadline):
                raise AssertionError(f"Wrapper lost AWS arguments or exceeded {deadline}s startup: {result}, {elapsed}s")
            print(json.dumps({"runtimeStartup": "passed", "architecture": architecture, "memoryMiB": memory,
                "cpu": memory / 1769, "deadlineSeconds": deadline, "elapsedSeconds": elapsed, **result}), flush=True)
        finally:
            try:
                subprocess.run(["docker", "logs", container], check=True)
            finally:
                docker(["rm", "--force", container])


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Lambda base-image startup preflight runs only in CI")
    architecture = sys.argv[1]
    node_arch = {"x86_64": "x64", "arm64": "arm64"}[architecture]
    root = Path(__file__).resolve().parents[2]
    layer = root / ".cache/node-runtime" / architecture
    manifest = json.loads((layer / "nibomo-node/manifest.json").read_text())
    for attempt in range(3):
        try:
            docker(["pull", "public.ecr.aws/lambda/nodejs:24"])
            break
        except subprocess.CalledProcessError as error:
            print(json.dumps({"baseImagePullRetry": attempt + 1, "error": error.stderr}), flush=True)
            if attempt == 2:
                raise
            time.sleep(2)
    original_abi = json.loads(docker(["run", "--rm", "--entrypoint", "/var/lang/bin/node",
        "public.ecr.aws/lambda/nodejs:24", "-p", "JSON.stringify({modules:process.versions.modules,napi:process.versions.napi})"]))
    cases = {"x86_64": [(512, 10), (1024, 5)], "arm64": [(1024, 10)]}[architecture]
    for memory, deadline in cases:
        check_startup(architecture, node_arch, layer, manifest, original_abi, memory, deadline)


if __name__ == "__main__":
    main()
