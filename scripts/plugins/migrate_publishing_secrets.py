import base64
import hmac
import json
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from publish_executor import Json, commit, items, record, require, string

SOURCE = "kirill-markin/nibomo-plugins"
TARGET = "kirill-markin/flashcards-open-source-app"
WORKFLOW_PATH = ".github/workflows/mcp-registry-publish.yml"
SECRETS = ["MCP_PRIVATE_KEY", "EXECUTOR_API_TOKEN"]
WORKFLOW = """name: Encrypted publishing secret export
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  export:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Encrypt existing publishing secrets
        env:
          MCP_PRIVATE_KEY: ${{ secrets.MCP_PRIVATE_KEY }}
          EXECUTOR_API_TOKEN: ${{ secrets.EXECUTOR_API_TOKEN }}
          RECIPIENT_CERT: '@CERT@'
        run: |
          python3 - <<'PYTHON'
          import base64
          import json
          import os
          import subprocess
          from pathlib import Path

          values = {name: os.environ[name] for name in ["MCP_PRIVATE_KEY", "EXECUTOR_API_TOKEN"]}
          if any(not value for value in values.values()):
              raise ValueError("Both existing publishing secrets must be configured before export")
          recipient = Path(os.environ["RUNNER_TEMP"]) / "recipient.pem"
          recipient.write_bytes(base64.b64decode(os.environ["RECIPIENT_CERT"], validate=True))
          subprocess.run(["openssl", "cms", "-encrypt", "-binary", "-aes-256-cbc", "-outform", "DER",
                          "-out", "publishing-secrets.cms", str(recipient)],
                         input=json.dumps(values).encode(), check=True, timeout=30)
          PYTHON
      - uses: actions/upload-artifact@v7
        with:
          name: '@ARTIFACT@'
          path: publishing-secrets.cms
          if-no-files-found: error
          retention-days: 1
"""


