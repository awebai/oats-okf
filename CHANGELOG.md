# Changelog

## 5.0.0 — 2026-10-07

Knowledge is proposed at checkpoints and harvested by a directly spawned
harvester; the 4.x harvest machinery is removed. A breaking release: see
the README's "Upgrading to 5.0". The kernel floor is unchanged
(**OATS >=0.29.0**); CI runs the package on the released OATS 0.44.0.

### Changed

- **The proposal flow.** At an important checkpoint a working agent updates
  STATE.md, log.md and notes/, and when it learned something durable writes
  one short, self-contained proposal file in its home and runs
  `oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated`
  (never with `--relative-to`). The spawn brief teaches it, only to souls
  that have not opted out; the shared inject and skills carry no harvest
  direction. There is no CLI for it.
- **The harvester's spawn hook** (`oats.okf-harvest`, required) checks the
  proposal's `Source:` line against the deployment's record before the
  harvester exists, and refuses an opted-out, unrecorded, ambiguous or
  mismatched source, and a proposal with more than one `Source:` line. A recorded `harvest: off` opts out only when the
  record's oats.okf entry gives it a soul origin; a 4.x manifest default is
  ignored, and any other legacy key, or one with no recorded origin, fails
  closed.
- **The harvester** (`knowledge-harvest` skill, rewritten) reads the proposal
  as untrusted evidence, establishes the source from the deployment's own
  records (the instance record, the soul's `soul.yaml` and `okf.json`, the
  bindings file), reads only the notes the proposal names (recording their
  SHA-256), clones the accepted Git base, edits only owned nodes, validates
  with `okf-validate.mjs --strict`, opens one `okf-harvest`-labelled PR per
  base with `git` and `gh`, hands over and retires. Claims never enter a
  command line: the commit message and PR body are files written with the
  native file tool (`git commit -F`, `gh pr create --body-file`), the PR
  title is the fixed `OKF knowledge proposal`, and the commit carries a
  per-command Git identity. A valid instance and soul
  pair proves consistency, not authorship; when the source's authority cannot
  be established it stops and reports. Directory bases have no PR harvest:
  their claims are dropped and reported.
- **Provenance version 2.** The PR's `okf-harvest` block is
  `{version: 2, source: {soul, owner, instance, ownedNodes, readNodes, bases},
  evidence: [{note, sha256?}], tasks, harvester}`, with no run or input ids;
  `source.owner` is required and note paths are `notes/…/*.md` without `.` or
  `..`. The maintainer's parser still reads version 1, so 4.x PRs stay
  reviewable. `review-context` lists the v2 evidence; `notify-harvester` says
  sending is optional (the harvester has retired) and its merged text needs
  nothing back.
- **Binding payloadVersion 2.** ProviderBinding1's OKF payload carries
  `owner`, `stores`, `reads`, `owns` and `runtime`, without the 4.x
  `execution` (harvest runtime and model); the bind runtime model is
  `{stateDir, descriptorFile}`. A payloadVersion 1 binding is refused
  (`E_REMOVED`; readiness reason `binding:v1-removed`). The check phase has
  no harvest-runtime reasons, always runs the declared-node check, and
  reports its failure as `declaration:unresolved`. `binding.reasons` holds
  24 strings. The declaration contract stays `oats.okf.locations@1`.
- **The spawn hook** checks the soul's declared nodes, creates STATE.md,
  log.md and notes/, and answers a brief naming the proposal spawn command.
  It answers no `meta` at all, on success or failure (4.x answered
  `memory`, `harvest` and `checkpoint` meta): with no retire hook, a
  reported meta would make the kernel quarantine a rolled-back spawn's home
  as outstanding external state. It no longer registers a source and takes
  no `sourceReceipt` input.
- **`oats okf inspect`** reports the declaration, the bound bases and the
  home's working memory; there is no source, custody or harvest state.
- **`knowledge-theory`** now also ships in `oats.okf`, so working souls load
  the promotion doctrine their proposals are judged by. All three copies are
  identical.

### Added

- **Legacy-settings guard.** A forwarded `harvest`, `harvest-runtime` or
  `harvest-model` makes every `oats okf` command and hook refuse with
  `E_REMOVED` before any effect, in one sentence naming where it was set
  (from `OATS_SETTINGS_ORIGINS`: host, soul, spawn, another layer, or
  unknown) and the fix. The binding check answers the same sentence as a
  `needs-configuration` problem (`setting:removed` template). A key with
  origin `manifest-default` (the 4.x defaults `harvest: off` and
  `harvest-runtime: pi` that a 4.x home recorded) was nobody's decision and
  is ignored everywhere, as if absent; it is never an opt-out and never an
  effective 5.0 setting.
