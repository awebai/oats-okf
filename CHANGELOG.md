# Changelog

## 4.2.0 — 2026-10-06

Checkpoint harvest (#49); the harvester retires after delivery (#47). #46 and
#48 are superseded. See the README's 4.2.0 section for the ordered cutover.

### Changed

- **Harvest runs at checkpoints, not on schedules.** No registration, spawn,
  retire, checkpoint or recovery creates, verifies or changes a scheduler job.
  The working agent runs `oats okf harvest` from its home at a checkpoint
  (after opening or handing over a PR, or finishing a task); the inject, the
  `okf-instance-knowledge` skill and the harvest-on spawn brief say so, and a
  harvest-off brief says not to.
- **`oats okf harvest`** re-reads the switch and the soul opt-out
  (`E_HARVEST_OFF`), takes the source's worker lock (a live holder:
  `already-running`, with the run id or `preparing`; a dead one is
  reclaimed), settles earlier delivered PRs through `complete`'s checks
  (`settled`: accepted, rejected once and never rejudged, open, or
  unsettled with its command), reports an active run (`already-running`,
  `deferred`, or `needs-recovery` with exact commands), then captures and
  requests a finite drain (`started`, or `empty`). Its answer replaces the
  run's status.
- **Review settlement is per destination.** A run already processed settles
  each destination on its own, through the same identity and ancestry
  checks: a closed PR is recorded once and never read again, and never holds
  back, or hides, another destination's merge, reviewed amended merge or
  failure. A settlement that fails part way (a receipt left `pr-unknown`)
  stays owed: every earlier run with a destination whose outcome is not
  recorded is settled at each checkpoint and listed by `harvest-status`
  until then. A newly recorded close still answers `E_PR`, now with every
  destination's receipt in `error.result`; a repeat answers the recorded
  outcomes.
- **One deadline** bounds a checkpoint and a retire hook (110 s): every
  `git`, `gh` and `oats` call gets at most what is left and none starts
  once it is spent; settlement takes at most 30 s and capture 85 s. A worker
  is never launched past it: with under 15 s left, or staging stopped by
  it, the confirmed worker stays (`deferred`, `phase: ready` or
  `scaffolded`, `launched: false`, `next: retry --source FILE --launch`),
  and repeats never launch or spawn it again. Operator commands keep each
  call's own timeout.
- **An explicitly requested rejudgment goes first** on every path that starts
  a run (checkpoint, drain continuation, retirement, `run-source --manual`),
  with its inputs, lineage, guards and `previous.json`; while a PR of an
  earlier attempt is open or merged again, nothing starts
  (`needs-recovery`, `phase: pending-rejudgment`).
- **Finite drain.** The captured input ids are persisted as the drain's
  boundary before any effect. A run takes at most 192 KB of them; when it
  becomes processed, its completion starts the next run from the boundary
  without capturing again, re-reading the switch (off pauses the drain).
  Automatic continuation needs the deployment's harvest switch on: a seat
  switched on only at spawn starts its first run, then pauses visibly with
  the deployment off; every promised handoff says so (`prerequisite`).
  `--no-launch` requests no drain, and its run's completion launches
  nothing, also over an earlier drain request: that drain is `held` until an
  explicit `retry --source FILE --launch`.
- **Retirement** takes the final capture and then the same drain within one
  110 s budget, reported in `meta.drain` apart from the certified capture:
  started, already-running (the active run's completion hands on the final
  tail, also after the source home is gone), empty, not-launched (a source
  that never launched a model launches no harvester), or needs-recovery /
  deferred / failed with the exact resume command. Harvest off: no final
  capture and no drain, as before. A captured source's drain stays held.
- **The harvester retires once every destination is delivered** and hands
  over the run and PR URLs; `okf-harvest harvest-status` answers `retire`
  then, whatever the PR's state. A delivery in progress, failed or stopped
  keeps it. The maintainer's review never waits for it (`knowledge-review`,
  the maintainer inject and soul); `notify-harvester` is only for harvesters
  spawned by 4.1.
- **`harvest-status`** lists, per source, everything `outstanding` with its
  exact command: every delivered run awaiting review (a retired source's
  operator records the merge or close with `complete`), the active or stuck
  run, and an unfinished drain.
- **`retry --source FILE`** prepares again, in place, a confirmed worker whose
  preparation was interrupted (persisted stages kept, a partial one redone);
  nothing is spawned twice. With no active run it starts one from custody
  only while harvest is on (`harvest-off` otherwise), as `run-source
  --manual` does; `--launch` of a prepared worker clears its `--no-launch`.
- **Rollback boundary.** Retiring sources is not enough to re-pin 4.1: every
  4.2 drain must first be finished under 4.2 (`harvest-status` shows no
  `active`, `deferred`, `needs-recovery`, `rejudgment`, `drain` or
  `pending-input` row), because 4.1's `complete` hands no drain on. See the
  README.
- CI checks out full history: a test runs the released 4.1.1 code.

### Removed

- `cron`/`tz` in a live bindings document: `E_HARVEST_SCHEDULE_REMOVED`, naming
  the remedy. Descriptors frozen by earlier versions keep them as inert data.
  The bindings schema no longer lists them.
