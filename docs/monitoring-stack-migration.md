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
roles separately from the original GitHub OIDC credentials. Before native preview,
the deployment role creates `FlashcardsOpenSourceAppMonitoringRefactorAccess`
using the unchanged bootstrap CloudFormation execution role. Its single role,
`cdk-monitoring-refactor-506210661494-eu-central-1`, trusts only the existing
GitHub deployment role. It has AWS managed `ReadOnlyAccess`, the two native
refactor APIs scoped to the exact source ARN and monitoring target name, and
CloudWatch TagResource/UntagResource scoped to the 58 existing alarm ARNs.
It has no additional provider writes or CloudFormation create/update permissions.

The policy is generated inline from the current physical inventory. An existing
access stack must match its template and single role identity. AssumeRole retries
only propagation AccessDenied errors, with warnings and a two-minute deadline.
The dedicated caller must read the original RDS instance before it creates or
executes a native refactor. Private evidence continues to use the file-publishing
role. The access stack is deleted only after verified native completion; an
already-split rerun verifies its receipt and ownership before pending cleanup.

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
target `STACK/CREATE`. Resource creation and unexpected tags/mappings stop before execution. Informational
action descriptions and the optional representation of STACK/CREATE are not
configuration gates: authoritative stack IDs and the exact 66 physical moves are.
The source template, resource identities, semantic outputs/parameters/role/tags
and live monitoring configuration must still match the captured baseline;
DescribeStacks timestamps and operation metadata do not establish configuration
drift.
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

## Startup reconciliation and interruption

The CI-only `reconcile` command runs before ownership resolution or ordinary
deployment, under the existing `main-release` serialization. It handles only native
operation `b25a93ec-bef4-4f12-9083-bdb41e4a5af3`, the original core ARN and the
original empty target ARN pinned in the helper. Original private evidence is
downloaded from the existing bootstrap bucket and hash checked before use.

For the source's `UPDATE_ROLLBACK_FAILED` state, reconciliation verifies all 497
original identities, the template, semantic stack settings and all 58 alarm /
8 filter / SNS live configurations. Latest alarm failures must belong to the
same incident's rollback interval, using the known prior recovery tokens or
the complete-set recovery token. Forward failures, other resource types and
unrelated failures stop the release.

Within a 600-second deadline, the helper submits the complete current failed
alarm set: the known null AlarmName InternalFailure and dependent cancellations
during that rollback. The [AWS rollback guide](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html)
allows failures during rollback and says dependent skips might not be necessary.
AWS remains authoritative on accepting the submitted IDs. Each mutation preserves
the original execution role, gets one CLI attempt and a deterministic token, and
requires fresh preservation proof. Overlapping sets are allowed when the set
changes, bounded by the original 58 alarms. Repeating an identical complete set
stops with failure evidence. Requests, accepted responses, events and snapshots
are private; an API rejection retains its exact error and current ownership.
CloudTrail omission of skip IDs or the token does not establish missing arguments.

Recovery must finish at `UPDATE_ROLLBACK_COMPLETE` with every resource complete
and original configuration intact. Only then may reconciliation delete the exact
`ROLLBACK_FAILED` target after proving it has zero resources. It uses standard
DeleteStack, never force deletion or retain/import. A ten-minute wait requires
`DELETE_COMPLETE`, followed by the complete original preservation proof.
An interrupted deletion can resume only for that original ARN with the same proof.

The encrypted `monitoring-refactor/aborted/<old-operation-id>.private.json`
receipt binds the old operation, both original stack IDs, the original evidence
hash and the final preservation evidence. It is distinct from a successful
migration receipt. Only this receipt plus authoritative deletion of the empty
old target permits the historical failed operation to be ignored. Once retired,
reruns use current ownership and do not compare later legitimate core deployments
against the incident's old Lambda versions.

The normal two-pass legacy deployment then establishes the current commit's
baseline before a fresh native preview using the same `cdk.out` staging directory.
No saved split assembly from the failed attempt is reused. Unknown unresolved
operations, partial ownership, AWS eligibility failures or live configuration
changes stop with the concrete error and evidence; they never trigger resource
recreation or a guessed native-status reset. An EXECUTE_COMPLETE operation without
its operation-linked verified receipt requires explicit recovery.

After native preservation and receipt creation, the temporary access stack is
deleted with the original deployment/execution roles and a bounded wait. The
ordinary split deployment restores target CDKMetadata, yielding 431 core / 67
monitoring resources. The existing database/schedule checks, web/Agent API/MCP
smokes and deployed-SHA recording must complete. Delivery evidence must also
confirm backend DB/auth/data health. Final removal of temporary migration
machinery remains a separate cleanup item after the full release is green.

After transfer, use fix-forward split releases. Never revert to the old topology,
rerun old legacy workflow code, delete/recreate monitoring resources, or substitute
retain/import. An inverse native refactor requires its own reviewed templates,
exact reverse physical mappings, server-action gate and CI execution. There is no
automatic destructive recovery. Remove the temporary legacy path only in the
separate finalization item after the move and normal release are verified.

References: [native CreateStackRefactor](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-stack-refactor.html),
[stack refactoring](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html),
[release gates](release-gates.md).
