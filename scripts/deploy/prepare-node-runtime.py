#!/usr/bin/env python3
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen


def main() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Patched Lambda runtime assets must be prepared in CI only")
    root = Path(__file__).resolve().parents[2]
    version = "v" + (root / ".nvmrc").read_text().strip().removeprefix("v")
    source = root / "infra/aws/runtime"
    checksums = dict(line.split()[::-1] for line in (source / "SHASUMS256.txt").read_text().splitlines())
    for architecture, node_arch in (("x86_64", "x64"), ("arm64", "arm64")):
        archive_name = f"node-{version}-linux-{node_arch}.tar.xz"
        expected = checksums[archive_name]
        with tempfile.TemporaryDirectory(prefix="node-runtime-") as temporary:
            archive = Path(temporary) / archive_name
            for attempt in range(3):
                try:
                    with urlopen(f"https://nodejs.org/dist/{version}/{archive_name}", timeout=120) as response, archive.open("wb") as output:
                        shutil.copyfileobj(response, output)
                    break
                except (URLError, TimeoutError) as error:
                    print(json.dumps({"downloadRetry": archive_name, "attempt": attempt + 1, "error": str(error)}), flush=True)
                    if attempt == 2:
                        raise
                    time.sleep(2)
            with archive.open("rb") as downloaded:
                if hashlib.file_digest(downloaded, "sha256").hexdigest() != expected:
                    raise ValueError(f"Official Node archive checksum mismatch: {archive_name}")
            destination = root / ".cache/node-runtime" / architecture
            if destination.exists():
                shutil.rmtree(destination)
            runtime = destination / "nibomo-node"
            runtime.mkdir(parents=True)
            (destination / "bin").mkdir()
            shutil.copyfile(source / "wrapper.sh", destination / "bin/nibomo-node-wrapper")
            (destination / "bin/nibomo-node-wrapper").chmod(0o755)
            for file in ("extract.cjs", "verify.cjs"):
                shutil.copyfile(source / file, runtime / file)
            digest = hashlib.sha256()
            size = 0
            with tarfile.open(archive, "r:xz") as tar:
                with tar.extractfile(f"node-{version}-linux-{node_arch}/LICENSE") as license_file:
                    (runtime / "LICENSE").write_bytes(license_file.read())
                member = tar.getmember(f"node-{version}-linux-{node_arch}/bin/node")
                if not member.isfile() or member.size > 140 * 1024 * 1024:
                    raise ValueError(f"Unexpected official Node executable: {archive_name}")
                with tar.extractfile(member) as binary, (runtime / "node.gz").open("wb") as output:
                    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
                        while chunk := binary.read(65536):
                            digest.update(chunk)
                            size += len(chunk)
                            compressed.write(chunk)
            manifest = {"version": version, "arch": node_arch, "sha256": digest.hexdigest(), "size": size}
            (runtime / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
            print(json.dumps({"preparedRuntime": architecture, **manifest}), flush=True)


if __name__ == "__main__":
    main()
