# OKF v2 public runtime boundary

The **2.0.0 pre-tag candidate** requires **OATS >=0.23.0**. The historical v1
extraction inventory (private agent lookup/registration, settings resolution,
attached/worktree spawning; floor >=0.19.0) is not the v2 runtime contract.
No private kernel API or additional knowledge-specific kernel behavior is
required by this candidate.

## Declared capability and command transport

`oats-package/oats-package.json` enumerates only `capabilities/oats-okf/`.
That subtree contains the capability-defined `memory-harvest` service agent,
skills, schemas, injection and executable. Obsolete unenumerated root runtime
copies have been removed. The exported worker preserves canonical `AGENTS.md`
and the relative `CLAUDE.md -> AGENTS.md` compatibility symlink.

The public dispatcher supplies the absolute `OATS_CLI_BIN`, effective
`OATS_SETTINGS` and documented hook/instance context. `lib/io.mjs` requires that
authored CLI path, invokes it with argv-safe subprocesses, and clears source
identity from child command environments. It does not discover a kernel root,
search PATH for oats, call `oats root`, or import private kernel modules.
Generated completion commands quote every shell argument. Worker task files are
owner-only temporary files removed on every outcome.

## Required public surfaces

- **Directory workers:** `oats spawn memory-harvest --work directory --no-launch
  --json`, followed by the public session-start surface when launch is requested.
  Workers use a durable deployment context and independent directory work, never
  source attachments, branches or interviews. Source retirement does not remove
  their copied input or provider receipts.
- **Native record capture/recall:** `capture --home` and `recall --ids-only`
  provide certified session boundaries and byte metadata. The provider plans
  bounded full-text recall windows before copying evidence. Native record JSON
  is distinct from the command JSON-v1 envelope; incomplete capture and oversized
  turns fail closed. Inspection does not invoke capture or alter this contract.
- **Generic scheduler command jobs:** add/show/list/enable/disable and explicit
  host installation. Each source owns a durable descriptor-selected command;
  existing disabled jobs remain disabled. Hooks never install a host timer.
- **Generic inspection/operations:** `oats inspect --home` discovers the declared
  `knowledge:inspect` view and `knowledge:harvest` action. `oats operation run
  knowledge:inspect --home ... --json` relays the provider's labeled documents
  and receipts without launching a worker. The provider must drain the complete
  JSON answer through its stdout pipe, including large live Markdown and receipts.
- **Post-home command dispatch:** `oats okf ... --source <descriptor> --soul
  <source-soul>` remains activation/trust-gated in deployment context after
  retirement. Read/refresh views for this form live under the durable source's
  `stateDir`, never in the invoking repository or a reused home.

The capability, not the kernel, owns identity-guarded live-memory inspection,
accepted-view freshness, durable input/receipt semantics, Git PR verification,
directory publication/recovery and migration. See [README.md](README.md) for
inspection safety/error and preview contracts.

## Evidence limits

The standalone suite's optional public consumer uses the enumerated source
capability in a disposable owned-capability fixture against a real >=0.23.0 CLI.
It exercises public command/operation dispatch (including large live documents,
missing/reused homes and durable external views), lifecycle, directory workers,
and post-retirement completion. Native probes exercise capture/recall and
scheduler registration. These are not package acquisition/trust/restore,
remote GitHub PR, published-consumer, or real-model learning evidence; see
[SCHEMA-STATUS.md](SCHEMA-STATUS.md) for the separate release gates.