- **`oats okf setup --remove-legacy-settings [--plan] --soul <soul> --json`**,
  run from the deployment, the one command exempt from the guard. It deletes
  only `settings.oats.okf.harvest`, `harvest-runtime` and `harvest-model`
  lines from `<deployment>/oats-local.yaml` (the deployment from
  `OATS_WORKSPACE` or `OATS_TEAM_SCOPE`, else `E_DEPLOYMENT_SCOPE`), and only
  from the `oats.okf` map directly under `settings:`; a map left empty
  becomes `oats.okf: {}`, before any inline comment, and the edited text is
  read again before it is written; the file keeps its own permission bits
  (other atomic writes stay 0600). It refuses before writing
  (`E_UNSUPPORTED`) on a file that is not a single-link regular file owned by
  the user, tabs, multiple documents, flow or nested values, an `oats.okf`
  nested under another settings key, block scalars or duplicate keys, and
  when the kernel reports a host key the file does not hold plainly; a concurrent change is `E_CONFLICT`, an unconfirmed write
  `E_UNCERTAIN`. A soul or spawn key it cannot remove answers `E_REMOVED`
  after the host write, with the write's result. `--plan` writes nothing;
  a rerun is a no-op.

### Removed

- `oats okf harvest`, `run-source`, `complete`,
  `retry` and `harvest-status`; `setup --harvest`, `--enable`, `--disable`,
  `--install-host`, `--remove-schedules`; `migrate --source-home`; any
  `--source` flag; `OATS_SOURCE_RECEIPT_FILE` and
  `OATS_INVOCATION_CONTEXT_FILE` in the environment. Each answers `E_REMOVED`
  naming the proposal flow. The `harvest` operation stays declared in the
  manifest and refuses the same way.
- `oats okf-harvest complete` and `harvest-status`: `E_REMOVED`, so a 4.x
  harvester TASK in a 5.0 harvester never runs a completion.
- The settings `harvest`, `harvest-runtime` and `harvest-model` (oats.okf)
  and `harvester-max-age` (oats.okf-harvest, which now declares no
  settings). Allowed oats.okf settings: `bindings-file`, `state-dir`,
  `git-timeout`, `consult-max-age`.
- The retire hook.
- Source custody and everything built on it: source descriptors and markers,
  owner pins, capture of notes and session transcripts, durable inputs and
  runs, the worker, the delivery engine, drains, captured invocation contexts
  and source receipts. Modules removed: `lib/worker.mjs`,
  `delivery-worker.mjs`, `once.mjs`, `harvest-status.mjs`,
  `harvest-switch.mjs`, `captured-worker.mjs`, `invocation-context.mjs`,
  `invocation-shape.mjs`; `lib/sources.mjs` keeps only what consultation and
  the spawn hook need.
- The 4.x tests of that machinery (removed, not ported: the suite is a
  fresh 5.0 suite), its status documents (`CAPTURED-WORKER-STATUS.md`,
  `HELPER-INPUT-STATUS.md`, `INVOCATION-WIRE-STATUS.md`,
  `REAL-RETAINED-GATE.md`) and `scripts/real-retained-gate.mjs`.

### Upgrade notes

- 5.0 neither reads nor deletes 4.x state (`<stateDir>/sources/`,
  `owners.json`).
- A registered 4.2 home retired after the 5.0 pin gets
  `E_HARVEST_CONSENT_UNKNOWN` from its copied 4.2 retire hook and is kept;
  consult-only 4.2 homes retire normally. There is no compatibility shim.
- The soul opt-out (`knowledge: { harvest: off }`) stays: 5.0 removes the
  host harvest switch, not a soul author's safety opt-out (a public soul is
  reachable from outside; its notes must not be harvested). An opted-out
  soul consults and keeps instance knowledge but gets no proposal
  instruction, and the harvester's required spawn hook refuses it.
  `--remove-legacy-settings` never touches it.

## 4.2.0 — 2026-10-06

Checkpoint harvest (#49); the harvester retires after delivery (#47). #46 and
#48 are superseded. See the README's "Upgrading from 4.1". The external
`--repo` fix of #55 (the unreleased 4.1.2, PR #56) is in this release instead;
there is no 4.1.2.

### Fixed

- **External `--repo` sources run their `oats` calls in the deployment**
  (#55). Such a source keeps the repository as its context; the harvester
  spawn and its session start, the live consent read, every printed operator
  and completion command, and the harvester's `okf-harvest complete` now run
  in the deployment the kernel names (`OATS_WORKSPACE`, else
  `OATS_TEAM_SCOPE`), or a captured source's frozen execution binding.
  Neither named, or two different ones, is `E_DEPLOYMENT_SCOPE` before any
  effect; nothing searches for a deployment from the repository. Frozen
  descriptors are unchanged. The floor stays **OATS >=0.29.0**: CI's
  `external-repo-041` job runs a real external-`--repo` checkpoint to a real
  harvester spawn and retirement on released OATS 0.41.0, with the released
  v4.1.1 payload as a failing negative control. 4.1.2's scheduler scoping is
  not carried over: 4.2 manages no scheduler job.

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
  reclaimed), reports an active run (`already-running`, `deferred`, or
  `needs-recovery` with exact commands) without settling history, so the
  run's completion never waits behind a GitHub call; with no run active it
  settles earlier delivered PRs through `complete`'s checks (`settled`:
  accepted, rejected once and never rejudged, open, or unsettled with its
  command), then captures and requests a finite drain (`started`, or
  `empty`). Only a busy capture lock is reported as another capture
  (`preparing`); a lock met inside the capture is an error.
