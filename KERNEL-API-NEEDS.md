# Kernel surfaces oats.okf 5.0 relies on

oats.okf 5.0 declares **OATS >=0.29.0** (package souls and triggers) and is
tested in CI against the released **OATS 0.44.0**. It needs no private
kernel API and no knowledge-specific kernel behaviour. The capability, not
the kernel, owns OKF validation, consultation, the host cache, provisioning
and migration.

## Environment

| Variable | Used for |
|---|---|
| `OATS_SETTINGS` | the effective `oats.okf` settings (`bindings-file`, `state-dir`, `git-timeout`, `consult-max-age`); a 4.x harvest key refuses |
| `OATS_SETTINGS_ORIGINS` | which layer (host, soul, spawn) set a 4.x harvest key, named in the `E_REMOVED` sentence |
| `OATS_SOUL` | the soul directory whose `okf.json` an instance (or a deployment command run with `--soul`) consults |
| `OATS_INSTANCE_HOME`, `OATS_HOME` | the instance home (instance knowledge, `inspect`) |
| `OATS_KIND` | a service (capability) instance gets no knowledge upkeep |
| `OATS_EVENT` | the hook being run (`spawn`, `soul-scaffold`) |
| `OATS_WORKSPACE`, `OATS_TEAM_SCOPE` | the deployment `setup --remove-legacy-settings` edits; absent, relative, missing or disagreeing is `E_DEPLOYMENT_SCOPE` |
| `OATS_BINDING_FILE` | an optional captured ProviderBinding1 snapshot (0.44 sets none) |
| `OATS_TRIGGER_EVENT_FILE` | the maintainer's trigger event (`review-context --event`) |

`OATS_SOURCE_RECEIPT_FILE` and `OATS_INVOCATION_CONTEXT_FILE` are no longer
used; their presence answers `E_REMOVED`.

## Hooks, commands and operations

- A required **spawn** hook (no inputs) and a **soul-scaffold** hook. No
  retire hook.
- Manifest commands under `oats okf`, `oats okf-harvest` and
  `oats okf-maintenance`, dispatched from an instance home or from the
  deployment with `--soul`.
- The `knowledge:inspect` view and the `knowledge:harvest` action (the
  latter kept only to answer `E_REMOVED`).
- The binding wire's `check` phase for readiness, with `binding.reasons` as
  the allowlist of text that may cross it.

## Spawning and automation

- **Proposals**: a working agent runs
  `oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated`.
  0.44 refuses `--relation unrelated` with `--relative-to`. The kernel
  chooses the harvester's harness and model.
- **Package souls** `oats.okf/knowledge-harvester` and
  `oats.okf/knowledge-maintainer`.
- **Trigger template** `oats.okf:harvest-review`, installed by the operator
  as a workspace automation or with `oats trigger add`.

The harvester and maintainer use `git` and `gh` with the host's ordinary
credentials; the kernel is not involved in publication.
