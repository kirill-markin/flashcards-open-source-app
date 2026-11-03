#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import zipfile


NODE_PROBE = r"""
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dc = require('node:diagnostics_channel');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const [asset, referenceProject] = process.argv.slice(1);
const assetRequire = createRequire(path.join(asset, 'index.js'));
const referenceRequire = createRequire(path.join(referenceProject, 'package.json'));
const insideAsset = file => file.startsWith(asset + path.sep);
function packageFiles(directory) {
  const files = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (current === directory && entry.name === 'node_modules') continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        assert.ok(entry.isFile(), `Unexpected vendor file type: ${file}`);
        files[path.relative(directory, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    }
  }
  visit(directory);
  return files;
}
const packages = [];
const visited = new Set();
function packageManifest(name, parentRequire) {
  let directory = path.dirname(fs.realpathSync(parentRequire.resolve(name)));
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Cannot locate package manifest: ${name}`);
    directory = parent;
  }
  const manifest = path.join(directory, 'package.json');
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).name, name);
  return manifest;
}
function verifyPackage(name, parentRequire, parentReferenceRequire) {
  const manifestPath = packageManifest(name, parentRequire);
  assert.ok(insideAsset(manifestPath), `Dependency escaped final asset: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const reference = packageManifest(name, parentReferenceRequire);
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(reference, 'utf8')).version, name);
  if (visited.has(manifestPath)) return;
  visited.add(manifestPath);
  const files = packageFiles(path.dirname(manifestPath));
  assert.deepEqual(files, packageFiles(path.dirname(reference)), `Incomplete or changed vendor package: ${name}`);
  packages.push({ name, version: manifest.version, files: Object.keys(files).length,
    sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') });
  const packageRequire = createRequire(manifestPath);
  const packageReferenceRequire = createRequire(reference);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) verifyPackage(dependency, packageRequire, packageReferenceRequire);
}
verifyPackage('@sentry/server-runtime-injection', assetRequire, referenceRequire);
assert.equal(packages.find(item => item.name === '@sentry/server-runtime-injection').version, '11.10.0');
const hookPath = fs.realpathSync(assetRequire.resolve('@sentry/server-runtime-injection/register'));
assert.ok(insideAsset(hookPath), `Hook escaped final asset: ${hookPath}`);
const warnings = [];
console.warn = (...messages) => warnings.push(messages.map(String).join(' '));
require(hookPath).registerDiagnosticsChannelInjection();
const events = [];
let smithyPath;
try { smithyPath = assetRequire.resolve('@smithy/core/client'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const smithy = { status: 'not-installed-in-asset' };
async function main() {
  const sources = JSON.parse(fs.readFileSync(path.join(asset, 'index.js.map'), 'utf8')).sources;
  const bundledInstrumentedModules = referenceRequire('@sentry/server-utils').getInstrumentedModuleNames()
    .filter(name => sources.some(source => source.includes('/node_modules/' + name + '/')));
  if (smithyPath !== undefined && insideAsset(fs.realpathSync(smithyPath))) {
    dc.tracingChannel('orchestrion:@smithy/core:send').subscribe(Object.fromEntries(
      ['start', 'end', 'asyncStart', 'asyncEnd', 'error'].map(name => [name, () => events.push(name)])));
    const { Client } = assetRequire('@smithy/core/client');
    const output = await new Client({}).send({ resolveMiddleware: () => async () => ({ output: { diagnostic: 'ok' } }) });
    assert.deepEqual(output, { diagnostic: 'ok' });
    assert.ok(globalThis.__SENTRY_ORCHESTRION__.runtime.includes('@smithy/core'));
    for (const event of ['start', 'end', 'asyncStart', 'asyncEnd']) assert.ok(events.includes(event), event);
    smithy.status = 'instrumented-send-passed';
    smithy.version = assetRequire('@smithy/core/package.json').version;
    smithy.events = events;
  }
  assert.deepEqual(warnings, [], 'Runtime hook emitted warnings');
  assert.ok(Array.isArray(globalThis.__SENTRY_ORCHESTRION__.runtime), 'Runtime hook did not register');
  process.stdout.write(JSON.stringify({ packages, hook: path.relative(asset, hookPath), registered: true,
    bundledInstrumentedModules, smithy, warnings }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
"""