- `run-source` without `--manual` (a 4.1 job firing): `E_HARVEST_SCHEDULE_REMOVED`,
  nothing captured.
- `setup --source`, `--enable`, `--disable`, `--install-host`: `E_REMOVED`.
- The spawn hook's `meta.schedule` (now `meta.checkpoint`), and the retire
  hook's `meta.schedule` (now `meta.drain`).

### Added

- `oats okf setup --remove-schedules [--json]` (from the deployment, with
  `--soul`): for every registered source of the state namespace, removes its
  `okf-<id>` job only once the actual definition proves it is that source's
  own; keeps the definition and every effect as evidence; never forces and
  never touches the host timer or other jobs. `E_SCHEDULE_OWNERSHIP` (a
  foreign definition, untouched) or `E_SCHEDULE_MIGRATION_PENDING` (running,
  unresolved or uncertain; left disabled) carry the confirmed removals and
  the leftovers in `error.result`. Repeat-safe.

## 4.1.1 — 2026-10-01

### Fixed

- **`complete` on an amended PR that is still open** (#36). After the
  knowledge-maintainer pushed an amendment on top of the delivered commit,
  `oats okf complete --run <id>` failed with `E_PR: publication branch has
  unexpected commit; never force push`. Now:
  - The run is reported `delivered` when the known PR is open at the
    branch's tip and that tip descends from the delivered commit. Ancestry
    is checked by Git on the fetched branch, never from commit messages.
  - `receipt.pr` is the PR as observed, with its amended head; `receipt.commit`
    stays the delivered commit. The answer's `next` line names the amended
    head. Nothing is pushed, and rerunning `complete` changes nothing.
  - A tip that does not contain the delivered commit is still refused with
    `E_PR`. Nothing is ever force-pushed. A merged PR is settled as in 4.0.7.
  - Git history is read from the commit objects alone. A checkout's grafts
    (`info/grafts`) or commit-graph file can no longer change a commit's
    parents, so they cannot fake this ancestry, or the merge ancestry 4.0.7
    checks. Replace refs were already ignored.
- **`harvest --once`: one-shots of a seat no longer race** (#39). The
  overlap checks and the install run under one seat lock,
  `<stateDir>/once-<hash>.lock`. Of two one-shots with overlapping manifests
  started together, one installs and the other gets `E_ONCE_OVERLAP`. A
  lock left by a dead process is reclaimed.
- **`harvest --once`: a note edited between runs no longer strands a
  draining one-shot** (#40). A rerun with the same manifest continues from
  custody and no longer reads the listed notes, so edited bytes never enter
  the one-shot. Its receipt must record this manifest's hash. Another
  manifest listing a note a one-shot holds, at the sha256 its receipt
  records, is refused with `E_ONCE_OVERLAP` before any note is read. The
  message names that one-shot and says how to continue it; it is never a
  `sha256 mismatch`.

## 4.1.0 — 2026-10-01

### Added

- **`oats okf harvest --once`: a one-shot reviewed harvest of one seat from an
  explicit record set** (#37). For seats that moved (classic to v2) or were
  spawned with harvest off. The operator runs it from the deployment with
  `--home <seat> --records <manifest> --soul <its soul>`.
  - Inputs are only the manifest's notes, each sha256-verified against the
    bytes used, contained in the home or a listed root, with no symlinks,
    hardlinks, directories or globbing. A bad entry refuses everything before
    anything is stored.
  - The normal harvester judgment, PR and knowledge-maintainer review; the PR
    provenance records `once: {manifest, entries, override}`.
  - Nothing is registered: no home pointer, schedule or capture. Custody is a
    `once` source with a receipt (`once.json`). Reruns with the same manifest
    continue it run by run (each says how many inputs remain) or answer
    `already-delivered`. Another manifest repeating notes a one-shot of the
    seat holds (harvested or still draining) is refused (`E_ONCE_OVERLAP`).
  - The host switch does not apply; a soul's opt-out (or an unreadable one)
    is refused unless `--override-opt-out`, which is recorded in the PR.
  - A seat cannot run it on itself. Session records are refused
    (`E_UNSUPPORTED`) until the kernel offers `oats capture --file`.
  - `harvest-status --home <seat>` lists one-shots apart from sources.

## 4.0.7 — 2026-10-01

### Fixed

- **`complete` records acceptance of an amended and merged PR** (#32). After
  the maintainer's `amend+merge` verdict, `oats okf complete --run <id>`
  failed with `E_BASELINE`, and the receipt stayed `delivered`. The merge
  itself changes the root, and the PR head was no longer the harvester's
  commit. Now:
  - A known PR that is merged is settled before any baseline check. The
    receipt becomes `accepted`, with `mergeCommit` and the accepted head.
  - If the PR was merged at a head other than the delivered commit, an
    `okf-review` verdict (`merge` or `amend+merge`) must name that head as
    `headSha`, from a repository member or from the account that merged the
    PR. The receipt also records `mergedHead`
    and `verdict`.
  - Without such a verdict, `complete` fails with `E_PR`, naming the remedy.
    It never fails with `E_BASELINE`, and never rejudges merged inputs.

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
