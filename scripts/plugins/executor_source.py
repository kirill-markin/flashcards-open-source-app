import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import NamedTuple, TypeAlias

Json: TypeAlias = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
REPOSITORY = "kirill-markin/flashcards-open-source-app"
SOURCE_REPOSITORY = "kirill-markin/nibomo-plugins"
CORE_DIRECTORY = Path(__file__).resolve().parents[2]
MAIN = "refs/remotes/origin/main"
CORE_PIN = "core-source.json"
CORE_EXECUTOR_PATH = "apps/executor"
LEGACY_EXECUTOR_PATH = "executor"
SOURCE_PATHS = ["LICENSE", "README.md", "index.ts", "package.json", "provider.ts"]


class ExecutorSource(NamedTuple):
    repository: str
    sha: str
    path: str
    files: dict[str, str]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def record(value: Json) -> dict[str, Json]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def string(value: Json) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("Expected a nonempty JSON string")
    return value


def commit(value: Json) -> str:
    result = string(value)
    require(re.fullmatch(r"[a-f0-9]{40}", result) is not None, "Expected a full immutable Git commit")
    return result


def git(directory: Path, *arguments: str) -> str:
    return subprocess.check_output(["git", "-C", str(directory), *arguments], timeout=60).decode("utf-8")


def executor_snapshot(directory: Path, sha: str, path: str) -> dict[str, str] | None:
    entries = git(directory, "ls-tree", "-r", "-z", sha, "--", f"{path}/").split("\0")[:-1]
    regular_paths = [entry.split("\t", 1)[1] for entry in entries if entry.startswith("100644 blob ")]
    expected_paths = [f"{path}/{name}" for name in SOURCE_PATHS]
    if len(regular_paths) != len(entries) or regular_paths != expected_paths:
        return None
    return {name: git(directory, "show", f"{sha}:{path}/{name}") for name in SOURCE_PATHS}


def core_pin_fields(pairs: list[tuple[str, Json]]) -> dict[str, Json]:
    require(len(pairs) == 1 and pairs[0][0] == "commit", f"{CORE_PIN} must contain exactly one commit field")
    return dict(pairs)


def validated_executor_source(directory: Path, repository: str, sha: str, path: str) -> ExecutorSource:
    snapshot = executor_snapshot(directory, sha, path)
    if snapshot is None:
        raise ValueError(f"Unexpected Executor source set in {repository} at {sha}:{path}; expected only {SOURCE_PATHS}")
    return ExecutorSource(repository, sha, path, snapshot)


def pinned_executor_source(companion: Path, sha: str) -> ExecutorSource | None:
    marker = git(companion, "ls-tree", sha, "--", CORE_PIN)
    if not marker:
        return None
    require(marker.startswith("100644 blob "), f"{CORE_PIN} must be a regular JSON file at {sha}")
    pin = record(json.loads(git(companion, "show", f"{sha}:{CORE_PIN}"), object_pairs_hook=core_pin_fields))
    source_sha = commit(pin["commit"])
    require(source_sha in git(CORE_DIRECTORY, "rev-list", "--first-parent", MAIN).splitlines(),
            f"{CORE_PIN} commit {source_sha} must be in the core main branch history")
    return validated_executor_source(CORE_DIRECTORY, REPOSITORY, source_sha, CORE_EXECUTOR_PATH)


def selected_executor_source(companion: Path, sha: str) -> ExecutorSource:
    pinned = pinned_executor_source(companion, sha)
    if pinned is not None:
        return pinned
    return validated_executor_source(companion, SOURCE_REPOSITORY, sha, LEGACY_EXECUTOR_PATH)


def reviewed_executor_source(companion: Path, snapshot: dict[str, str]) -> bool:
    for directory, path in [(CORE_DIRECTORY, CORE_EXECUTOR_PATH), (companion, LEGACY_EXECUTOR_PATH)]:
        history = git(directory, "log", "--first-parent", "--format=%H", MAIN, "--", f"{path}/").splitlines()
        if any(executor_snapshot(directory, sha, path) == snapshot for sha in history):
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and print the core commit pinned by the companion checkout.")
    parser.add_argument("companion", type=Path)
    companion = parser.parse_args().companion
    sha = git(companion, "rev-parse", "HEAD").strip()
    pinned = pinned_executor_source(companion, sha)
    if pinned is None:
        raise ValueError(f"{CORE_PIN} is required in CI")
    print(pinned.sha)


if __name__ == "__main__":
    main()
