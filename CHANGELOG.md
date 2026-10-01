# Changelog

## 4.0.6 — 2026-10-01

### Fixed

- **`complete` fits in an agent's tool call and can't strand the run** (#29).
  - The harvester's judgment and its proposals are persisted first, in one
    `run.json` write, after local checks only.
  - Delivery runs in a detached worker that owns `worker.lock`, logs to
    `delivery.log` in the run directory, and records `run.delivery` (state,
    pid, step, error).
  - After persisting the judgment, `oats okf complete` waits up to 30 s for
    delivery. It answers with the final receipt, or with `status: delivering`
    and the progress.
  - A run has at most one delivery worker. A killed `complete` or worker
    loses nothing: a rerun resumes, and never pushes or opens a PR twice.
  - A `worker.lock` whose owner pid is dead is reclaimed automatically; live
    holders are never stolen from.
  - The `E_LOCKED` error for a base lock held by a dead process names the lock
    and the `oats okf unlock` command.
  - Captured completions still deliver inline.
- **No false `E_BASELINE` when a Git base's head moves outside its root** (#30).
  - The baseline is checked when delivery starts. It compares the root's tree,
    then the root's digest.
  - A read-only base accepts the new head and records it (`confirmedHead`).
  - A written base is committed onto the new head (`receipt.parent`).
  - Only changed root bytes fail with `E_BASELINE`. The judgment stays
    persisted, and recovery is `retry --rejudge`.
- **Staging a Git base fetches its root's blobs in one batch** (#27).
  - The batch fetch replaces one promisor fetch per file, and reads run with
    `GIT_NO_LAZY_FETCH`.
  - Delivery's `write-tree --missing-ok` no longer downloads every blob outside
    the root.
  - Local-path bases are cloned with `--no-local`, so they stage as partial
    clones too.
- **`harvest-status` reports `unknown`, with the reason, when it cannot read
  the soul's opt-out** (#28). Capture still treats an unreadable opt-out as off.
- `okf-harvest harvest-status` reports the background delivery (in progress,
  failed or stopped) and never says `retire` for a judged run that is not
  delivered.

**Upgrading from 4.0.x:** `oats sync` (or `oats update oats.okf`). A run judged
by 4.0.5 completes with 4.0.6 unchanged.

## 4.0.5 — 2026-09-29

- Readiness checks Git bases from the consult cache in `stateDir` instead of cloning/fetching every base into scratch. A warm cache validates within the kernel readiness cap.
- Readiness probes each accepted branch with bounded `git ls-remote`, reports stale/unreachable cached bases as warnings, and treats reachable-but-unprimed cold bases as ready with an explicit priming warning.
- The manifest declares the new readiness warning/problem message templates.
- Harvest-off spawn primes Git bases concurrently with a 20s per-base bound; slow or unreachable bases only add `not primed` warnings and leave no temporary cache clone behind.
- Harvest-off spawn still fails closed for Git bases that were primed within the bound but do not satisfy the soul's declared node references, including references to unbound aliases.
- Readiness keeps the consult cache read-only while validating, kills timed-out `ls-remote` HTTPS helpers as a process group, and scopes cached validation verdicts by both commit and base root.

## 4.0.4 — 2026-09-28

- Fix `binding.check` readiness to accept the kernel-documented request (`input.context` and `input.action` only) and read the OKF provider binding from top-level `settings`.
- Return `needs-configuration` with a named OKF provisioning/deactivation fix for missing or invalid readiness binding data instead of refusing a well-formed kernel request as `invalid-binding`.
- Add a real kernel readiness stdin fixture captured from `awebai/oats` main (`82f35853664245417b329955d31deb130e56203a`) and assert ready, missing-configuration, and strict unknown-key behavior.

## 4.0.3 — 2026-09-28

### Fixed

- **Knowledge consultation works with harvest off (the default).** Since
  4.0.0, a home spawned with harvest off had no source, so every `oats okf`
  consult command (`bases`, `index`, `cat`, `ls`, `links`, `search`) and
  `inspect` failed with `ENOENT`.
  - A harvest-off home still registers nothing: no source, no custody, no
    schedule, and no final capture at retire.
  - It now consults through its soul's declaration and the deployment's
    bindings as they are now. The spawn records the declaration in
    `.okf-instance.json`. A home spawned by 4.0.0–4.0.2 reads it from the
    soul the kernel names (`OATS_SOUL`), so it works without a respawn.
  - `inspect` on such a home reports that harvest is off, the declaration,
    the bases it reads and its working memory.
  - Harvest-on homes are unchanged.

### Documentation

- README: the configuration section describes the current setup
  (`oats-local.yaml` settings), and states that a bound base's `id` must
  equal the `id` in that base's `okf-base.json` (otherwise every read fails
  with `E_BASE` "base identity/nodes mismatch").

