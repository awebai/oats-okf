# Portable OKF binding examples

Data examples for the OKF provider-binding wire (oats.okf 5.0). The source
`knowledge` envelope (`oats.okf.locations@1`) is covered by
`schemas/okf-portable-declaration.schema.json`; the provider-owned `payload`
in ProviderBinding1 (payloadVersion 2) by
`schemas/okf-portable-payload.schema.json`. The generic wire envelopes are
kernel-owned.

- `normalize-request.json` shows decoded source, workspace, adoption and
  operator inputs. The source fixes a public store, supplies a rebindable
  local default, and inherits `write.default`. The workspace entry uses the
  `knowledge.stores[].payload.bindings` shape. Inputs stay separate; OKF
  emits candidates and the kernel's one resolver selects them. The settings
  are `bindings-file` and `state-dir` only: a 4.x `harvest`,
  `harvest-runtime` or `harvest-model` is refused as `needs-configuration`
  with an `E_REMOVED` message.
- `bind-request.json` is the bind request after that resolver selected the
  operator's `write.default`, with the resolver's `selectedBy`,
  `constraints` and `considered` evidence. Its runtime model is
  `{descriptorFile, stateDir}`.
- `provider-binding.json` is the resulting nonsecret ProviderBinding1,
  `payloadVersion: 2`: `owner`, `stores`, `reads`, `owns` and `runtime` (the
  rendered version 1 bindings and declaration, with the host `stateDir` and
  descriptor location). There is no `execution` (the 4.x harvest
  runtime/model), and a payloadVersion 1 binding is refused. Stable store ids
  are the runtime aliases. Credential values are absent.

Running the bind request through `binding-bind` produces exactly
`provider-binding.json`.

Every `/srv/oats/example/...` path and `example.invalid` URL is a
placeholder. Real directory locators, state and descriptor locations must be
physical normalized absolute paths; symlink aliases are refused. Git
publication is same-repository PRs only.

`binding-normalize`, `binding-bind` and `binding-check` are kernel protocol
entrypoints, not operator commands. Check can report `ready`,
`needs-configuration` or `unavailable`; a populated binding is not readiness
or privacy certification.