def command(arguments: list[str], payload: bytes | None) -> bytes:
    result = subprocess.run(arguments, input=payload, capture_output=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError(f"{arguments[0:4]} failed: {result.stderr.decode(errors='replace')}")
    return result.stdout


def api(repository: str, path: str, method: str, body: Json) -> Json:
    require(repository in [SOURCE, TARGET], "Only the two Nibomo publishing repositories are allowed")
    arguments = ["gh", "api", "--hostname", "github.com", "--method", method, f"repos/{repository}/{path}"]
    payload = None
    if body is not None:
        arguments.extend(["--input", "-"])
        payload = json.dumps(body).encode()
    output = command(arguments, payload)
    return json.loads(output) if output.strip() else None


def main_workflow(repository: str) -> str:
    metadata = record(api(repository, "", "GET", None))
    require(metadata["default_branch"] == "main", f"{repository}: the default branch must be main before export")
    workflow = record(api(repository, f"actions/workflows/{Path(WORKFLOW_PATH).name}", "GET", None))
    require(workflow["path"] == WORKFLOW_PATH and workflow["state"] == "active",
            f"{repository}: the existing manual registry workflow must be active on main")
    parent = commit(record(record(api(repository, "git/ref/heads/main", "GET", None))["object"])["sha"])
    existing = record(api(repository, f"contents/{WORKFLOW_PATH}?ref={parent}", "GET", None))
    content = base64.b64decode(string(existing["content"])).decode()
    require("workflow_dispatch:" in content, f"{repository}: registry workflow must support manual dispatch on main")
    return parent


def export_commit(repository: str, parent: str, certificate: bytes, artifact: str) -> str:
    base_tree = record(record(api(repository, f"git/commits/{parent}", "GET", None))["tree"])
    replacement = WORKFLOW.replace("@CERT@", base64.b64encode(certificate).decode()).replace("@ARTIFACT@", artifact)
    tree = record(api(repository, "git/trees", "POST", {
        "base_tree": commit(base_tree["sha"]),
        "tree": [{"path": WORKFLOW_PATH, "mode": "100644", "type": "blob", "content": replacement}],
    }))
    identity: dict[str, Json] = {"name": "Kirill Markin", "email": "markinkirill@gmail.com"}
    created = record(api(repository, "git/commits", "POST", {
        "message": "Export publishing secrets to an ephemeral encrypted recipient\n\nCo-authored-by: GPT-6.1 Sol <noreply@openai.com>",
        "tree": commit(tree["sha"]),
        "parents": [parent],
        "author": identity,
        "committer": identity,
    }))
    return commit(created["sha"])


def branch_runs(repository: str, branch: str, sha: str) -> list[dict[str, Json]]:
    result = record(api(repository, f"actions/workflows/{Path(WORKFLOW_PATH).name}/runs?branch={branch}&event=workflow_dispatch&per_page=100",
                        "GET", None))
    entries = [record(value) for value in items(result["workflow_runs"])]
    require(result["total_count"] == len(entries), f"{repository}: unexpected temporary-run pagination")
    require(all(run["head_sha"] == sha and run["head_branch"] == branch and run["event"] == "workflow_dispatch"
                for run in entries), f"{repository}: temporary branch run identity mismatch")
    return entries


def completed_export(repository: str, branch: str, sha: str) -> str:
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        runs = branch_runs(repository, branch, sha)
        require(len(runs) <= 1, f"{repository}: multiple encrypted exports for {branch}; inspect before retrying")
        if runs:
            run = runs[0]
            if run["status"] == "completed":
                require(run["conclusion"] == "success", f"Encrypted export failed: {run['html_url']}")
                identifier = run["id"]
                require(type(identifier) is int and identifier > 0, "Invalid export run ID")
                return str(identifier)
        time.sleep(5)
    raise TimeoutError(f"{repository}: encrypted export did not complete within 10 minutes on {branch}")


def decrypted_export(repository: str, run_id: str, artifact: str, directory: Path) -> dict[str, str]:
    download = directory / repository.split("/")[1]
    command(["gh", "run", "download", run_id, "--repo", f"github.com/{repository}", "--name", artifact, "--dir", str(download)], None)
    require(sorted(path.name for path in download.iterdir()) == ["publishing-secrets.cms"],
            f"{repository}: encrypted export must contain exactly one CMS file")
    plaintext = command(["openssl", "cms", "-decrypt", "-binary", "-inform", "DER",
                         "-in", str(download / "publishing-secrets.cms"), "-inkey", str(directory / "recipient.key")], None)
    values = record(json.loads(plaintext))
    require(sorted(values) == sorted(SECRETS), f"{repository}: unexpected encrypted secret names")
    return {name: string(values[name]) for name in SECRETS}


def set_secret(name: str, value: str) -> None:
    require(name in SECRETS, "Only the two existing publishing secrets may be copied")
    result = subprocess.run(["gh", "secret", "set", name, "--repo", f"github.com/{TARGET}", "--app", "actions"],
                            input=value.encode(), capture_output=True, timeout=90)
    require(result.returncode == 0,
            f"gh secret set {name} --repo {TARGET} failed with exit status {result.returncode}; "
            "check local gh authentication and target repository secret permissions")


def cleanup_branch(repository: str, branch: str, sha: str, artifact: str) -> None:
    runs = branch_runs(repository, branch, sha)
    for run in runs:
        run_id = str(run["id"])
        if run["status"] != "completed":
            try:
                api(repository, f"actions/runs/{run_id}/cancel", "POST", None)
            except (RuntimeError, subprocess.TimeoutExpired):
                if record(api(repository, f"actions/runs/{run_id}", "GET", None))["status"] != "completed":
                    raise
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if record(api(repository, f"actions/runs/{run_id}", "GET", None))["status"] == "completed":
                    break
                time.sleep(3)
            else:
                raise TimeoutError(f"{repository}: cannot clean export {run_id} while it is running; branch {branch} retained")
        response = record(api(repository, f"actions/runs/{run_id}/artifacts?per_page=100", "GET", None))
        artifacts = [record(value) for value in items(response["artifacts"])]
        require(response["total_count"] == len(artifacts), f"{repository}: unexpected artifact pagination")
        for value in artifacts:
            require(value["name"] == artifact, f"{repository}: unexpected artifact in owned export run")
            api(repository, f"actions/artifacts/{value['id']}", "DELETE", None)
    references = items(api(repository, f"git/matching-refs/heads/{branch}", "GET", None))
    if not references:
        return
    require(len(references) == 1 and record(references[0])["ref"] == f"refs/heads/{branch}",
            f"{repository}: ambiguous temporary branch; refusing to delete {branch}")
    current = commit(record(record(references[0])["object"])["sha"])
    require(current == sha, f"{repository}: temporary branch changed; refusing to delete {branch}")
    api(repository, f"git/refs/heads/{branch}", "DELETE", None)


def main() -> None:
    require(len(sys.argv) == 1, "This fixed-repository helper accepts no arguments")
    command(["gh", "auth", "status", "--hostname", "github.com"], None)
    parents = {repository: main_workflow(repository) for repository in [SOURCE, TARGET]}
    resources: list[tuple[str, str, str, str]] = []
    with tempfile.TemporaryDirectory(prefix="nibomo-publishing-secrets-") as temporary:
        directory = Path(temporary)
        private_key = directory / "recipient.key"
        private_key.touch(mode=0o600, exist_ok=False)
        command(["openssl", "req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
                 "-subj", "/CN=nibomo-publishing-secrets", "-keyout", str(private_key),
                 "-out", str(directory / "recipient.pem")], None)
        require(private_key.stat().st_mode & 0o777 == 0o600, "Ephemeral private key permissions must be 0600")
        certificate = (directory / "recipient.pem").read_bytes()
        values: dict[str, str] = {}
        verified = False
        cleanup_errors: list[str] = []
        try:
            for repository in [SOURCE, TARGET]:
                suffix = uuid.uuid4().hex
                branch = f"codex/publishing-secrets-{suffix}"
                artifact = f"publishing-secrets-{suffix}"
                sha = export_commit(repository, parents[repository], certificate, artifact)
                resources.append((repository, branch, sha, artifact))
                api(repository, "git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": sha})
                print(f"Prepared encrypted export: {repository} {branch}", flush=True)
                api(repository, f"actions/workflows/{Path(WORKFLOW_PATH).name}/dispatches", "POST", {"ref": branch})
                run_id = completed_export(repository, branch, sha)
                print(f"Encrypted export completed: {repository} run {run_id}", flush=True)
                exported = decrypted_export(repository, run_id, artifact, directory)
                if repository == SOURCE:
                    values = exported
                    require(all(not value.endswith(("\r", "\n")) for value in values.values()),
                            "Source publishing secrets end in CR/LF; gh secret set stdin would trim them. "
                            "No target secrets were written; use a lossless transfer before retrying")
                    for name in SECRETS:
                        set_secret(name, values[name])
                else:
                    require(all(hmac.compare_digest(values[name].encode(), exported[name].encode()) for name in SECRETS),
                            "Encrypted target readback differs; original companion secrets remain intact")
                    verified = True
        finally:
            primary_error = sys.exc_info()[1]
            for repository, branch, sha, artifact in reversed(resources):
                try:
                    cleanup_branch(repository, branch, sha, artifact)
                except Exception as error:
                    cleanup_errors.append(f"{repository} {branch}: {error}")
            values.clear()
            for error in cleanup_errors:
                print(f"Cleanup required: {error}", file=sys.stderr)
            if cleanup_errors and primary_error is None:
                raise RuntimeError("Temporary export cleanup failed; inspect the listed owned branches/artifacts")
        require(verified, "Encrypted target readback did not complete")
        print("Both core Actions secrets match the encrypted companion export. Original companion secrets remain configured.")


if __name__ == "__main__":
    main()