def sha256(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def sizes(directory: Path) -> dict[str, int]:
    unpacked = 0
    with tempfile.TemporaryFile() as archive:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
            for file in sorted(directory.rglob("*")):
                name = file.relative_to(directory).as_posix()
                if file.is_symlink():
                    target = os.readlink(file)
                    if not file.resolve().is_relative_to(directory.resolve()) or not file.exists():
                        raise ValueError(f"Unsafe asset symlink: {file}")
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    zipped.writestr(info, target)
                elif file.is_file():
                    unpacked += file.stat().st_size
                    zipped.write(file, name)
        compressed = archive.tell()
    return {"unpackedBytes": unpacked, "diagnosticZipBytes": compressed}


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Final Lambda packaging inspection runs only in CI")
    assembly, output = map(Path, sys.argv[1:])
    assembly = assembly.resolve()
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("lambda_source_maps", root / "scripts/deploy/upload-lambda-source-maps.py")
    if spec is None or spec.loader is None:
        raise ImportError("Cannot load existing Lambda source-map validation")
    source_maps = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = source_maps
    spec.loader.exec_module(source_maps)
    report = {"status": "failed", "sourceSha": os.environ["GITHUB_SHA"], "assets": []}
    try:
        uploads = {upload.directory: upload for upload in source_maps.emitted_source_maps(assembly)}
        resources = json.loads((assembly / "FlashcardsOpenSourceApp.template.json").read_text())["Resources"]
        sentry_assets = set()
        measured = {}
        sandbox_count = 0
        instrumented_assets = 0
        for logical_id, resource in resources.items():
            properties = resource.get("Properties", {})
            sentry = "SENTRY_RELEASE" in properties.get("Environment", {}).get("Variables", {})
            sandbox = logical_id.startswith("ChatSandboxHandler")
            if resource["Type"] != "AWS::Lambda::Function" or not (sentry or sandbox):
                continue
            asset = (assembly / resource["Metadata"]["aws:asset:path"]).resolve()
            if not asset.is_relative_to(assembly) or not asset.is_dir():
                raise ValueError(f"Final asset is absent or outside the assembly: {logical_id}")
            entry = {"logicalId": logical_id, "asset": asset.name, "sentry": sentry}
            report["assets"].append(entry)
            reference = json.loads((assembly / "lambda-cache-references" / f"{asset.name.removeprefix('asset.')}.json").read_text())
            reference_project = (root / reference["projectRoot"]).resolve()
            if reference["schema"] != 1 or reference["asset"] != asset.name or not reference_project.is_relative_to(root):
                raise ValueError(f"Invalid final asset owner metadata: {logical_id}")
            entry["referenceProject"] = reference_project.relative_to(root).as_posix()
            code = (asset / "index.js").read_text()
            source_map = json.loads((asset / "index.js.map").read_text())
            if source_map.get("version") != 3 or not source_map.get("sources") or not source_map.get("mappings"):
                raise ValueError(f"Final source map is incomplete: {logical_id}")
            entry["indexSha256"] = sha256(asset / "index.js")
            entry["sourceMapSha256"] = sha256(asset / "index.js.map")
            if sentry:
                sentry_assets.add(asset)
                source_maps.verify_debug_id(uploads[asset])
                if 'require("@sentry/server-runtime-injection/register")' not in code and "require('@sentry/server-runtime-injection/register')" not in code:
                    raise ValueError(f"Final bundle lost its external runtime hook reference: {logical_id}")
                entry["externalHookReference"] = True
                entry["buildTimeMarker"] = "g.bundler=g.bundler||new Set();" in code
                entry["matchingDebugId"] = source_map.get("debugId", source_map.get("debug_id"))
            probe = subprocess.run(["node", "-e", NODE_PROBE, str(asset), str(reference_project)],
                capture_output=True, text=True, timeout=30)
            if probe.returncode != 0:
                raise ValueError(f"Final package probe failed for {logical_id}: {probe.stdout}\n{probe.stderr}")
            entry["runtimeProbe"] = json.loads(probe.stdout)
            if sentry and entry["runtimeProbe"]["bundledInstrumentedModules"]:
                if not entry["buildTimeMarker"]:
                    raise ValueError(f"Final bundle lost its build-time instrumentation marker: {logical_id}")
                instrumented_assets += 1
            if sandbox:
                sandbox_count += 1
                entry["customPackages"] = {}
                for name in ("just-bash", "pdfjs-dist"):
                    manifest = json.loads((asset / "node_modules" / name / "package.json").read_text())
                    entry["customPackages"][name] = manifest["version"]
                worker = Path("node_modules/just-bash/dist/bundle/chunks/worker.js")
                if sha256(asset / worker) != sha256(root / "apps/backend" / worker):
                    raise ValueError("Final ChatSandbox worker differs from the installed patched worker")
                for relative in ("build/pdf.worker.mjs", "standard_fonts", "cmaps"):
                    if not (asset / "node_modules/pdfjs-dist" / relative).exists():
                        raise ValueError(f"Final ChatSandbox lost pdfjs-dist/{relative}")
                entry["patchedWorkerSha256"] = sha256(asset / worker)
            architecture, = properties.get("Architectures", ["x86_64"])
            layer = root / ".cache/node-runtime" / architecture
            for directory in (asset, layer):
                if directory not in measured:
                    measured[directory] = sizes(directory)
            entry["codeSize"] = measured[asset]
            entry["runtimeLayerSize"] = measured[layer]
            entry["combinedDiagnosticZipBytes"] = measured[asset]["diagnosticZipBytes"] + measured[layer]["diagnosticZipBytes"]
            entry["combinedUnpackedBytes"] = measured[asset]["unpackedBytes"] + measured[layer]["unpackedBytes"]
            entry["remainingUnpackedBytes"] = 250 * 1024 * 1024 - entry["combinedUnpackedBytes"]
        if sentry_assets != set(uploads) or not sentry_assets or sandbox_count != 1 or instrumented_assets == 0:
            raise ValueError("Incomplete coverage: expected every Sentry asset, build-time instrumentation and exactly one ChatSandbox")
        for prefix in ("AuthHandler", "StoreSandboxImportHandler"):
            if not any(entry["logicalId"].startswith(prefix) for entry in report["assets"]):
                raise ValueError(f"Required Sentry asset is absent: {prefix}")
        report["status"] = "passed"
    except (AssertionError, KeyError, OSError, ValueError, subprocess.SubprocessError) as error:
        report["error"] = str(error)
        raise
    finally:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"sentryLambdaPackaging": report["status"], "assets": len(report["assets"])}), flush=True)


if __name__ == "__main__":
    main()
