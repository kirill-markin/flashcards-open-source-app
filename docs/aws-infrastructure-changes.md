# AWS infrastructure changes

Use this procedure before changing CloudFormation stack boundaries, resource
ownership or deployment roles. Build, synthesize and deploy AWS artifacts only
in CI/CD. The [release gates](release-gates.md) own ordinary release checks;
the [monitoring migration](monitoring-stack-migration.md) owns its exact mappings,
roles, evidence format and recovery implementation.

## Prepare while ordinary releases remain possible

1. Separate the structural move from application, database and resource-property
   changes. Keep preparation commits compatible with the deployed topology and
   keep the ordinary release path usable until the ownership switch. Review
   [AWS refactor eligibility and restrictions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-refactoring.html)
   for every participating resource type and stack. Do not assume that a resource
   move can also change its configuration.
2. Map dependencies and outputs across every participating stack, including
   resources staying in place. Resolving an output or resource attribute can
   require a provider read of an unmoved resource, such as an RDS endpoint. Build
   the required-operation inventory from those dependencies, not just move actions.
3. Identify each principal before checking permissions:

   | Identity | Evidence to capture privately |
   | --- | --- |
   | CI/OIDC caller and assumed deployment roles | STS caller identity for each session and the role-assumption chain |
   | Native refactor API caller | Actual caller identity and provider-read preflight results under that session |
   | CloudFormation execution role | Stack/operation role ARN, trust and policies, and service-side evidence for required operations |

   A successful read under a developer or deployment role does not establish
   access for another caller. Verify required reads under the identity that
   performs them; establish the service execution context from operation evidence
   rather than assuming it is the API caller. See
   [CloudFormation service roles](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html).
   Use [IAM simulation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
   as supporting evidence: its result can differ from a live request. Prepare
   permissions and pass the read preflight before switching ownership. The
   [monitoring native server gate](monitoring-stack-migration.md#native-server-gate)
   documents the existing separate caller and RDS preflight.
4. Capture an encrypted private baseline: account/region, commit and CI run,
   authoritative stack IDs, logical-to-physical resource mappings for moved and
   surviving resources, deployed/proposed templates, parameters, outputs, roles,
   stack policies, tags and live resource settings. Record application health and
   data-preservation evidence appropriate to the affected services. Define the
   expected after-state and comparisons before executing. Publish only sanitized
   summaries; keep credentials, full templates and detailed configuration private.
5. Define the execution deadline, retry limit, stop conditions and recovery owner
   in the change procedure. Drain older releases and serialize ownership mutations
   with deployment under `main-release`. Do not rerun historical workflow code
   after ownership changes. Preparation can preserve release compatibility, but a
   failed mutation of a shared stack can still block subsequent releases; there
   is no guarantee of uninterrupted deployments or zero downtime.
   Before retrying production, isolated experiments should match resource count,
   native-created versus existing destination, naming, tags, dependencies and
   rollback residue. Record provided guidance separately from actual operation
   outcomes, physical/configuration preservation and restored deployment control.

## Execute once, then follow evidence

6. In CI, compare the prepared templates and inspect every page of the current
   server preview against the approved physical mappings and expected actions.
   Refresh the baseline checks immediately before execution. Stop on unexpected
   replacements, creates, deletes, configuration changes or ownership drift.
   Template equality and a successful preview are necessary gates, not proof
   that execution or recovery will succeed. Automatic rollback can also fail.
7. Execute only the reviewed operation and monitor its ID, all participating
   stacks and application health to the deadline. Preserve before/after evidence
   and exact API errors, request IDs and UTC timestamps. On failure, timeout or
   uncertain ownership, stop dependent deployments and inspect the live state
   before any retry. A timeout alone does not prove the operation stopped.
8. Retry only within the declared bound after a verified prerequisite changes or
   a documented transient condition clears. Stop identical failing operations;
   repeated rollback requests or changing skip lists without new evidence are
   not a recovery strategy. Use the
   [AWS rollback procedure](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html)
   and the reviewed migration-specific recovery path. `ResourcesToSkip` applies
   to eligible rollback failures and requires subsequent consistency repair;
   an accepted request alone does not prove repair. Do not delete/recreate
   resources, substitute retain/import, revert ownership or replace execution
   roles as an improvised way to unblock releases.
9. Escalate a stalled recovery to AWS Support with private account/region,
   stack ARNs, operation IDs, CI run/commit, UTC timeline, exact errors and
   sanitized request/response payloads, including supplied skip IDs and tokens.
   Include identity/policy evidence, template comparisons, physical-resource
   preservation checks, attempted recoveries and deployment impact. Keep case
   identifiers and correspondence private. If AWS asks to preserve the incident
   state, stop mutations until that hold is explicitly lifted; continue read-only
   evidence collection and health monitoring.

## Verify recovery before resuming normal operation

10. Record these four outcomes separately:

    | Outcome | Required evidence |
    | --- | --- |
    | Operable stack state | Fresh stack and operation statuses for every participating stack; unresolved operations accounted for |
    | Preserved resources and data | Expected physical IDs, ownership, templates/settings and service/data checks compared with the private baseline |
    | Healthy application | Current DB/auth/data health and the applicable release smoke results |
    | Restored deployment control | Supported reconciliation completed and an authorized CI deployment of a known commit passed its gates |

    `UPDATE_ROLLBACK_COMPLETE` alone establishes neither physical preservation
    nor a successful subsequent deployment. Historical `UPDATE_FAILED` resource
    entries alone do not establish that the current physical resources are broken;
    compare timestamps, live provider state and operation evidence. If bookkeeping
    conflicts with live state or the recovery driver rejects a support-recovered
    state, stop and obtain a supported reconciliation path instead of bypassing
    guards or fabricating success receipts. Reconcile skipped-resource/template
    inconsistencies before updating, as required by the AWS rollback procedure.
11. Resume through CI using freshly verified ownership and current templates,
    with the applicable preservation checks and release gates. Record the deployed
    commit and result. Until that deployment succeeds, report stack recovery and
    deployment verification separately. Retire temporary recovery machinery only
    after these outcomes are verified under the migration's cleanup procedure.

## Sanitized incident example

A monitoring split attempted to move CloudWatch alarms and Logs metric filters
while keeping the database in core. The RDS endpoint in core outputs still
required an RDS read. After the refactor failed, rollback encountered a null
`AlarmName` error, and `ResourcesToSkip` attempts did not restore deployment
control. The resulting stack state blocked releases. AWS Support recovered both
stack statuses to `UPDATE_ROLLBACK_COMPLETE` and said deployments could resume.
The subsequent bulk move failed with an unsupported Alarm tag-schema error and
rolled back with resources preserved. An isolated 58-alarm native move reproduced
that error without RDS; 2-, 10- and 25-alarm native moves succeeded. Two successive
2-alarm moves also verified stale-tag handling and reuse of an existing target,
with all 58 identities/configurations preserved, correct moved tags and cleanup.
These results support a bounded batching experiment, not a documented AWS limit,
a confirmed root cause, a patched service defect or a guaranteed production fix.
Production migration and a restored release remain unverified; report them
separately from successful diagnostics and recovered stack statuses.
