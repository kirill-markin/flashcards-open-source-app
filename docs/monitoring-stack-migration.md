# Monitoring stack migration

Normal releases use the `split` topology. The serialized `AWS/Web Release` job
reads actual CloudFormation ownership before deploying: no stacks takes a fresh
split deployment; all 66 in core with no target takes the migration path. A migrated
split installation requires its operation-linked private verified receipt and exact
current stack IDs and moved logical/physical IDs before normal deployment. A fresh
split installation with no prior native refactor does not need a migration receipt.
Mixed ownership, unstable stacks and unresolved prior native refactors stop the release.
The temporary `monitoringTopology=legacy` context is only for the initial
migration baseline. Never deploy a legacy assembly after ownership has moved.

The intended move is exactly 58 CloudWatch alarms and 8 Logs metric filters.
SNS topic/subscription, core outputs, functions, log groups and their retention
resources remain in core. Monitoring imports core references; core never imports
monitoring. The freshness metric retains the producer's core `StackName`.

## Preparation evidence

`AWS/Web Release` first aligns the current commit in legacy through the existing
DISABLED deployment, database verification, ENABLED deployment and schedule
verification. This migration release rejects schema changes since the last
successful platform release. It privately copies that deployment's `cdk.out` before
synthesizing the split topology into the same `cdk.out` staging location, then
copies the split assembly privately. The checkout, account, region, local context,
final schedule/cleanup flags and disabled source-map upload stay identical.

