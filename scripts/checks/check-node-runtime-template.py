#!/usr/bin/env python3
import json
from pathlib import Path
import sys


def main() -> None:
    assembly = Path(sys.argv[1])
    root = Path(__file__).resolve().parents[2]
    template = json.loads((assembly / "FlashcardsOpenSourceApp.template.json").read_text())
    resources = template["Resources"]
    functions = []
    for logical_id, resource in resources.items():
        properties = resource.get("Properties", {})
        if resource["Type"] != "AWS::Lambda::Function" or not properties.get("Runtime", "").startswith("nodejs"):
            continue
        architecture, = properties.get("Architectures", ["x86_64"])
        manifest = json.loads((root / ".cache/node-runtime" / architecture / "nibomo-node/manifest.json").read_text())
        layer, = properties["Layers"]
        layer_id = layer["Ref"]
        layer_properties = resources[layer_id]["Properties"]
        variables = properties["Environment"]["Variables"]
        if properties["Runtime"] != "nodejs24.x" or variables["AWS_LAMBDA_EXEC_WRAPPER"] != "/opt/bin/nibomo-node-wrapper":
            raise AssertionError(f"Missing supported wrapper: {logical_id}")
        if layer_properties["CompatibleArchitectures"] != [architecture] or layer_properties["CompatibleRuntimes"] != ["nodejs24.x"]:
            raise AssertionError(f"Incorrect patched layer architecture/runtime: {logical_id}")
        scratch = properties["EphemeralStorage"]["Size"]
        if scratch * 1024 * 1024 < 512 * 1024 * 1024 + manifest["size"]:
            raise AssertionError(f"Patched runtime consumes original scratch capacity: {logical_id}")
        memory = properties["MemorySize"]
        if type(memory) is not int or memory < 256 or memory > 10240:
            raise AssertionError(f"Unsupported patched runtime memory allocation: {logical_id}: {memory}")
        asset = assembly / resource["Metadata"]["aws:asset:path"]
        if not asset.is_dir():
            raise AssertionError(f"Lambda ZIP asset directory is absent: {logical_id}: {asset}")
        function_size = sum(file.stat().st_size for file in asset.rglob("*") if file.is_file())
        layer_size = sum(file.stat().st_size for file in (root / ".cache/node-runtime" / architecture).rglob("*") if file.is_file())
        if function_size + layer_size >= 250 * 1024 * 1024:
            raise AssertionError(f"Lambda code plus compressed runtime layer exceeds 250 MiB: {logical_id}")
        functions.append({"logicalId": logical_id, "architecture": architecture, "handler": properties["Handler"],
            "layerLogicalId": layer_id, "runtimeId": variables["NIBOMO_NODE_RUNTIME_ID"], "scratch": scratch,
            "actualMemorySize": memory})
    for helper in ("DatabaseMigrationProviderframeworkonEvent", "LogRetention"):
        if not any(item["logicalId"].startswith(helper) for item in functions):
            raise AssertionError(f"Generated helper missing runtime coverage: {helper}")
    if len(functions) < 32:
        raise AssertionError(f"Expected coverage of all 32 existing Node functions, found {len(functions)}")
    versions = [{"logicalId": logical_id, "functionLogicalId": resource["Properties"]["FunctionName"]["Ref"]}
        for logical_id, resource in resources.items() if resource["Type"] == "AWS::Lambda::Version"]
    evidence = {"functions": functions, "versions": versions}
    (assembly / "node-runtime-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"patchedNodeTemplate": "covered", "functions": len(functions), "versions": versions}), flush=True)


if __name__ == "__main__":
    main()
