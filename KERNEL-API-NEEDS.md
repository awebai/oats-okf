# Kernel surfaces oats.okf 5.2 relies on

oats.okf 5.6.0 declares **OATS >=0.69.2** (the soul key
`background:`; the public gone-home instance-event lookup needs >=0.49.0) and is tested in CI against released **OATS 0.69.2**. It needs no private
kernel API and no knowledge-specific kernel behaviour. The capability, not
the kernel, owns OKF validation, consultation, the host cache, provisioning
and migration.

## Environment

| Variable | Used for |
|---|---|
| `OATS_SETTINGS` | the effective `oats.okf` settings (`bindings-file`, `state-dir`, `git-timeout`, `consult-max-age`); a 4.x harvest key refuses |
| `OATS_SETTINGS_ORIGINS` | which layer (host, soul, spawn) set a 4.x harvest key, named in the `E_REMOVED` sentence |
| `OATS_SOUL` | the soul directory whose `okf.json` an instance (or a deployment command run with `--soul`) consults |
| `OATS_INSTANCE_HOME`, `OATS_HOME` | the instance home (instance knowledge, `inspect`, harvester-local source capture) |
| `OATS_TASK` | the kernel-submitted proposal copied by the required harvester spawn hook |
| `OATS_CLI_BIN` | the running kernel CLI used for public source-event lookup |
| `OATS_KIND` | a service (capability) instance gets no knowledge upkeep |
| `OATS_EVENT` | the hook being run (`spawn`, `soul-scaffold`) |
| `OATS_WORKSPACE`, `OATS_TEAM_SCOPE` | the deployment `setup --remove-legacy-settings` edits; absent, relative, missing or disagreeing is `E_DEPLOYMENT_SCOPE`; the harvester uses `OATS_WORKSPACE` to check source scope |
| `OATS_BINDING_FILE` | an optional captured ProviderBinding1 snapshot |
| `OATS_TRIGGER_EVENT_FILE` | the maintainer's trigger event (`review-context --event`) |

`OATS_SOURCE_RECEIPT_FILE` and `OATS_INVOCATION_CONTEXT_FILE` are no longer
used; their presence answers `E_REMOVED`.

## Hooks, commands and operations

- Required **spawn** hooks for the knowledge slot and harvester (no declared
  inputs), and the knowledge slot's **soul-scaffold** hook. No retire hook.
- Manifest commands under `oats okf`, `oats okf-harvest` and
  `oats okf-maintenance`, dispatched from an instance home or from the
  deployment with `--soul`.
- The `knowledge:inspect` view and the `knowledge:harvest` action (the
  latter kept only to answer `E_REMOVED`).
- `oats okf status` reads the provider's home-local, spawn-written harvest
  policy. Static inject/skill composition carries a conditional duty and an
  explicit opt-out exception; no conditional kernel injection is needed.
  The spawn hook's TASK brief contains no harvest/proposal direction.
- The binding wire's `check` phase for readiness, with `binding.reasons` as
  the allowlist of text that may cross it.

## Spawning and automation

- **Proposals**: a working agent runs
  `oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated`.
  The kernel refuses `--relation unrelated` with `--relative-to` and
  chooses the harvester's harness and model.
- **Source history**: `oats instance events <name> --home <original-home>
  --dir <deployment> --limit 2000 --json` supplies the public, addressed
  incarnation history. OATS 0.49.0 first supports this lookup after the home
  is gone. The harvester checks the event-linked `data.workRecovery` path,
  `recovery.json` and copied record; it never reads private event logs or
  infers identity from a recovery directory's name.
- **Package souls** `oats.okf/knowledge-harvester` and
  `oats.okf/knowledge-maintainer`.
- **Trigger template** `oats.okf:harvest-review`, installed by the operator
  as a workspace automation or with `oats trigger add`.

The harvester and maintainer use `git` and `gh` with the host's ordinary
credentials; the kernel is not involved in publication.
