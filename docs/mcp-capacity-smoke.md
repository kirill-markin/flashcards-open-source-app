# MCP capacity smoke

The `MCP post-deploy smoke` job in `AWS/Web Release` runs
[`check-mcp-capacity-smoke.py`](../scripts/checks/check-mcp-capacity-smoke.py),
whose docstring states what it proves and what it never touches, after the
ordinary MCP endpoint smoke. Both gate the platform release under the existing
[release rules](release-gates.md).

## Run and inspect in CI

1. Open [AWS/Web Release](https://github.com/kirill-markin/flashcards-open-source-app/actions/workflows/aws-web-release.yml).
   Inspect the automatic run for the merged commit, or choose **Run workflow**
   on `main` when explicitly authorized to dispatch a release. Manual dispatch
   deploys all components before running the smoke.
2. Open **MCP post-deploy smoke → Run isolated MCP capacity smoke**. Confirm
   three `passed` results, whose expectations are `probe` in the script: the
   capacity refusal (`429`), then the worker's success (`201`) and error
   (`500`) passed through unchanged.
3. Require the final `cleanup: DELETE_COMPLETE` record for the logged
   `mcp-capacity-<run>-<attempt>-<suffix>` stack and a successful job summary.
   A probe failure still runs cleanup; cleanup failure fails the gate.
4. If cleanup fails, use the logged fixture stack name and lifecycle error to
   investigate through read-only AWS APIs. A terminated runner can interrupt
   cleanup. Arrange a reviewed CI cleanup for that exact run-owned stack before
   claiming completion; rerunning the workflow creates a separate fixture.
   Do not provision, update or delete these resources locally or in the console.
