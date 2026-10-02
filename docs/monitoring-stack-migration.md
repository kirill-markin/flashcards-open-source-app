# Monitoring stack migration

Read the [AWS infrastructure change procedure](aws-infrastructure-changes.md)
before preparing or executing this migration.

The four-batch procedure requires the reviewed engine and CI wiring together.
Do not deploy the integration branch until all rollout changes are integrated,
the full promotion review passes and required cloud checks are green.

Normal releases use the `split` topology. The serialized `AWS/Web Release` job
reads actual CloudFormation ownership before deploying: no stacks takes a fresh
split deployment; all 66 in core with no target takes the migration path. A migrated
split installation requires its linked private verified receipt chain and exact
current stack IDs and moved logical/physical IDs before normal deployment. A fresh
split installation with no prior native refactor does not need a migration receipt.
Partial ownership, unstable stacks and unresolved native refactors stop automatic releases.
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
successful platform release. If that SHA is missing, only the applicable verified
aborted-attempt receipt permits its pinned schema anchor; each anchor follows a
completed legacy deployment and DB verification. It is not a successful release
SHA and never populates deployed-SHA parameters.
An unreadable SHA still stops the migration. It privately copies the fresh
legacy deployment's `cdk.out` before synthesizing the split topology into the same
`cdk.out` staging location, then
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
identity/configuration checks pass for all four batches. The workflow then deploys this original,
unadapted split assembly and continues the existing release smoke gates.

## Native server gate

Before merging the migration PR, inspect queued/in-progress `AWS/Web Release`
runs and drain older releases. Keep the complete operation under the existing
`main-release` concurrency group. Do not rerun historical pre-migration workflow
runs: new ownership guards cannot change the workflow code stored in old runs.

`scripts/deploy/migrate-monitoring-stack.py` uses AWS CLI 2.36.24 and the public
CloudFormation API. It assumes the existing lookup, file-publishing and deployment
roles separately from the original GitHub OIDC credentials. Require the existing
`FlashcardsOpenSourceAppMonitoringRefactorAccess` stack unchanged; do not create or
expand IAM for this rollout. Its single role,
`cdk-monitoring-refactor-506210661494-eu-central-1`, trusts only the existing
GitHub deployment role. It has AWS managed `ReadOnlyAccess`, the two native
refactor APIs scoped to the exact source ARN and monitoring target name, and
CloudWatch TagResource/UntagResource scoped to the 58 existing alarm ARNs.
It has no additional provider writes or CloudFormation create/update permissions.

The policy is generated inline from the current physical inventory. An existing
access stack must match its template and single role identity. AssumeRole retries
only propagation AccessDenied errors, with warnings and a two-minute deadline.
The dedicated caller must read the original RDS instance before it creates or
executes a native refactor. The driver privately captures its actual STS identity
and the stored source/access execution roles, and logs sanitized role names before
the RDS preflight. Private evidence continues to use the file-publishing
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

Before the first move, preserve one immutable private manifest binding the commit,
original 497-resource baseline, approved raw/transport templates and asset manifests.
Keep the full 66-resource raw comparison authoritative. Partition sorted logical IDs
into exactly four disjoint batches: 8 metric filters, then 25, 25 and 8 alarms.
Keep all approved core exports from batch one; move only the selected definitions
and reject dangling dependencies. Expected core/target counts are 489/8, 464/33,
439/58 and 431/66. Never resize batches, retry them adaptively or fall back to 66.

Refresh the existing OIDC credentials and assume the existing roles before each
bounded batch and final deployment; the serialized job has a 180-minute deadline.
`CreateStackRefactor` must reach `CREATE_COMPLETE` / `AVAILABLE`. Every paginated
server action must match that batch's exact physical moves and intended system-tag
changes. Only batch one permits an optional target `STACK/CREATE`; later batches
must use the same authoritative target ARN with no stack creation. Unexpected
resource creation, tags or mappings stop execution. Record each accepted operation
privately before execution; a preview is not proof of successful execution.
Source/target templates must match the approved cumulative partition; identities,
original outputs/parameters/role/tags and live configuration must match the baseline.
Only the approved extra core exports are allowed;
DescribeStacks timestamps and operation metadata do not establish configuration
drift.
The driver executes only that refactor ID and requires `EXECUTE_COMPLETE`, then
polls both authoritative stack IDs for up to ten minutes. Only expected create/update
progress is tolerated; failure, rollback, API errors or timeout stop before postchecks.

