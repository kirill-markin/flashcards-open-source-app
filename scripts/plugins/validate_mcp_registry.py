import argparse
import http.client
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import TypeAlias

from jsonschema import Draft7Validator

Json: TypeAlias = None | bool | int | float | str | list["Json"] | dict[str, "Json"]
SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"


def fetch_schema() -> dict[str, Json]:
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(SCHEMA_URL, timeout=30) as response:
                schema: Json = json.load(response)
            if not isinstance(schema, dict):
                raise ValueError(f"MCP Registry schema at {SCHEMA_URL} must be a JSON object")
            return schema
        except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead) as error:
            if attempt == 3:
                raise
            print(f"::warning::GET {SCHEMA_URL} failed on attempt {attempt}/3: {error}; retrying in 1 second", flush=True)
            time.sleep(1)
    raise RuntimeError(f"MCP Registry schema fetch did not complete: {SCHEMA_URL}")


def main(root: Path) -> None:
    manifest: Json = json.loads((root / "server.json").read_text())
    schema = fetch_schema()
    Draft7Validator.check_schema(schema)
    Draft7Validator(schema).validate(manifest)
    print(f"server.json validates against {SCHEMA_URL}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source_directory", type=Path, help="Companion plugin source directory")
    main(parser.parse_args().source_directory)
