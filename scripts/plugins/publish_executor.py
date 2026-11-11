import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import NamedTuple

from executor_source import (
    CORE_DIRECTORY,
    CORE_PIN as CORE_PIN,
    MAIN,
    REPOSITORY,
    SOURCE_PATHS,
    SOURCE_REPOSITORY,
    Json,
    commit,
    git,
    record,
    require,
    reviewed_executor_source,
    selected_executor_source,
    string,
)

APP = "app_741c52b8-681c-4e8c-8536-9b278e02d671"
PACKAGE = "@nibomo.executor.community/nibomo"
HOST = "https://v2.executor.sh"


class RemoteRevision(NamedTuple):
    commit: str
    files: dict[str, str]


def items(value: Json) -> list[Json]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON array")
    return value


def environment(name: str) -> str:
    value = os.environ.get(name, "")
    require(bool(value), f"Missing {name}; configure the workflow secret/input before retrying")
    return value


def note(label: str, value: str) -> None:
    with Path(environment("GITHUB_STEP_SUMMARY")).open("a") as summary:
        summary.write(f"- {label}: {value}\n")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url: str, token: str, method: str, body: Json) -> Json:
    headers = {"Accept": "application/json", "User-Agent": "nibomo-executor-publisher"}
    if url.startswith(f"{HOST}/"):
        headers["executor-wire-revision"] = "1"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = None if body is None else json.dumps(body).encode()
    if payload is not None:
        headers["Content-Type"] = "application/json"
    # Never forward credentials or redirect a mutation to another endpoint.
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, payload, headers, method=method), timeout=180) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        if token:
            detail = detail.replace(token, "[redacted]")
        raise RuntimeError(f"{method} {url}: HTTP {error.code}: {detail[:2000]}") from None
    except urllib.error.URLError as error:
        raise RuntimeError(f"{method} {url}: {error.reason}; inspect remote state before retrying") from None


def github(path: str) -> Json:
    # Public companion reads must not depend on the core repository token.
    return request(f"https://api.github.com/repos/{SOURCE_REPOSITORY}/{path}", "", "GET", None)


def executor(path: str, method: str, body: Json) -> Json:
    return request(f"{HOST}{path}", environment("EXECUTOR_API_TOKEN"), method, body)


def ancestor(directory: Path, older: str, newer: str) -> None:
    subprocess.run(["git", "-C", str(directory), "merge-base", "--is-ancestor", older, newer],
                   check=True, timeout=60)


def publisher_sha() -> str:
    return git(CORE_DIRECTORY, "rev-parse", "HEAD").strip()


def companion_directory() -> Path:
    directory = Path(environment("PLUGIN_SOURCE_DIR"))
    require(git(directory, "remote", "get-url", "origin").strip() == f"https://github.com/{SOURCE_REPOSITORY}.git",
            "PLUGIN_SOURCE_DIR must be a public clone of kirill-markin/nibomo-plugins")
    return directory


def verify_remote_revisions(
    companion: Path, intended: dict[str, str], working: RemoteRevision, deployed: RemoteRevision, public: RemoteRevision,
) -> None:
    if working.commit == deployed.commit:
        require(working.files == deployed.files,
                "Working and deployed files disagree for the same Executor commit; reconcile before retrying")
    else:
        require(working.files == intended and deployed.commit == public.commit,
                "Remote revisions do not match an interrupted Executor save; reconcile before retrying")
    if deployed.commit == public.commit:
        require(deployed.files == public.files,
                "Deployed and public files disagree for the same Executor commit; reconcile before retrying")
    else:
        require(deployed.files == intended,
                "Deployed source does not match the selected release; reconcile before retrying publication")
        require(reviewed_executor_source(companion, public.files),
                "Remote public source does not match reviewed main ancestry; reconcile before retrying")
    require(deployed.files == intended or reviewed_executor_source(companion, deployed.files),
            "Remote deployed source does not match reviewed main ancestry; reconcile before retrying")


def files(value: Json) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in items(value):
        data = record(entry)
        path = string(data["path"])
        require(path not in result, f"Duplicate remote source path: {path}")
        content = data["content"]
        if not isinstance(content, str):
            raise ValueError(f"Incomplete remote source: {path}")
        result[path] = content
    require(sorted(result) == SOURCE_PATHS, f"Unexpected remote source set: {sorted(result)}; reconcile before deleting or omitting files")
    return result


def publication(value: Json) -> str:
    data = record(value)
    require(data["name"] == PACKAGE, "Unexpected public package identity")
    return commit(data["commit"])


