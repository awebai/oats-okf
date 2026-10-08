# Portable OKF binding domain

How oats.okf 5.0 implements the provider side of portable knowledge bindings
(`lib/portable-binding.mjs`, `lib/binding-wire.mjs`). The kernel remains the
only resolver and invocation broker.

## Contract

The declaration contract is `oats.okf.locations@1`. A source-owned payload
is:

```json
{
  "owner": "stable-owner-id",
  "stores": {
    "public": {"fixed": {"id":"public-kb","kind":"git","repository":"https://example.test/knowledge.git","root":"knowledge","acceptedBranch":"main","pr":{"repository":"example/knowledge"}}},
    "local": {"default": {"id":"local-kb","kind":"directory","path":"path:/absolute/knowledge"}},
    "destination": {"inherit":"write.default"}
  },
  "reads": [{"store":"public","node":"reference"}],
  "owns": [{"node":"expert","destination":"destination"}]
}
```

Each store declaration has exactly one mode:

- `fixed`: a source-owned equality requirement; an adopter cannot rebind it.
- `default`: a source fallback candidate; the kernel's resolver may select a
  higher-authority candidate for the same field.
- `inherit`: a required binding key such as `write.default`; the source
  supplies no value.

`normalizeKnowledgeDeclaration()` validates the payload and emits
requirements and candidates under `/bindings/knowledge/...`; it never selects
a winner. `normalizeKnowledgeBindingCandidates()` turns an already-parsed
workspace, adoption or operator binding map into candidates for the same
resolver. The caller supplies origins.

The binding-key grammar reserves `stores.<alias>` for one complete store
alias: `stores.team.kb` addresses `/bindings/knowledge/stores/team.kb`, the
same field a declaration with alias `team.kb` emits. Other dotted names (for
example `write.default`) keep their path-segment grammar. Only the keys this
source's declaration owns are parsed as OKF locators; other providers'
entries in a shared map are ignored, not removed.

`bindKnowledgeDomain()` consumes the resolver's selected choices and emits
nonsecret provider data: stores keyed by stable store id, store-qualified
reads, write destinations carrying the steward (the declaration's owner),
and the selection and declaration provenance. A directory `path:/...`
locator becomes a plain absolute `path` only after selection. Every owned
node has an explicit destination or the required `write.default`; a read is
never used as a write destination.

Normalization and rendering are pure: no filesystem or network access, no
credential lookup, no YAML decoding, no precedence resolution.

## Runtime adapter

`renderKnowledgeRuntime({domain, stateDir, descriptorFile})` converts the
bound domain into the version 1 bindings document and soul declaration the
rest of oats.okf uses. The host supplies a normalized absolute `stateDir`
and descriptor path (the `state-dir` and `bindings-file` settings); neither
is derived from an instance home. Stable store ids become base aliases, and
store/node pairs become `base/node` references.

`checkKnowledgeRuntime()` is the read-only check of a rendered runtime: it
reuses `validateBindings()`, `validateDeclaration()` and `resolveNodes()`
against accepted base metadata. It creates no state and publishes nothing.

## Wire

The manifest declares `binding-normalize`, `binding-bind` and
`binding-check` under `binding.version: 1`. Input is bounded (1 MiB, depth
32, 16384 entries) strict JSON with duplicate keys refused.

- **normalize** accepts settings `bindings-file` and `state-dir` only and
  returns `{requirements, candidates, model: {domain, runtime:
  {descriptorFile, stateDir}}}`.
- **bind** returns a ProviderBinding1 body with `payloadVersion: 2` and a
  payload of `owner`, `stores`, `reads`, `owns` and `runtime`
  (`descriptorFile`, `bindings`, `declaration`). The 4.x payload's
  `execution` (harvest runtime and model) is gone.
- **check** answers readiness from the settings (or a retained binding):
  the soul declaration, each base (directory bases in place; Git bases
  through the host cache and a bounded `git ls-remote`), and the declared
  nodes. Problems and warnings use only the fixed strings and templates in
  the manifest's `binding.reasons` (24 entries, which must match the
  provider's byte for byte); no caught message, value, path or unknown key crosses the wire. The
  declared-node check always runs; its failure is `declaration:unresolved`.

Refusals:

- A **payloadVersion 1** binding (4.x, with `execution`) is `E_REMOVED`:
  check reports `needs-configuration` with reason `binding:v1-removed`.
- A 4.x setting (`harvest`, `harvest-runtime`, `harvest-model`) is
  `needs-configuration` with the `setting:removed` template, rendered with
  the origin the kernel reports in `OATS_SETTINGS_ORIGINS`
  (`E_REMOVED: <setting> <origin> was removed in oats.okf 5.0; <remedy>`).
- Check refuses the actions `setup`, `init`, `migrate`, `unlock`,
  `run-source` and `harvest` (`action:not-admitted`).

## Captured binding file

A command may be given `OATS_BINDING_FILE`, a private snapshot holding
exactly one ProviderBinding1. The file must be a normalized absolute,
non-symlinked, single-link, owner-only regular file within the wire limits;
any defect refuses (`E_BINDING`), and it never falls back to the settings or
the live soul. A payloadVersion 1 snapshot is `E_REMOVED`. Under a captured
binding, consult commands and `inspect` read the snapshot's runtime;
`setup`, `init`, `migrate` and `unlock` refuse (`E_MIGRATION`). Without
the variable, oats.okf reads the soul's `okf.json` and the bindings file.

The released OATS 0.44 kernel runs the check phase and names no
`OATS_BINDING_FILE`. Examples are in
[`examples/portable-binding/`](examples/portable-binding/).
