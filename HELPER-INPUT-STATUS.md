# Capability-owned helper policy and source input — pairing candidate

This separate provider slice implements the approved exact c77 contract
(`c77f508647ca89b52b5399ec9cb117060348ed53`, subsequently approved for
implementation). It builds on the independent production generic execution
reader `f43996ded317d88b9696d8c00d521a6cf5a9a134`; it does not replace or alter the
accepted index-copy fix `ec5d7671799b3258aef69f9bbcf2c6480c4811ad`.

## Declaration and provider behavior

- `helperInjection:{version:1,mode:"omit"}` controls only OKF's own helper
  instruction contribution. The primary `inject` path is unchanged. Omission is
  **not** registration, recursive-harvest, store, deletion or publication consent.
- Existing `spawn` keeps its exact command and `required:true`, adding only
  `inputs.sourceReceipt:{version:1}`.
- Existing `retire` keeps its exact command and optional semantics in object
  form, adding that same input opt-in. No required-retire behavior is introduced.
- `soul-scaffold` stays its original command string, without any source input.

A captured NEW registration without SourceReceipt1 refuses before registration,
owner/view/working-memory/schedule or native effects, even with a structurally
valid admitted generic invocation. A missing receipt cannot authorize helper
skip from a live kind/name or a knowledge-slot heuristic. SourceReceipt1 and the
generic input's strict same-owner/subject/human/execution checks stay unchanged.

Absence is not consent and is not a generic dependency/readiness diagnosis.
Deliberate already-registered descriptor plus matching selected-binding replay
remains qualified by the existing provider contract, with or without a supplied
valid generic projection. It cannot create a new source/marker or repair a
missing registration by reading today's source/config. Invalid-present input
still refuses instead of downgrading. Source-bound retained-run completion is
unchanged; no helper binding replaces the source binding.

## Exact pairing still required

The kernel owner implements the shared manifest codecs/schema, original
manifest/owner/path witnesses, independent helper maps, no-new-legacy-omission
publication guard and same-owner per-hook input delivery. This provider must
consume their **exact committed producer and manifest schema**, not add another
generic resolver, policy/input codec or action registry. The old vendored closed
manifest schema cannot validate these new declarations until that schema is
synchronized; do not loosen unknown-property checks to hide this dependency.

Package/capability metadata remains `2.0.0` with its existing floor while this
unpublished candidate is paired. That metadata is **not a claim that OATS 0.23
supports these fields**. Before publication the coordinator must coordinate the
actual supporting kernel floor and provider version; no source-main, tag,
installation or compatibility qualification follows from these declarations.

Provider-controlled CLI cases verify NEW-source refusal, deliberate registered
replay, helper skip/recursion guards and retained source completion. They are not
kernel admission/opt-in derivation proofs. Exact producer preparation,
manifest-witness/receipt delivery, private snapshot cleanup and scaffold/retire
qualification remain part of the separately paired gate.

`E_CAPTURED_HELPER` and captured administration refusals remain closed. No
native helper/Pi/model/provider/privacy readiness is enabled. Check stdin and
generic invocation wire are unchanged; no identities, backend, harvester or
admission journal is added. Promotion and runtime Git **PR-only** publication
remain capability-owned and unchanged. Assigned independent reviewers own the
verdicts; developer evidence and coordinator gate collection are not substitutes.
