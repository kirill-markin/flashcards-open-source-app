#!/usr/bin/env python3

"""Capture the public Duo simulator display for each XCUITest staging request."""

import os
import re
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def failure_message(error: Exception) -> str:
    if not isinstance(error, subprocess.CalledProcessError):
        return str(error)
    details = [f"Command {shlex.join(error.cmd)} exited with status {error.returncode}."]
    if error.stderr:
        details.append(f"stderr: {error.stderr.strip()}")
    if error.stdout:
        details.append(f"stdout: {error.stdout.strip()}")
    return "\n".join(details)


def integrated_display(simulator_id: str, width: int, height: int) -> str:
    result = subprocess.run(
        ["xcrun", "simctl", "io", simulator_id, "enumerate"],
        capture_output=True, text=True, check=True, timeout=10,
    )
    matches = []
    for block in re.split(r"(?=\bScreen ID\s*:)", result.stdout):
        screen_id = re.search(r"\bScreen ID\s*:\s*(\S+)", block)
        screen_type = re.search(r"\bScreen Type\s*:\s*(\S+)", block)
        pixel_size = re.search(r"\bPixel Size\s*:\s*\{\s*(\d+)\s*,\s*(\d+)\s*\}", block)
        if screen_id and screen_type and pixel_size and screen_type.group(1) == "Integrated":
            pixels = (int(pixel_size.group(1)), int(pixel_size.group(2)))
            if sorted(pixels) == sorted((width, height)):
                matches.append(screen_id.group(1))
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected exactly one integrated Duo display with native pixels "
            f"{width}x{height}; found {len(matches)}. Connected Screens:\n{result.stdout}"
        )
    return matches[0]


def write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + ".partial")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def capture(simulator_id: str, width: int, height: int, responses: Path, name: str) -> None:
    display_id = integrated_display(simulator_id, width, height)
    descriptor, temporary_name = tempfile.mkstemp(prefix="host-frame-", suffix=".png", dir=responses)
    os.close(descriptor)
    temporary = Path(temporary_name)
    temporary.unlink()
    try:
        subprocess.run(
            ["xcrun", "simctl", "io", simulator_id, "screenshot", f"--display={display_id}", "--mask=ignored", str(temporary)],
            capture_output=True, text=True, check=True, timeout=20,
        )
        os.replace(temporary, responses / name)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    simulator_id, width_text, height_text, directory_text = sys.argv[1:]
    width, height = int(width_text), int(height_text)
    directory = Path(directory_text)
    requests = directory / "requests"
    responses = directory / "responses"
    integrated_display(simulator_id, width, height)
    (directory / "ready").touch()

    while not (directory / "stop").exists():
        pending = list(requests.glob("*.request"))
        if not pending:
            time.sleep(0.1)
            continue
        if len(pending) != 1 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*\.png\.request", pending[0].name):
            raise RuntimeError(f"Expected one valid Duo capture request, found {[path.name for path in pending]}")
        request = pending[0]
        name = request.name.removesuffix(".request")
        try:
            capture(simulator_id, width, height, responses, name)
        except (OSError, subprocess.SubprocessError, RuntimeError) as error:
            write_atomic(responses / (name + ".error"), failure_message(error).encode("utf-8"))
            raise
        finally:
            request.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as error:
        print(f"Duo host screenshot service failed: {failure_message(error)}", file=sys.stderr)
        sys.exit(1)
