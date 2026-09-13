# oats-okf

Official [OATS](https://github.com/awebai/oats) knowledge-layer integration for [Open Knowledge Format](https://github.com/google/open-knowledge). It provides:

- idempotent soul scaffolding for an OKF knowledge bundle;
- per-instance `STATE.md`, `log.md`, and `notes/` continuity;
- the `okf` and `memory-harvest` skills plus a zero-dependency validator;
- `oats okf harvest`, which launches an ephemeral harvester for pending notes or bounded captured-record windows; and
- `oats okf inspect`, which returns working memory as labeled documents.

This capability owns those runtime conventions; they are not mandatory kernel memory policy.

## Released payload and requirements

The released baseline is **v1.6.1**, with declared OATS compatibility **>=0.22.3**. The distribution manifest is [`oats-package/oats-package.json`](oats-package/oats-package.json); its only exported capability is [`oats-package/capabilities/oats-okf/`](oats-package/capabilities/oats-okf/). Unenumerated copies elsewhere under `oats-package/` are not runtime or test targets. The root private `package.json` is development tooling, not the distribution's release version.

Harvest invokes the dispatcher's canonical absolute `OATS_CLI_BIN` through argv-safe `execFile` (spawn) and `spawnSync` (capture/recall). It does not search `PATH` for `oats` or import private kernel files. Workspace-soul harvests also invoke host `git` for branch checks. Actual spawning requires the selected harness: `harvest-runtime` defaults to `pi`, with `claude` and `codex` also supported. When `harvest-model` is omitted, no model flag is passed; the harness uses its configured default. Explicit Claude/Codex models must be native names, not Pi `provider/model` names.

[`KERNEL-API-NEEDS.md`](KERNEL-API-NEEDS.md) is the historical extraction inventory, not the current compatibility floor or proof of consumer testing. See [`SCHEMA-STATUS.md`](SCHEMA-STATUS.md) for the verification boundary.

## Acquire and activate

Acquisition does not activate the capability. Install, trust the executable surface, and activate it deliberately:

```bash
oats install oats.okf --dir /path/to/scope
oats trust oats.okf --dir /path/to/scope
oats use oats.okf --global --dir /path/to/scope
oats doctor /path/to/scope --soul <soul-name>
```

To select the existing release explicitly, use this source for the install step:

```bash
oats install git:https://github.com/awebai/oats-okf.git@v1.6.1 --dir /path/to/scope
```

## Use

Spawned instances receive the selected OKF skills and instructions automatically. They keep `STATE.md` current, append milestones to `log.md`, capture learned concepts in `notes/`, and after committing run from their instance home:

```bash
oats okf harvest
```

The command skips when there is no harvestable input or a harvester for the source is already running. With no notes, or with `--from-record`, it attempts bounded record capture/recall. Otherwise it resolves the packaged `memory-harvest` agent and spawns through `oats spawn --json`; task instructions use mode-0600 temporary files removed after the spawn call on success or failure. Launch is not evidence that promotion or delivery completed.

**v1.6.1 custody depends on the source mode:** local souls receive direct-edit instructions; workspace-mode persistent souls use a dedicated Git worktree and PR delivery instructions; repo-resident souls use an attached same-tree worker. Workspace mode without a Git-backed soul skips. This baseline does **not** implement general external-base/directory custody or evidence preservation independent of the source home.

## Development and verification

```bash
npm test
```

This validates the distribution and enumerated capability manifests with the vendored-schema checks, walks exported resources for package containment (including nested symlinks), and runs only `test/*.test.mjs` so nested checkouts are not discovered recursively. Tests execute the actual exported CLI, use an isolated fake OATS boundary, and use real temporary Git repositories for branch custody. They also cover runtime/model arguments, failed-spawn cleanup, bounded record planning and large piped inspect output.

These are standalone tests, **not** an acquire → lock → trust → activate → scaffold/retire consumer probe, real harness promotion, or fresh-reader acceptance. Those gates remain unverified here; record exact versions and evidence when running them before a subsequent release. No runtime payload or release version is changed by this baseline repair.
