import argparse
import copy
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def write_archive(root: Path, destination: Path, files: list[Path]) -> None:
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(root))


def main(root: Path) -> None:
    portable = json.loads((root / "plugin.json").read_text())
    openai_identity = json.loads((root / "openai-package.json").read_text())
    version = portable["version"]
    destination = root / "dist"
    destination.mkdir(exist_ok=True)
    shared = [root / "README.md", root / "LICENSE"]
    shared += [path for folder in ["skills", "assets", "references"] for path in (root / folder).rglob("*") if path.is_file()]
    write_archive(root, destination / f"nibomo-{version}-claude.zip", shared + [root / ".claude-plugin/plugin.json", root / ".mcp.json"])
    openai = destination / f"nibomo-{version}-openai.zip"
    write_archive(root, openai, shared)
    openai_mcp_bytes = (root / "mcp.json").read_bytes()
    if "mcpAuth" in openai_identity:
        openai_mcp = copy.deepcopy(json.loads(openai_mcp_bytes))
        openai_mcp["mcpServers"]["nibomo"]["extensions"] = {"com.openai": {"auth": openai_identity["mcpAuth"]}}
        openai_mcp_bytes = (json.dumps(openai_mcp, indent=2) + "\n").encode()
    with ZipFile(openai, "a", compression=ZIP_DEFLATED) as archive:
        archive.writestr("plugin.json", json.dumps({**portable, "name": openai_identity["name"]}, indent=2) + "\n")
        archive.writestr("mcp.json", openai_mcp_bytes)
    write_archive(root, destination / f"nibomo-{version}-gemini.zip", shared + [root / "gemini-extension.json"])
    antigravity = destination / f"nibomo-{version}-antigravity.zip"
    write_archive(root, antigravity, shared)
    endpoint = json.loads((root / "mcp.json").read_text())["mcpServers"]["nibomo"]["url"]
    with ZipFile(antigravity, "a", compression=ZIP_DEFLATED) as archive:
        archive.writestr("plugin.json", json.dumps({field: portable[field] for field in ["name", "description"]}, indent=2) + "\n")
        archive.writestr("mcp_config.json", json.dumps({"mcpServers": {"nibomo": {"serverUrl": endpoint}}}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source_directory", type=Path, help="Companion plugin source directory")
    main(parser.parse_args().source_directory)