def listing(value: Json, endpoint: str) -> dict[str, Json]:
    publications = [record(item) for item in items(value)]
    matches = [item for item in publications if item["name"] == PACKAGE]
    identities = [{"name": item.get("name"), "commit": item.get("commit")} for item in publications]
    require(len(matches) == 1,
            f"GET {endpoint}: expected exactly one existing {PACKAGE} listing; matched={len(matches)}; "
            f"published identities={json.dumps(identities)}. Reconcile the existing publication; never create a replacement")
    return matches[0]


def release_version(tag: str) -> str:
    numeric = r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    match = re.fullmatch(rf"(?:v(?P<coordinated>{numeric})|executor-v(?P<remediation>{numeric})-scope-migration)", tag)
    if match is None:
        raise ValueError("release_tag must be vX.Y.Z or executor-vX.Y.Z-scope-migration")
    return match.group("coordinated") or match.group("remediation")


def release_sha(companion: Path, tag: str) -> str:
    version = release_version(tag)
    release = record(github(f"releases/tags/{tag}"))
    require(release["tag_name"] == tag and release["draft"] is False and release["prerelease"] is False,
            "Only an existing published stable release is allowed")
    ref = record(record(github(f"git/ref/tags/{tag}"))["object"])
    while ref["type"] == "tag":
        ref = record(record(github(f"git/tags/{commit(ref['sha'])}"))["object"])
    require(ref["type"] == "commit", "Release tag must resolve to a commit")
    sha = commit(ref["sha"])
    require(git(companion, "rev-parse", f"refs/tags/{tag}^{{commit}}").strip() == sha, "Release tag changed since checkout")
    if tag == "v1.29.0":
        require(sha == "41cd84f6f8b947131dbbca36b6f8a577db1f1993", "Immutable v1.29.0 tag moved")
    ancestor(companion, sha, MAIN)
    for path in ["plugin.json", ".claude-plugin/plugin.json", "gemini-extension.json"]:
        manifest = record(json.loads(git(companion, "show", f"{sha}:{path}")))
        require(manifest["name"] == "nibomo" and manifest["version"] == version, f"Release/manifest mismatch: {path}")
    if tag.startswith("executor-"):
        coordinated_tag = f"v{version}"
        coordinated_sha = release_sha(companion, coordinated_tag)
        ancestor(companion, coordinated_sha, sha)
        latest = record(github("releases/latest"))
        require(latest["tag_name"] == coordinated_tag, "Executor remediation must preserve the coordinated Latest release")
    return sha


def cloud_run(sha: str) -> str:
    data = record(github(f"actions/workflows/packages.yml/runs?head_sha={sha}&event=push&branch=main&per_page=100"))
    runs = [record(item) for item in items(data["workflow_runs"])]
    require(bool(runs), f"No Plugin packages main push run for {sha}")
    run = runs[0]
    require(run["head_sha"] == sha and run["head_branch"] == "main" and run["event"] == "push"
            and run["name"] == "Plugin packages" and run["status"] == "completed" and run["conclusion"] == "success",
            f"Latest exact-SHA Plugin packages run is not successful: {run['html_url']}")
    jobs = record(github(f"actions/runs/{run['id']}/jobs?per_page=100"))
    entries = items(jobs["jobs"])
    require(jobs["total_count"] == len(entries), "Unexpected job pagination; inspect cloud run")
    for name in ["packages", "Executor typecheck"]:
        matches = [record(job) for job in entries if record(job)["name"] == name]
        require(len(matches) == 1 and matches[0]["conclusion"] == "success", f"Required cloud job not successful: {name}")
    return string(run["html_url"])


def account_selections(path: str) -> dict[str, list[str]]:
    value = executor(path, "GET", None)
    if not isinstance(value, list):
        raise ValueError(f"{path}: expected an account-link array")
    result: dict[str, list[str]] = {}
    for link in value:
        if not isinstance(link, dict):
            raise ValueError(f"{path}: expected an account-link object")
        requirement = link.get("requirement")
        if not isinstance(requirement, str) or not requirement:
            raise ValueError(f"{path}: expected a nonempty account requirement")
        account = link.get("account")
        if not isinstance(account, dict):
            raise ValueError(f"{path}: expected a linked account object")
        identifier = account.get("id")
        if not isinstance(identifier, str) or not identifier.startswith("acc_"):
            raise ValueError(f"{path}: expected a linked account.id with the acc_ prefix")
        accounts = result.setdefault(requirement, [])
        require(identifier not in accounts, f"{path}: duplicate requirement/account pair")
        accounts.append(identifier)
    return result


