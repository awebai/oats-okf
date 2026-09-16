# Portable OKF binding examples

These are data examples for the **planned, unreleased OATS 0.24.0 provider-binding
protocol**. They are not commands to run against OATS 0.23.x.

- `normalize-request.json` shows decoded source, workspace, adoption and operator
  inputs. The source fixes a public store, supplies a rebindable local default,
  and inherits `write.default`. The workspace entry uses the actual
  `knowledge.stores[].payload.bindings` shape. Inputs remain separate; OKF emits
  candidates and the kernel's one resolver selects them.
- `bind-request.json` is the subsequent bind request after that shared resolver
  selected the operator's `write.default`. It includes the resolver's
  `selectedBy`, `constraints` and `considered` evidence.
- `provider-binding.json` is the nonsecret ProviderBinding1 result. Stable store
  IDs are runtime aliases. It captures the effective v1 bindings/declaration,
  explicit host `stateDir` and descriptor location, and selected worker
  runtime/model. Credential values are absent.
- `captured-source-receipt.json` is the persistent lifecycle receipt shape. Its
  `responsibleHuman: null` means messaging was explicitly disabled; absence is
  not equivalent. A helper receipt instead uses `kind: "helper"` and
  `sourceIdentity: null`, and creates no OKF source or owner.

Every `/srv/oats/example/...` path and `example.invalid` URL is a documentation
placeholder. Real directory locators, state and descriptor locations must be
physical normalized absolute paths; symlink aliases are refused. Git publication
remains same-repository PR-only.

The manifest-owned `binding-normalize`, `binding-bind` and `binding-check`
commands are broker protocol entrypoints, not operator CLI recipes. Exact retained
artifact approval precedes any codec execution. Mutable check can report
`needs-configuration`, `authorization-required`, or `unavailable`; a populated
binding is not privacy, enrollment or readiness certification.
