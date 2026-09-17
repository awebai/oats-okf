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

## Execution and capability boundaries are unchanged

The kernel supplies the same generic projection through its private invocation
snapshot for execution. **This OKF CLI still uses its existing captured binding,
source-receipt and durable descriptor authority; this commit does not add a
production generic invocation-file execution reader.** The exported shape codec
validates the private snapshot in the focused consumer fixture, not as a claim
that the stateless CLI consumes generic admission authority.

Captured harvest/run-source/helper paths retain `E_CAPTURED_HELPER`; no captured
worker/runtime launch is enabled, including `--no-launch`. Saved input/receipt
custody, existing completion, lifecycle registration/final capture, promotion
judgment and PR-only runtime Git knowledge publication stay unchanged. No direct
accepted-branch delivery or kernel knowledge policy is added.

## Focused producer evidence

`test/parent-invocation-codec.test.mjs` uses exact257 source via its sibling
archive or `OATS_INVOCATION_FRAMEWORK_ROOT`. Positive fixtures use fresh
`materializeCapturedDirectoryScaffold` homes with kernel-minted incarnation and
index custody. A supplied older/missing producer fails; absent optional producer
source is an explicit skip, not qualification.

Tests cover persistent/helper and workspace/standalone, actual kernel custody
admission/begin/replay primitives, the real OKF check CLI, private snapshot shape,
old-c5 rejection and preserved stateless binding-based guidance. These controlled
loaded-record fixtures do **not** prove public retained-approval admission,
production generic-context execution, source registration or helper launch.

Coordinator owns the separate review, coherent follow-up integration gate and
publication. No full-suite rerun, metadata/floor change, installation, live setup,
provider authority lookup, model or timer is part of this consumer update.
