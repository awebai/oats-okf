# Captured invocation wire — coordinated unreleased revision

Implemented from the lifecycle owner's approved cross-owner handoff: check input
is exactly `{binding,context,action,invocation?}`. Normalize/bind are unchanged.
The final shared-kernel implementation hash must be tested before a consumer pin
is integrated or published. This source revision is not a release on old kernels.

## Single authority by phase

- **Check:** `input.invocation` is the only invocation authority. No environment
  file supplies/fills missing check input; file pointers are ignored for this
  phase. A present null/malformed/mismatched invocation refuses.
- **Execution:** the same projection is supplied by the kernel through private
  `OATS_INVOCATION_CONTEXT_FILE`, with binding separately supplied through the
  existing private binding snapshot. No duplicate binding or full runtime env is
  added to the generic context.
- **Scope:** generic scope checks can omit invocation. Identity-dependent
  messaging actions refuse missing invocation. Provider source-specific legacy
  authority checks remain separate; this revision does not weaken them.

## Projection and consumption checks

```
{schemaVersion:1,executionBinding,subject,
 instance:null|{home,work,name,agent},context,responsibleHuman,
 messagingChoice,capability,action,priorReceipt}
```

`subject` is the retained record union, not an alias-derived approximation:
`{kind:"persistent",soul:<SoulSelection>}` or
`{kind:"helper",provider:<CapabilityArtifactRef>,definition:<ResourceRef>,name}`.
Checks retain full values and verify closed structures, artifact/definition owner
consistency, subject/instance matching, human/messaging/context consistency and
exact requested capability/context/action. The kernel still owns canonical source
locator interpretation, retained artifact verification and executable approval;
provider-side structural validation does not discover or authorize a source.

Budgets: full invocation 512 KiB/depth32/16384 entries; opaque nullable prior
receipt 128 KiB/depth24/8192 entries. The existing bounded duplicate-safe UTF-8
phase decoder remains the only JSON decoder. No new config parser or resolver.

Generic receipt bounds do not certify provider receipt meaning or readiness.
In particular, setup authorization is not completed enrollment, and an old
resolution/home digest does not identify a fresh incarnation or admitted request.
Native mutation remains gated pending the exact generic identity contract.

## Provider pins

Both isolated providers receive matching consumption rules on separate commits.
Previous commits, including reviewed OKF runtime `7c57de9`, are preserved; they
are not amended or represented as accepting this revised check wire. OKF retains
its existing source receipt as supplemental registration input and its source-free
worker/delivery engine, promotion judgment and PR-only Git publication unchanged.
No settings/version floor, mirror, installation or live provider state is changed.