def prepare_registry_source() -> None:
    require(environment("GITHUB_REPOSITORY") == REPOSITORY, "Wrong GitHub repository")
    require(environment("GITHUB_EVENT_NAME") == "workflow_dispatch" and environment("GITHUB_REF") == "refs/heads/main",
            "Dispatch MCP Registry publication from core main")
    tag = environment("RELEASE_TAG")
    require(tag.startswith("v"), "MCP Registry publication requires a stable companion vX.Y.Z release")
    companion = companion_directory()
    sha = release_sha(companion, tag)
    manifest = record(json.loads(git(companion, "show", f"{sha}:server.json")))
    require(manifest["name"] == "com.nibomo/flashcards" and manifest["version"] == release_version(tag),
            "Unexpected immutable registry identity or release version")
    require(manifest["remotes"] == [{"type": "streamable-http", "url": "https://mcp.nibomo.com/mcp"}],
            "Unexpected MCP Registry endpoint")
    require(record(manifest["repository"]) == {"url": f"https://github.com/{REPOSITORY}", "source": "github"},
            "Unexpected registry repository identity")
    note("Companion release", f"[{tag}](https://github.com/{SOURCE_REPOSITORY}/releases/tag/{tag}) — {sha}")
    note("Core publisher SHA", publisher_sha())
    note("Plugin packages", cloud_run(sha))
    require(release_sha(companion, tag) == sha, "Release tag changed before selecting registry source")
    git(companion, "checkout", "--detach", sha)
    with Path(environment("GITHUB_OUTPUT")).open("a") as output:
        output.write(f"sha={sha}\nversion={manifest['version']}\n")


