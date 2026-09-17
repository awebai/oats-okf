# Capability-owned helper policy and source input — paired candidate

The declaration/input guard was independently committed at
**0f809af150661ec9d6bd5eac2bdd5b6388c33ad1**, above production generic reader
**f43996ded317d88b9696d8c00d521a6cf5a9a134**. The separate schema-paired successor
uses exact producer **be2460c52bf5403d8edcc7058ffe8e0dc58d0952**. None of this
changes the delivered index/source checkpoint **ec5d767** or its failed logs.

## Declaration and provider behavior

- `helperInjection:{version:1,mode:"omit"}` controls only OKF's own helper
  instruction contribution. The primary injection is unchanged. Omission grants
  no registration, recursive-harvest, store, deletion or publication permission.
- Spawn retains its exact command and `required:true`, adding only
  `inputs.sourceReceipt:{version:1}`.
- Retire retains its exact command and optional semantics in object form, adding
  that input. No required-retire behavior is introduced.
- Soul-scaffold stays its original command string without source input.

Captured NEW registration without SourceReceipt1 refuses before registration,
owner/view/working-memory/schedule or native effects—even with an admitted generic
invocation. Missing input cannot authorize helper skip from live kind/name or a
knowledge-slot heuristic. SourceReceipt1 and the strict same-owner/subject/human/
execution checks stay unchanged.

Absence is not consent or a generic dependency/readiness diagnosis. Deliberate
registered descriptor plus matching binding replay remains governed by its
existing provider contract, distinct from NEW registration. Missing registration
cannot be reconstructed from a retained descriptor or today's source/config.
Invalid-present generic input cannot downgrade. The exact old-ingress/cutover
contract remains separately reviewable; old binding/receipt-only fixtures do not
prove current paired execution. SOURCE-bound existing-run completion never uses
a helper binding or invents a deleted live incarnation.

## Exact shared schema, no fork

Authoritative public file at **be2460c5**:
`docs/capability-manifest.schema.json`

Vendored byte-for-byte as `schemas/capability-manifest.schema.json`, SHA-256:
`52f82d5c3456178863e020a16c8881b7b62b96b985aebc343a099408c989a3f4`.

The existing repository-only validator now evaluates the schema's acyclic local
JSON-Pointer `$ref` definitions. Unresolved, remote or cyclic references refuse;
unknown properties stay closed. No helper/input protocol rules are copied into
another codec. Existing resource containment also checks a helper-only file's
existence/type and same-capability containment. None of this tooling is shipped
as a provider runtime/kernel import. The prior old-schema failure is historical,
not hidden by loosening `additionalProperties`.

## Bounded real producer evidence

`test/helper-input-pairing.test.mjs` is a NEW pairing fixture, not a relabelled257
fixture. It requires the exact producer revision and uses actual retained
preparation/approval/resources, then deletes the source repository and poisons
current config/lock before real public CLI spawn/hook dispatch.

It verifies primary/helper map separation, raw retained manifest equality, own
helper omission, canonical source role (not composed instructions), required
persistent registration, helper skip without ownership/registration, and captured
retire-hook input handling through the exported hook API. Current kernel
scaffold/index/admission with deliberately missing source input or partial fresh
transport refuses in the actual provider process under mutation tripwires.

After source-home deletion, real public raw SOURCE `retry` and `complete` consume
an explicitly seeded **retained-run fixture**. Wrong helper selection and missing
run refuse without source-state changes; existing receipt continuation succeeds.
This is not evidence that a new captured worker ever launched. Kernel snapshot
writers additionally exercise the real provider reader with malformed context,
wrong source binding and missing binding; private files are0600 and cleaned.
These controlled invalid transports are labelled separately from the unmodified
public CLI path. The same producer projection verifies inline-only check behavior
under poisoned execution-file environment pointers.

Tests use isolated non-Git runtime/HOME/OATS/TMP and synthetic source/accepted
base/run data. Kernel imports are TEST ONLY. Native/model/daemon/provider account
operations are blocked. Actual captured retire-HOOK verification is not a claim
that legacy config-chain retirement or every public retirement route supports
selected inputs. A separate unbound scaffold/layout/normal-retirement probe does
not replace captured provider retirement qualification.

## Remaining boundaries

Assigned reviewers own source/consumer verdicts, including exact legacy/current
cutover. Developer fixtures and coordinator gate collection are not acceptance.
No complete standalone/provider/native matrix is implied by the focused pairing.

Package/capability metadata still says `2.0.0` and its existing floor under
coordinator-owned publication ordering. This is **NOT a claim OATS0.23 supports
c77**. Truthful supporting kernel floor/provider version remains a release hold.
No source-main successor, tag, installation or rollout is authorized by this
fixture result.

`E_CAPTURED_HELPER` and captured administration guards remain. Actual public
helper consumption, managed runtime/Pi support and required Herdr/tmux parity
remain separate qualification. Check/generic wire and distributed provider
payload are unchanged by this schema/tooling/test successor. No backend,
identity/admission journal, resolver or harvester is added. Capability-owned
promotion and runtime Git **PR-only** publication remain unchanged.