The pinned CDK uses output hashes for NodejsFunction assets and includes the
staging directory in its bundling cache key. Local esbuild source maps contain
paths relative to the bundle output directory, so synthesizing directly into a
new evidence directory changes Lambda assets. Reusing the original output path
preserves those inputs; it does not guarantee that bundling is skipped. Any
remaining asset or migration-version difference must still fail comparison.
See [CDK asset staging](https://github.com/aws/aws-cdk/blob/v2.270.0/packages/aws-cdk-lib/core/lib/asset-staging.ts),
[NodejsFunction bundling](https://github.com/aws/aws-cdk/blob/v2.270.0/packages/aws-cdk-lib/aws-lambda-nodejs/lib/bundling.ts)
and [esbuild source-map paths](https://github.com/evanw/esbuild/blob/v0.28.2/internal/linker/linker.go#L7097-L7111).

The comparison helper requires the same alarm/filter logical IDs and relative
construct paths, unchanged resource properties after expanding only literal CDK
imports of direct core `Ref`/`Fn::GetAtt` exports, unchanged surviving resources
(including Lambda asset keys, versions, API deployments and settings), and
unchanged published outputs. It classifies CDK telemetry, bootstrap checks and
new exports explicitly. Unnamed alarms/filters remain unnamed in both templates;
their actual CloudFormation-generated physical names must be preserved and
verified by the server refactor, not guessed or newly set in code.

The private runner directory `${RUNNER_TEMP}/monitoring-refactor` contains the
legacy/split assemblies and detailed `report/evidence.private.json`. Only
`resource-mappings.json` and a sanitized count/status summary are uploaded.
Do not upload templates, local context or the private report as public artifacts.
A failed comparison blocks the release before any ownership mutation. A passing
comparison proves template equivalence
within the stated boundary, **not AWS refactor eligibility**.

To repeat preparation, run from `infra/aws` in the same cloud job after a fresh
successful final legacy deployment; do not synthesize deployment artifacts
locally. The evidence directory must not already exist. Preserve earlier evidence
separately before repeating; never reuse a split assembly as the legacy baseline.

```bash
set -euo pipefail
umask 077
evidence_directory="${RUNNER_TEMP}/monitoring-refactor"
mkdir "${evidence_directory}"
for baseline_file in manifest.json FlashcardsOpenSourceApp.template.json FlashcardsOpenSourceApp.assets.json; do
  if [[ ! -s "cdk.out/${baseline_file}" ]]; then
    echo "Missing final legacy assembly file: cdk.out/${baseline_file}" >&2
    exit 1
  fi
done
if [[ -e cdk.out/FlashcardsOpenSourceAppMonitoring.template.json ]]; then
  echo "Expected the final legacy assembly; cdk.out contains a monitoring preview." >&2
  exit 1
fi
cp -R cdk.out "${evidence_directory}/legacy"
SENTRY_UPLOAD_BACKEND_SOURCEMAPS=false npx cdk synth --all --quiet \
  --output cdk.out \
  -c monitoringTopology=split \
  -c generatedMediaPromotionScheduleState=ENABLED \
  -c mediaBlobCleanupEnabled=true \
  -c multipartCompletionReconciliationScheduleState=ENABLED
cp -R cdk.out "${evidence_directory}/split"
python3 ../../scripts/deploy/prepare-monitoring-refactor.py \
  --legacy-assembly "${evidence_directory}/legacy" \
  --split-assembly "${evidence_directory}/split" \
  --output-directory "${evidence_directory}/report"
```

After preview synthesis, `cdk.out` must not deploy until the native move and
identity/configuration checks pass. The workflow then deploys this original,
unadapted split assembly and continues the existing release smoke gates.

## Native server gate

Before merging the migration PR, inspect queued/in-progress `AWS/Web Release`
runs and drain older releases. Keep the complete operation under the existing
`main-release` concurrency group. Do not rerun historical pre-migration workflow
runs: new ownership guards cannot change the workflow code stored in old runs.

`scripts/deploy/migrate-monitoring-stack.py` uses AWS CLI 2.36.24 and the public
CloudFormation API. It assumes the existing lookup, file-publishing and deployment
roles separately from the original GitHub OIDC credentials. No bootstrap or IAM
change is part of this operation. A permissions failure stops the release.

The driver refreshes templates, stack policies, resource inventories, supported
resource types, all alarm/filter configurations and the confirmed SNS subscription.
It checks the freshly deployed template against the exact legacy assembly and
runs the strict raw assembly comparison before adapting transport templates.
Following the pinned [CDK transport implementation](https://github.com/aws/aws-cdk-cli/blob/aws-cdk%40v2.1142.0/packages/%40aws-cdk/toolkit-lib/lib/api/refactoring/stack-definitions.ts),
only deployed core CDKMetadata is preserved, target CDKMetadata is omitted, and
the checked target BootstrapVersion/CheckBootstrapVersion bookkeeping is removed.
Any workload reference to that parameter or other required adaptation stops work.

Templates and detailed snapshots are encrypted private objects under
`monitoring-refactor/<run-id>/<attempt>/<content-hash>/` in the existing bootstrap
bucket `cdk-hnb659fds-assets-506210661494-eu-central-1`. The driver supplies private
TemplateURLs, never public templates or configuration artifacts. The operation ID
appears in the job log and in private evidence. Credentials remain in subprocess
environments. Only sanitized mappings/counts are public artifacts.

`CreateStackRefactor` must reach `CREATE_COMPLETE` / `AVAILABLE`. Every paginated
server action must match the exact 66 physical resource moves and optionally one
target `STACK/CREATE`. Resource creation and unexpected tags/mappings stop before
execution. MOVE descriptions must be exactly `No configuration changes detected.`
or `Resource configuration changes will be validated during refactor execution.`
The [AWS procedure](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html#stack-refactoring-cli)
documents both descriptions before execution. Deferred validation does not permit
configuration changes; the strict template and preservation gates still apply.
The source template, stack,
identities and monitoring configuration must still match the captured baseline.
The driver executes only that refactor ID and requires `EXECUTE_COMPLETE`, then
polls both authoritative stack IDs for up to ten minutes. Only expected create/update
progress is tolerated; failure, rollback, API errors or timeout stop before postchecks.

Before ordinary split deployment, it verifies all remaining core identities,
all 66 moved identities, original outputs, stable stacks, alarm configuration,
exact filter name/log-group pairs and the confirmed subscription. Alarm evaluation
state/timestamps are excluded. Only after every check and the private after-snapshot
upload succeeds does the driver write the encrypted private receipt at
`monitoring-refactor/verified/<sha256-of-operation-id>.private.json` in the same
bootstrap bucket. It records the operation ID, both stack IDs and exact moved
inventory. Later releases require that receipt and compare current moved identities;
they do not recompare old Lambda versions or surviving-core snapshots after normal
releases have legitimately updated them. The normal split deploy restores target CDK
metadata/bootstrap bookkeeping (66 moved resources become 67 target resources).
The current server preview remains an execution gate; prior template comparison
alone does not prove AWS eligibility.

## Interruption and recovery

On failure, retain the operation ID and private evidence, inspect both stacks and
`describe-stack-refactor`, and stop before any further deployment. Failed,
obsolete, available or in-progress operations require deliberate inspection and
an explicitly reviewed resume; the driver never guesses or automatically retries
a prior operation. An `EXECUTE_COMPLETE` operation without its matching verified
receipt is also blocked with its operation ID, even when ownership already moved.
For explicit recovery, retain the original private before/after evidence and establish
all original identity, output and runtime preservation checks in a separately reviewed
CI procedure before writing a receipt. Never write one merely because execution
completed or type counts match. Recovery is limited to the reviewed operation below.
A preview may reserve an empty target stack. Do not delete it
or recreate resources to clear a blocked run.

### Unchanged alarm rollback recovery

CI runs `recover-unchanged-alarms` before `recover-core`. This incident-only path
requires the pinned failed native operation, both original stack ARNs, the empty
failed target, and the original 497 identities, template, stack settings and
58 alarm / 8 filter / SNS live configurations. Only original alarms may be failed;
all other resources must be complete. The latest rollback interval must match the
known prior recovery token/operation or this command's incident-specific tokens.

Within one 600-second deadline, CI selects currently failed alarms with the known
null `getAlarmName()` / `InternalFailure`, refreshes preservation and event proof,
and submits [ContinueUpdateRollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ContinueUpdateRollback.html)
with only those IDs, the original execution role and a stable token derived from
the selected IDs. Each submission makes one CLI attempt. Further original alarms
with the same provider failure are handled automatically, up to 58 distinct skips.
Cancelled updates are never skipped unless a later attempt actually returns the
known provider error. API errors, timeout, unrelated operations, other failures,
configuration changes and no eligible progress stop recovery.

Exact original live configuration equality is the preservation contract; this
path does not use the drift API. Completion (including an already restored source)
requires full preservation and every resource complete. Private
`alarm-recovery-*.private.json` snapshots, events and accepted requests use the
existing encrypted evidence bucket. This creates no migration receipt: native
`ROLLBACK_FAILED` still blocks deployment. Native/target reconciliation and live
health verification remain separate delivery responsibilities.

### Original core rollback recovery

Before the reviewed native resume, CI runs `recover-core` for the pinned failed
operation below. It requires native `ROLLBACK_FAILED`, the exact original source
in `UPDATE_ROLLBACK_FAILED`, and the exact empty target in `ROLLBACK_FAILED`.
The hashed original evidence must match all 497 identities, the source template,
outputs, parameters, tags, execution role and alarm/filter/SNS configurations;
every resource must have a completed status. The command invokes only
[ContinueUpdateRollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ContinueUpdateRollback.html)
on the original source ARN with its original CloudFormation execution role and a
stable incident token, without skipping resources. It polls rollback progress for
up to ten minutes and repeats the preservation proof at `UPDATE_ROLLBACK_COMPLETE`.
An already restored source requires the same proof without another rollback call.
Other states remain subject to the existing native and ownership guards.

Private `core-recovery-before.private.json` and `core-recovery-after.private.json`
evidence uses the existing encrypted bucket and run/hash prefix. This does not
produce a migration receipt, retry the native operation or change the empty target.
The unchanged resume guard still rejects native `ROLLBACK_FAILED`, so the release
remains blocked even after core control is restored. Further native recovery,
permissions and cleanup require a separate reviewed plan.

### Reviewed available-operation resume

Before ownership resolution or any ordinary CDK deployment, `AWS/Web Release`
runs the CI-only `resume-reviewed` command under `main-release` concurrency with
the pinned AWS CLI. It may execute only operation
`b25a93ec-bef4-4f12-9083-bdb41e4a5af3`, using the exact source and target ARNs and
three SHA256 evidence digests embedded in `migrate-monitoring-stack.py`.
It never creates another preview or realigns the source to the current commit.

The original `operation.private.json`, `before.private.json` and
`actions.private.json` are downloaded privately from the bootstrap bucket under
`monitoring-refactor/36241107324/1/<content-hash>/` using the file-publishing role.
Every hash is checked before parsing. Do not print these snapshots or upload them
as artifacts. The original transport templates remain at that prefix unchanged.

Execution requires `CREATE_COMPLETE` / `AVAILABLE`, no other unresolved relevant
refactor, the original `UPDATE_COMPLETE` source with all 497 identities, template,
stack state/outputs and alarm/filter/SNS configurations unchanged, no source stack
policy, and the exact empty target in `REVIEW_IN_PROGRESS`. Current actions must
match the saved actions and the exact 66 original moves, allowing only the two
documented MOVE descriptions to differ. The driver repeats this freshness check
immediately before executing the pinned ID, then uses the same stabilization,
preservation, private after-snapshot and verified-receipt path as the initial move.

Later releases accept this operation only at `CREATE_COMPLETE` / `EXECUTE_COMPLETE`
with its existing verified receipt and matching current stack/moved identities.
They do not compare obsolete core Lambda versions against the original snapshot.
If the pinned ID is absent, the existing ownership gate must pass before returning
to the generic fresh, legacy or split path; other unresolved operations and reserved
empty targets remain blocked. Missing evidence, drift, unexpected statuses and
execution without a verified receipt stop the release for a new reviewed procedure.

After a verified native move, ordinary ownership resolution selects split and the existing
two-pass deployment, database/schedule verification, web/API/MCP smokes and deployed
SHA recording must complete. Cleanup remains separate until that full release and
the expected 431 core / 67 monitoring resources are verified.

After transfer, use fix-forward split releases. Never revert to the old topology,
rerun old legacy workflow code, delete/recreate monitoring resources, or substitute
retain/import. An inverse native refactor requires its own reviewed templates,
exact reverse physical mappings, server-action gate and CI execution. There is no
automatic destructive recovery. Remove the temporary legacy path only in the
separate finalization item after the move and normal release are verified.

References: [native CreateStackRefactor](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-stack-refactor.html),
[stack refactoring](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html),
[release gates](release-gates.md).