def main() -> None:
    environment("EXECUTOR_API_TOKEN")
    require(environment("GITHUB_REPOSITORY") == REPOSITORY, "Wrong GitHub repository")
    event_name = environment("GITHUB_EVENT_NAME")
    require(event_name in ["release", "workflow_dispatch"], "Publication requires a release or manual retry")
    event = record(json.loads(Path(environment("GITHUB_EVENT_PATH")).read_text()))
    if event_name == "release":
        require(event["action"] == "published", "Expected release published event")
        release = record(event["release"])
        require(release["draft"] is False and release["prerelease"] is False, "Expected a published stable core release")
        tag = string(release["tag_name"])
    else:
        require(environment("GITHUB_REF") == "refs/heads/main", "Run manual retries from main")
        tag = environment("RELEASE_TAG")
    companion = companion_directory()
    if event_name == "release":
        require(re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag) is not None,
                "Automatic publication requires a stable core vX.Y.Z release")
    sha = release_sha(companion, tag)
    note("Companion release", f"[{tag}](https://github.com/{SOURCE_REPOSITORY}/releases/tag/{tag}) — {sha}")
    note("Core publisher SHA", publisher_sha())
    note("Plugin packages", cloud_run(sha))
    selected = selected_executor_source(companion, sha)
    selected_url = f"https://github.com/{selected.repository}/tree/{selected.sha}/{selected.path}"
    note("Executor Git source", f"[{selected.repository}/{selected.path}]({selected_url}) — {selected.sha}")
    intended = selected.files
    require(record(json.loads(intended["package.json"]))["name"] == PACKAGE, "Wrong Executor package name")
    context = record(executor("/api/context?organization=nibomo", "GET", None))
    require(context["slug"] == "nibomo" and context["role"] in ["owner", "admin"], "Nibomo owner/admin access required")
    base = f"/api/organizations/{urllib.parse.quote(string(context['organization']), safe='')}"
    access = record(executor(f"{base}/access", "GET", None))
    require(access["organization"] == context["organization"] and access["role"] == context["role"], "Organization access changed")
    app_path = f"{base}/apps/{APP}"
    app = record(executor(app_path, "GET", None))
    require(app["id"] == APP and app["owner"] == access["owner"] and app["slug"] == "nibomo", "Unexpected owned app identity")
    authoring = record(executor(f"{app_path}/authoring", "GET", None))
    require(authoring["namespace"] == PACKAGE[1:].split("/")[0] and authoring["canEdit"] is True and authoring["canPublish"] is True,
            "Existing app edit/publish permissions required")
    working = record(executor(f"{app_path}/workspace", "GET", None))
    revision = record(working["revision"])
    working_commit = commit(revision["commit"])
    require(revision["code"] == app["repository"] and working["namespace"] == PACKAGE[1:].split("/")[0] and working["canEdit"] is True,
            "Unexpected working source identity or permissions")
    current = files(working["files"])
    deployed = record(executor(f"{app_path}/source", "GET", None))
    require(deployed["id"] == app["activeDeployment"] and deployed["code"] == app["code"]
            and deployed["owner"] == access["owner"], "Unexpected active deployment identity")
    package_query = urllib.parse.quote(PACKAGE, safe="")
    public_path = f"/api/registry/apps?name={package_query}"
    published_path = f"{base}/app-publications/published"
    published = listing(executor(published_path, "GET", None), published_path)
    published_commit = publication(published)
    public = listing(request(f"{HOST}{public_path}", "", "GET", None), public_path)
    require(publication(public) == published_commit, "Owned and public listings disagree before publication")
    snapshot = record(request(f"{HOST}/api/registry/source?name={package_query}&commit={published_commit}", "", "GET", None))
    require(publication(snapshot["publication"]) == published_commit, "Unexpected public source identity")
    deployed_commit = commit(deployed["sourceCommit"])
    deployed_files = files(deployed["files"])
    public_files = files(snapshot["files"])
    before_app_accounts = account_selections(f"{app_path}/accounts/app")
    before_user_accounts = account_selections(f"{app_path}/accounts/user")
    verify_remote_revisions(
        companion, intended, RemoteRevision(working_commit, current),
        RemoteRevision(deployed_commit, deployed_files), RemoteRevision(published_commit, public_files),
    )
    require(release_sha(companion, tag) == sha, "Release tag changed before publication")
    if current != intended:
        saved = record(executor(f"{app_path}/commits", "POST", {
            "expected": working_commit,
            "files": [{"path": path, "content": content} for path, content in intended.items()],
            "message": f"Publish Nibomo {tag} from {selected.repository}@{selected.sha} (companion release {sha})",
        }))
        saved_revision = record(saved["revision"])
        require(saved_revision["code"] == revision["code"], "Saved revision code mismatch")
        working_commit = commit(saved_revision["commit"])
        saved_working = record(executor(f"{app_path}/workspace", "GET", None))
        saved_working_revision = record(saved_working["revision"])
        require(saved_working_revision["code"] == revision["code"] and saved_working_revision["commit"] == working_commit
                and files(saved_working["files"]) == intended, "Saved source verification failed")
    note("Executor source commit", working_commit)
    unchanged = deployed_commit == working_commit and published_commit == working_commit
    if deployed_commit != working_commit:
        result = record(executor(f"{app_path}/deploy", "POST", {"commit": working_commit}))
        deployed = record(result["deployment"])
        returned_app = record(result["app"])
        require(returned_app["id"] == APP and returned_app["owner"] == access["owner"]
                and returned_app["activeDeployment"] == deployed["id"], "Deployment response app mismatch")
    require(deployed["sourceCommit"] == working_commit, "Deployment source commit mismatch")
    note("Deployment", f"{string(deployed['id'])} — commit {working_commit}")
    active = record(executor(app_path, "GET", None))
    verified = record(executor(f"{app_path}/source", "GET", None))
    require(active["activeDeployment"] == deployed["id"] == verified["id"] and verified["sourceCommit"] == working_commit
            and verified["owner"] == access["owner"] and files(verified["files"]) == intended, "Active deployment verification failed")
    require(account_selections(f"{app_path}/accounts/app") == before_app_accounts,
            "App account selections changed; inspect before publication")
    require(account_selections(f"{app_path}/accounts/user") == before_user_accounts,
            "Publisher user account selections changed; inspect before publication")
    latest_working = record(executor(f"{app_path}/workspace", "GET", None))
    require(record(latest_working["revision"])["commit"] == working_commit and files(latest_working["files"]) == intended,
            "Working source changed during deployment; reconcile before publication")
    if published_commit != working_commit:
        accepted = executor(f"{app_path}/publication", "POST", {"commit": working_commit})
        require(publication(accepted) == working_commit, "Accepted publication identity mismatch")
        note("Publication accepted", f"{PACKAGE} — {working_commit}")
    owned = listing(executor(published_path, "GET", None), published_path)
    require(publication(owned) == working_commit, "Publication readback mismatch")
    visible = items(request(f"{HOST}{public_path}", "", "GET", None))
    if not visible:
        note("Public listing", "Propagation pending; accepted publication verified, repeat the manual workflow to recheck")
    else:
        require(publication(listing(visible, public_path)) == working_commit, "Immediate public listing commit mismatch; inspect provider state")
        live = record(request(f"{HOST}/api/registry/source?name={package_query}&commit={working_commit}", "", "GET", None))
        require(publication(live["publication"]) == working_commit and files(live["files"]) == intended, "Public source mismatch")
        note("Public listing", "[Verified source](https://executor.sh/apps/nibomo.executor.community/nibomo)")
    note("Outcome", "No update needed" if unchanged and visible else "Operator-complete: deployment and accepted publication verified")
    note("Installed copies", "Remain independent; users must review and install the new source")


if __name__ == "__main__":
    main()
