# Captured invocation wire — incarnation/intent successor

This separate consumer successor targets exact framework producer
**`257c4b96b67001fa2bcf38436e57106c44aa797b`**. The independent worker-index fix
is retained at `ce8980ba3f7f4b6b8c885ea8a7250977183a603a`, parent of this wire
work, and must not be confused with invocation compatibility or publication.

This is a coordinated revision of the **unreleased v1** projection. Earlier c5
consumers and source-main history are preserved, not silently reinterpreted.
Check input remains `{binding,context,action,invocation?}`; normalize/bind and the
existing strict JSON decoder, settings, manifests and version/floor are unchanged.

## Required projection and structural checks

```
{schemaVersion:1,executionBinding,subject,
 instance:null|{home,work,name,agent,incarnationId},
 intent:null|{schemaVersion:1,executionId,incarnationId,attempt},
 context,responsibleHuman,messagingChoice,capability,action,priorReceipt}
```

- Check consumes **inline invocation only**, never an environment file to fill
  missing or override supplied context. Scope checks can still omit invocation.
- Present invocation requires `intent`; non-null instance requires a lowercase
  UUIDv4 incarnationId. Old-c5 missing fields refuse—no defaults or backfill.
- Intent fields are closed, schemaVersion1; executionId matches
  `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`, attempt is a positive safe integer, and a
  non-null intent must match a non-null instance's incarnation.
- Exact retained persistent/helper subject structure and resource ownership,
  capability/context/action, home/work/agent, human/messaging consistency and
  prior-receipt bounds remain. Hooks require an instance; an explicit action
  capability must equal its owner.
- Existing512KiB/depth32/16384 overall and128KiB/depth24/8192 prior-receipt budgets
  remain. No new JSON/config parser, source resolver, identity minting or runtime
  kernel import.

The kernel owns current retained approval, incarnation/index/attempt custody and
admission; provider structural validation does not independently prove them.
A null intent grants no mutation authority. Composition/home/name/digest or a
synthetic fixture identity is not a substitute for an admitted request.

## Production execution-input consumer (separate successor)

The CLI now consumes `OATS_INVOCATION_CONTEXT_FILE` when supplied, paired with
its selected `OATS_BINDING_FILE`. Both are physical, same-user, single-link0600
snapshots read through bounded no-follow/nonblocking descriptors, with pre/post
path/inode/size/nanosecond checks and the existing strict JSON decoder. Context
uses the512KiB bound; binding uses its existing1MiB bound. Invalid-present input
never falls back. Check remains inline-only and does not use this reader.

Execution matches the actual event to the capability's EXISTING manifest hook,
command or operation table. Generic instance home is authoritative over ambient
identity variables; a contradictory explicit home refuses. SourceReceipt1 input
uses its unchanged256KiB/role bounds and is checked against the same subject,
instance, human, deployment/execution binding and provider binding. Saved source
descriptors are independently validated and must agree with the projection;
helper execution binding cannot replace source completion binding.

Fresh captured spawn/retire requires a non-null admitted instance intent. The
kernel proves current admission/ownership; provider shape checks do not create
that authority. New captured registration cannot be bootstrapped through an old
binding/source-receipt-only transport. A present unadmitted or contradictory
projection cannot downgrade to compatibility replay.

**Explicit compatibility, not inferred consent:** absent generic input may replay
an already validated, durably registered captured source with its matching
selected binding under the existing source contract. This path does not create a
source or manufacture an incarnation/intent. Stateless guidance and genuine
legacy operation remain separate; captured-home lifecycle cannot use an entirely
legacy ingress, and saved-data inspection does not grant mutation authority.

Raw scope complete/non-rejudging retry has no kernel instance intent. It may
process ONLY an already retained run under its exact source binding/descriptor
and existing input/judgment/receipt checks; run identity is checked before worker
state effects. This is retained-work authority, not a new generic mutation grant
or an invented live source after deletion. A retry without retained work cannot
create an unqualified captured helper.

Captured harvest/run-source/helper paths retain `E_CAPTURED_HELPER`; no actual
worker/runtime launch is enabled, including `--no-launch`. Captured administration
stays refused. Promotion judgment, PR-only Git publication and existing delivery
checks are unchanged; no direct accepted-branch delivery or kernel harvester.

## Focused producer evidence

`test/parent-invocation-codec.test.mjs` uses exact257 source via its sibling
archive or `OATS_INVOCATION_FRAMEWORK_ROOT`. Positive fixtures use fresh
`materializeCapturedDirectoryScaffold` homes with kernel-minted incarnation and
index custody. A supplied older/missing producer fails; absent optional producer
source is an explicit skip, not qualification.

Tests cover persistent/helper and workspace/standalone, actual kernel custody
admission/begin/replay primitives, the real OKF check CLI and execution reader,
old-c5 rejection, and a poisoned generic action rejected by the ACTUAL stateless
CLI. These controlled loaded-record fixtures are not full public retained-approval
admission or actual helper-launch qualification.

Separate provider-contract CLI fixtures exercise fresh admitted registration,
helper validation/skip, missing/null/mismatched admission with no effects,
registered-source compatibility without new registration, and source-deleted
completion using a scope/null-intent projection. A mismatched source resolution
refuses without changing retained runs/receipts. These explicit contract inputs
are not a backfill of old kernel metadata and are not labelled kernel admission
producers. No full provider suite is implied by these focused cases.

Coordinator owns the separate review, coherent follow-up integration gate and
publication. No full-suite rerun, metadata/floor change, installation, live setup,
provider authority lookup, model or timer is part of this consumer update.
