# MCP capacity smoke

The `MCP post-deploy smoke` job in `AWS/Web Release` runs
[`check-mcp-capacity-smoke.py`](../scripts/checks/check-mcp-capacity-smoke.py)
after the ordinary MCP endpoint smoke. Both gate the platform release under the
existing [release rules](release-gates.md).

## Run and inspect in CI

1. Open [AWS/Web Release](https://github.com/kirill-markin/flashcards-open-source-app/actions/workflows/aws-web-release.yml).
   Inspect the automatic run for the merged commit, or choose **Run workflow**
   on `main` when explicitly authorized to dispatch a release. Manual dispatch
   deploys all components before running the smoke.
2. Open **MCP post-deploy smoke → Run isolated MCP capacity smoke**. Confirm
   three `passed` results: HTTP 429 with the capacity code, positive
   `Retry-After` and correlated request ID; HTTP 201 with preserved worker
   response; HTTP 500 with the worker's own error body and headers.
3. Require the final `cleanup: DELETE_COMPLETE` record for the logged
   `mcp-capacity-<run>-<attempt>-<suffix>` stack and a successful job summary.
   A probe failure still runs cleanup; cleanup failure fails the gate.
4. If cleanup fails, use the logged fixture stack name and lifecycle error to
   investigate through read-only AWS APIs. A terminated runner can interrupt
   cleanup. Arrange a reviewed CI cleanup for that exact run-owned stack before
   claiming completion; rerunning the workflow creates a separate fixture.
   Do not provision, update or delete these resources locally or in the console.

The fixture uses the existing GitHub OIDC → CDK deployment → CloudFormation
execution role chain. CloudFormation reuses only the deployed dispatcher's S3
artifact and execution properties, with a new target environment and narrow
fixture roles. It owns both Lambdas, their log groups and a public HTTP API using
payload format 1.0. Unsupported dispatcher or bootstrap configurations fail
explicitly. The target starts at reserved concurrency zero; only its fixture
reservation changes to one for the response checks. Production worker
reservation (12), database pool (3), credentials and data remain untouched.