- **The switch is the deployment's now, for the source's own soul.** A
  home's settings are its spawn's snapshot (the kernel dispatches its
  commands and hooks with them), and an operator command's are those of the
  soul it was dispatched as, so every switch read (checkpoint, retire,
  retry, drain continuation, run-source, from a home or not) asks the
  deployment through `oats okf harvest-status --soul <source soul> --json`
  run from the source's deployment, without the invoking process's
  identity or settings, within the invocation's budget, and its rows give
  the soul's opt-out as the deployment resolves the soul now. Unknown consent
  (a read that fails, times out or is malformed, or a switch reported
  `unknown`) is `E_HARVEST_CONSENT_UNKNOWN`, never off: nothing captured or
  started, a retirement refused with the home kept. The soul's opt-out stays
  absolute. An explicit spawn override for the source (origin `spawn`)
  stands in for the deployment's switch for its own first batch (a
  checkpoint, its retirement), after the same read, never over the soul's
  opt-out; a host value captured at spawn does not. An automatic
  continuation (a completion's successor, also from a detached delivery) is
  a new action: it reads the deployment's switch through that view at that
  moment, with or without a home, never the settings its command was
  dispatched with; the first batch's consent is not reused for it. Every
  printed operator or recovery command names the source's soul (`--soul`).
  Homes copied from earlier versions keep their copied modules: a pin does
  not retrofit them (see the cutover). Its answer replaces the
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
  once it is spent, and every lock wait ends with it (`E_DEADLINE`); settlement takes at most 30 s and capture 85 s. A
  harvester is started only with its spawn's full 90 s timeout (and a
  second for the records before it) left: otherwise it is `deferred` before
  any effect, no run active, the drain kept, with `run-source --manual` to
  resume. A worker
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
  nothing, also over an earlier drain request: that drain is `held`. The
  hold is durable (written with the processed status, so a crash right
  after keeps it): later checkpoints and retirement add input to it but
  start nothing, until an operator's explicit `retry --source FILE --launch`
  (or `run-source --manual`) lifts it.
- **Retirement** takes the final capture and then the same drain within one
  110 s budget, reported in `meta.drain` apart from the certified capture:
  started, already-running (the active run's completion hands on the final
  tail, also after the source home is gone), empty, deferred and busy (the
  worker lock held with no run active: no handoff is promised; the exact
  `run-source --manual` resumes), not-launched (a source
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
  nothing is spawned twice. **Retry re-reads consent**: while the deployment
  switch is off, or the soul opts out, it answers `harvest-off` to anything
  that would start new harvest work: a new run, `--launch`, `--rejudge`,
  `--run ID --rejudge`, and any combination with `--launch`; a new run
  re-reads consent under the worker lock, right before capture. It still
  delivers a persisted judgment (whose completion pauses the drain), prepares
  a confirmed worker without launching it, and adopts an already-created one.
  `harvest --once` keeps its own contract. `--launch` of a prepared worker
  clears its `--no-launch`.
- **An interrupted rebuild** of a retired worker's checkout (deadline or
  transport failure) is discarded and redone by the next settlement, never
  left blocking it.
- **Rollback boundary.** Retiring sources is not enough to re-pin 4.1: no
  source of any soul or state namespace may list any `outstanding` row, a
  review included. 4.1's `complete` hands no drain on, and it stops at a
  destination recorded closed, never reaching a later merge of the same run.
  See the README.
- Every CI job that runs `npm test` checks out full history: a test runs
  the released 4.1.1 code, and a test checks the workflow says so.

### Removed

- All scheduler-job management. No oats.okf code adds, enables, disables,
  removes, lists or installs a scheduler job, or calls `oats schedule` at all:
  the operator removes each job 4.1 created with the kernel's
  `oats schedule list`/`remove` (README "Upgrading from 4.1"). The
  `harvest-review` trigger and its skill stay.
- `cron`/`tz` in a live bindings document: `E_HARVEST_SCHEDULE_REMOVED`, in
  one sentence naming both fixes (remove cron/tz; remove each old job with
  `oats schedule remove`) and the README section. Descriptors frozen by
  earlier versions keep them as inert data. The bindings schema no longer
  lists them.
- `run-source` without `--manual` (a 4.1 job firing): `E_HARVEST_SCHEDULE_REMOVED`,
  nothing captured.
- `setup --source`, `--enable`, `--disable`, `--install-host` and the 4.2
  candidates' `--remove-schedules`: `E_REMOVED`, naming the same fix.
- `oats okf inspect`'s `scheduler` (health) field, and `harvest-status`'s
  `legacySchedule`: oats.okf no longer observes scheduler jobs.
- The spawn hook's `meta.schedule` (now `meta.checkpoint`), and the retire
  hook's `meta.schedule` (now `meta.drain`).

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