**Upgrading from 4.0.x:** `oats sync` (or `oats update oats.okf`). No
respawn is needed.

## 4.0.2 — 2026-09-28

### Changed

- **The harvester and maintainer no longer join an okf team; they live in the
  default team.** This follows OATS team model v2, where team membership is
  local to each deployment, so a package can't assume an `okf` team exists.
  - `run-source` spawns `oats.okf/knowledge-harvester` with no `join` and no
    messaging `spawn --preview`. The run records no `team`.
  - The `harvest-review` trigger template has no `spawn.teams`.
  - The package souls carry no `team`.
  - `okf-maintenance notify-harvester` returns no `team` and no longer says
    "in the okf team".
  - `okf-trigger-setup` drops the okf team mapping step: there is no `okf`
    team to declare or map.
  - The harvester's and maintainer's texts (souls, skills, injects,
    manifests) no longer mention an okf team. A max-age harvester tells its
    operator.

  **Upgrading from 4.0.x:** nothing to do. A workspace's `okf` team entry and
  its `messaging.byTeam.okf` mapping are no longer used, and can be removed.
  A deployment that wants the harvester and maintainer in another team opts
  them in locally, as for any soul.
- This repository's member files drop `team: global`
  (`oats-membership.yaml`, `souls/oats-okf-expert`): team model v2, migration
  step 1, proven harmless on OATS 0.29.4 (awebai/oats#262).

## 4.0.1 — 2026-09-27

### Security

- **Arbitrary file write from a crafted base tree (fixed; affects 3.0.0 and
  4.0.0).** Validating a Git base's accepted commit copied every tree entry to
  `join(scratch, name)` with no containment check. Git accepts literal `..`
  entries (`hash-object --literally`), and they survive the bare partial
  clone. So the first `oats okf bases` or spawn against a crafted accepted
  commit could create any not-yet-existing file, with attacker content,
  anywhere the user can write.
  - Every tree entry is now checked against the canonical path rules (no
    `..`, absolute path, backslash, NUL, control character, percent-escape or
    `.git` segment).
  - The resolved target must stay inside the scratch, and all entries are
    checked before anything is written. The first bad entry refuses the whole
    base with `E_PATH`.
  - The staging materializer asserts the same containment.
  - GitHub's receive checks probably block such a push; local and self-hosted
    bases do not.
  - **Upgrade from 3.0.0 or 4.0.0.**

### Fixes

- **Credentials are never shown to agents** (#16).
  - A repository URL with userinfo (`https://user:token@…`) is refused at
    binding; use a Git credential helper or an SSH key.
  - Every repository shown in `bases` output and in errors is redacted
    (`displayRepo`/`redactUrls`), including Git's own failure text.
- **`review-context --checkout` trusts only the accepted base.**
  - Node ownership comes from `okf-base.json` at `origin/<base>`, never from the
    PR head or the PR body.
  - The owned nodes are the accepted nodes whose owner is the source's owner.
    The harvester now records `source.owner` in the provenance; a 4.0.0 PR
    without it falls back to `source.soul`.
  - Nodes the provenance claims but the source does not own are listed
    (`claimedNotOwned`).
  - Any change to `okf-base.json` is outside the owned nodes (`baseMetaChanged`).
  - A provenance base root containing `..` or an absolute path is refused.
- **The merge is tied to the reviewed head:** `gh pr merge … --squash
  --match-head-commit <headSha>`, after a final `review-context`.
- **`okf-needs-human` is a hard stop.** `review-context` reports
  `blocked: "needs-human"` and `settled: true` for any event (opened,
  reopened, ready_for_review), and knowledge-review stops at step 1. Only a
  human removing the label clears it.
- **`run-source` and `retire` re-read the harvest switch, soul included.**
  - A soul that adds `knowledge: { harvest: off }` after spawn, or a
    deployment that turns harvest off, stops capture at the next `run-source`.
  - Retire then takes no final capture; inputs already in custody stay.
  - Registration records the soul directory for this re-read.
- **`OATS_SETTINGS_ORIGINS` (kernel 0.29.0) is read as an extra signal.** A
  harvest value whose origin is the soul never switches harvest on.
  - Origins name only the last layer, and the host's settings merge after the
    soul's. So a host `harvest: on` hides a soul's `off` there, and `soul.yaml`
    stays the authority for the absolute opt-out.
  - `OATS_SETTINGS_ORIGINS` is stripped from child processes like
    `OATS_SETTINGS`.

## 4.0.0 — 2026-09-26

Knowledge operations: the oats.okf-harvest and oats.okf-maintenance
capabilities, the knowledge-harvester and knowledge-maintainer package souls,
the harvest-review trigger template, the harvest switch, and provenance-carrying
harvest PRs. See the README.
