# Portable OKF binding domain

Status: provider-domain foundation with manifest-owned binding wire commands.
The kernel remains the sole resolver and invocation broker.

## Contract

The provider contract is `oats.okf.locations@1`. A source-owned payload is:

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

- `fixed`: source-owned equality requirement; an adopter cannot rebind it.
- `default`: source fallback candidate; the shared kernel resolver may select a
  higher-authority candidate for the same field.
- `inherit`: required provider binding key such as `write.default`; no value is
  invented by the source.

`normalizeKnowledgeDeclaration()` validates this payload and emits requirements
and candidates under `/bindings/knowledge/...`. It never selects a winner.
`normalizeKnowledgeBindingCandidates()` converts an already-parsed
workspace/adoption/operator binding map into candidates for that same resolver.
The caller supplies origins; this module neither parses YAML nor fabricates source
provenance.

`bindKnowledgeDomain()` consumes the shared resolver's selected choices. It emits
nonsecret provider data with concrete stores keyed by stable store ID, store-ID
qualified reads, write destinations carrying the stable steward ID, and retained
selection/declaration provenance. Portable directory `path:/...` locators render
to the existing runtime's absolute `path` field only after selection. Every
owned node has either an explicit declared destination or the required
`write.default` choice. A read—even the sole configured public store—is never
used as an implicit write destination. Git locators retain the existing runtime's
explicit same-repository PR route, but that metadata grants no write authority
without an `owns` destination.

Normalization, selection rendering, and runtime document rendering are pure.
They do no filesystem/network access, credential lookup, provider enrollment,
publication, YAML decoding, or precedence resolution. The existing v2 runtime
remains the authority for filesystem containment, accepted base metadata, node
ownership, views, capture, workers and delivery.

## Captured runtime adapter

`renderKnowledgeRuntime()` converts the captured nonsecret bound domain into the
existing version-1 bindings and declaration documents. The host must supply a
normalized absolute durable `stateDir` and bindings descriptor path; neither is
derived from an instance home. Stable store IDs become runtime base aliases, and
store/node pairs become the existing `base/node` references.

`checkKnowledgeRuntime()` is the separate read-only custody boundary. It reuses
`validateBindings()`, `validateDeclaration()`, and `resolveNodes()` with accepted
base metadata produced by the existing validation path. It does not reload
current source/config documents, create state, initialize stores, or publish.

## Manifest-owned wire

The capability declares `binding-normalize`, `binding-bind`, and `binding-check`
under `binding.version: 1`. Their bounded stdin/stdout codec accepts decoded
values and supplied origins only. Workspace `oats.okf.locations@1` entries use
`payload.bindings`; adoption/operator inputs use their supplied `bindings` map.
The provider emits requirements/candidates for the kernel's shared resolver,
then binds only the selected choices.

The binding payload captures the nonsecret domain and rendered runtime documents.
Check validates that immutable relationship before read-only custody and accepted-
base checks. It never reloads source/config YAML or JSON, initializes a base,
enrolls a provider, starts a worker, or publishes.