Before and after every batch, verify the full original 497-resource partition,
current cumulative templates, original outputs/settings and all alarm/filter/SNS
configurations, excluding alarm evaluation state/timestamps. Preserve user tags;
unmoved alarms may retain their original stale system tags, but every moved alarm
must carry the current target's system tags.
After these live preservation checks and verification of relevant operations pass,
the driver privately uploads an immutable receipt containing operation and resource
identities, linked to the manifest and previous receipt. The
ordered, contiguous, disjoint chain must cover all 66 moves before ordinary deployment.
Later releases verify that chain, stack IDs and current moved identities without
pinning old Lambda versions or legitimately changed configurations. The normal split deploy restores target CDK
metadata/bootstrap bookkeeping (66 moved resources become 67 target resources).
The current server preview remains an execution gate; prior template comparison
alone does not prove AWS eligibility.

## Startup reconciliation and interruption

The CI-only `reconcile` command runs before ownership resolution or ordinary
deployment, under the existing `main-release` serialization. Original-incident retirement binds native
operation `b25a93ec-bef4-4f12-9083-bdb41e4a5af3`, the original core ARN and the
original empty target ARN pinned in the helper. Original private evidence is
downloaded from the existing bootstrap bucket and hash checked before use.

Reconciliation accepts only both pinned stacks at `UPDATE_ROLLBACK_COMPLETE`
with the original operation still `ROLLBACK_FAILED`. It verifies all 497 original
identities, the template, semantic stack settings and all 58 alarm / 8 filter /
SNS live configurations. The 22 historical alarm `UPDATE_FAILED` entries must
match their pinned logical IDs, types, statuses, timestamps and failure reasons.
Any other failed resource or changed historical failure stops the release. A
regression to failed stacks stops without submitting another rollback request.

Only after this preservation proof may reconciliation delete the exact recovered
target after proving it has zero resources. It preserves the original execution
role and uses standard DeleteStack, never force deletion or retain/import. A
ten-minute wait requires `DELETE_COMPLETE`, followed by the complete original
preservation proof. An interrupted deletion can resume only for that original ARN
in `DELETE_IN_PROGRESS` or `DELETE_COMPLETE` with the same proof.

The encrypted `monitoring-refactor/aborted/<old-operation-id>.private.json`
receipt binds the old operation, both original stack IDs, the original evidence
hash, schema anchor and the final preservation evidence. It is distinct from a
successful migration receipt. Only this receipt plus authoritative deletion of the empty
old target permits the historical failed operation to be ignored. Once retired,
reruns use current ownership and do not compare later legitimate core deployments
against the incident's old Lambda versions.

The separate retry reconciliation retires only the pinned second failed attempt
at `ROLLBACK_COMPLETE`. Hash-checked private evidence must prove all 497 original
identities/configurations, the exact historical failures and that attempt's exact
empty target before deletion. Repeat preservation proof after deletion and retain
its own aborted receipt/schema anchor; neither incident receipt proves migration.

The normal two-pass legacy deployment then establishes the current commit's
baseline before a fresh native preview using the same `cdk.out` staging directory.
No saved split assembly from the failed attempt is reused. Unknown unresolved
operations, AWS eligibility failures or live configuration
changes stop with the concrete error and evidence; they never trigger resource
recreation or a guessed native-status reset. An EXECUTE_COMPLETE operation without
its operation-linked verified receipt requires explicit recovery.

Startup checks the private manifest and all relevant operations before deployment.
A verified partial prefix requires explicit same-commit continuation; ordinary
releases stop before any legacy or split deployment. Dispatch `AWS/Web Release`
at the exact original commit ref with `monitoring_manifest` set to the exact private
manifest key reported by the startup guard. Keep that key private. Continuation
rechecks and skips completed batches, runs only the remaining sequence and never repeats legacy
DB/deployment steps. Prove saved split-template and asset-manifest equality before
final deployment. Unknown, failed, active or unreceipted operations require separate
reviewed recovery, including `EXECUTE_COMPLETE` without its verified receipt.
Interruption after the fourth receipt but before final split deployment still
requires this explicit continuation; four receipts alone do not restore releases.

After all four linked receipts and full preservation proof, the temporary access stack is
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
