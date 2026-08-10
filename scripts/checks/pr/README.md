# Pre-merge static checks

Repository-wide consistency checks that run on every pull request through the
`repository_static_validation` job of [`.github/workflows/pr-checks.yml`](../../../.github/workflows/pr-checks.yml).
Its result is enforced by the required `Repository static checks` aggregate.

`run-all.mjs` discovers every `check-*.mjs` file in this directory, runs them in
sorted order from the repository root, and exits non-zero when any of them fails.
Adding a check means adding one file here; the workflow never needs to change.

## Convention for a check

- One standalone `check-*.mjs` file per check, plain ESM with no dependencies.
- Runnable directly: `node scripts/checks/pr/check-<name>.mjs` from the repository root.
- Offline and service-free: no network calls, no database, no AWS credentials.
- Fast: finishes in seconds, so it never becomes the slow part of a pull request.
- Exits `0` when the repository is consistent.
- Exits non-zero with an actionable message that names the exact files that
  disagree and what has to change to make them agree.

`PR_BASE_REF` is set in the workflow environment, so a check that needs the pull
request merge base can resolve it as `origin/${PR_BASE_REF}`.
