# oats.okf 4 — external knowledge, consulted remotely, independent judgment

The official OKF knowledge capability: **4.2.0**, requiring **OATS >=0.29.0**.

## 4.2.0 — checkpoint harvest, no schedules (#49, #47)

Harvest no longer runs on a scheduler tick. The working agent harvests at its
own checkpoints, retirement takes the final one, and nothing creates a
scheduler job. The harvest switch (`setup --harvest on|off`, default off) and
a soul's opt-out are unchanged and are re-read at every step.

**The checkpoint.** The `oats.okf` inject and the `okf-instance-knowledge`
skill teach:

> At a checkpoint—after opening or handing over a PR, or finishing a task—first
> update STATE.md, log.md and relevant notes. If your TASK briefing says
> harvest is on, run `oats okf harvest` from your instance home. Already
> running or nothing new needs no action; report a failure rather than
> repeatedly retrying. With harvest off, do not run it. Retirement takes the
> final checkpoint.

Only a harvest-on spawn brief names the command; a harvest-off brief says not
to run it. `oats okf harvest [--no-launch] --json`, from the instance home:

1. Re-reads the switch and the soul's opt-out **as the deployment holds them
   now**: off answers `E_HARVEST_OFF` and captures nothing. A home's own
   settings are what its spawn captured, not the deployment's current
   consent: the kernel dispatches a home's commands and hooks with that
   snapshot, so switching the deployment off would not reach them; and an
   operator command's settings are those of whichever soul it was dispatched
   as. So every switch read, from a home or not, is the provider's own
   deployment-scoped view for the source's own soul, `oats okf harvest-status
   --soul <source soul> --json` run from the source's deployment without the
   invoking process's identity or settings (the kernel resolves
   the deployment's settings and the soul's current revision for it), within
   the checkpoint's budget (at most 20 s). The soul's opt-out stays absolute,
   as the deployment resolves the soul now (not the home's spawn-time copy).
   Consent that is not known answers `E_HARVEST_CONSENT_UNKNOWN` with that
   command, and nothing is captured or started: a read that fails, times out
   or is malformed, and a switch the deployment reports `unknown` (an opt-out
   its soul reader cannot read). Unknown is never treated as off. An explicit
   spawn override for this source (`oats spawn <soul> --provider oats.okf
   harvest=on`, which the kernel records with origin `spawn`) stands in for
   the deployment's switch for the source's own first batch, at a checkpoint
   or its retirement: it never skips the read and never overrides the soul's
   opt-out. A host value captured at spawn is no override. Operator commands
   (`run-source`, `retry`, `complete` and its automatic continuation) read
   the same view, with no override. Every recovery command this package
   prints names the source's soul (`--soul`).
2. Takes the source's worker lock. If another live process holds it, the
   answer is `already-running`: with the run id when a run exists, else
   `preparing: true` (no model is known to run yet). A lock whose holder died
   is reclaimed; one held on another host stays `E_LOCKED`.
3. An active run answers `already-running` (ready, running or delivering),
   `deferred` (a worker not launched because a budget ran out, below), or
   `needs-recovery` with the exact `commands` (complete, adopt, continue,
   inspect, rejudge). An uncertain spawn or launch is never repeated.
   Earlier PRs are not settled then (`settled: []`, with a `settlement`
   note): the active run's completion needs the same lock and never waits
   behind a GitHub call; the next idle checkpoint settles them.
4. **Settles earlier delivered runs**, with no run active (`settled`):
   every earlier run with a destination whose review outcome is not
   recorded goes through
   `complete`'s own checks, **each destination on its own**. A merge (or a
   reviewed amended merge) is recorded `accepted`; a close without merge is
   recorded `rejected` once, and never rejudged or read again; an open PR
   stays delivered. A failure (GitHub down, an unverifiable PR) is reported
   on its destination and leaves that destination owed, also when it left the
   receipt `pr-unknown`: it is settled again at the next checkpoint and
   listed by `harvest-status` until then. A run's `outcome` is `open`
   while a destination awaits review, `unsettled` (with `error` and its
   `complete` command in `next`) while one failed, and `accepted` or
   `rejected` only once every destination is settled: one closed PR never
   hides, or holds back, another destination's merge. Settling takes at most
   30 s of the budget below; a run it does not reach is `deferred` with its
   command. This is reported apart from what follows.
5. Captures (notes and transcript windows, by content hash and cursor). A
   busy capture lock (another process capturing) answers `already-running`,
   `preparing: true`; a busy lock met inside the capture (its status writes)
   is an error, not another capture. Nothing new answers `empty`.
6. Requests a **finite drain** of the input captured so far: the ids are
   persisted as `status.drain.boundary` before any effect, and one run takes
   at most 192 KB of them (`started`, with `inputs: {run, pending}`). When a
   run becomes processed (delivered counts: it means judged and published,
   not accepted), its completion starts the next run from the same boundary,
   serially, without capturing again, until the boundary is processed
   (`drain: drained`). Notes written meanwhile wait for a later checkpoint.
   **Scope: automatic continuation needs the deployment's harvest switch on**
   (and no soul opt-out), as it is when the successor would start: each
   automatic continuation is a new action, and reads the deployment's switch
   at that moment through the deployment-scoped view (as a home does), not
   the settings its `complete` was dispatched with, which a detached delivery
   may outlive. Off pauses the drain with its remedy; unknown consent starts
   nothing and keeps the remainder in custody with its command. The completion
   runs from the deployment (`oats okf complete --soul …`), so a seat
   switched on only by a spawn-only provider setting captures and starts its
   first run at a checkpoint, and then its drain pauses visibly when the
   deployment is off (`drain: harvest-off`, `drain.paused` in status, the
   input in custody). Every answer that promises a continuation carries this
   as `prerequisite`. The paused drain's `next` is the command that
   continues it once the deployment switches harvest on; while it is off,
   `run-source --manual` and `retry` start nothing either
   (`harvest-off`). There is no per-source consent record.
   `--no-launch` is a diagnostic: it prepares one worker without launching
   it and requests no drain. Its run's completion launches nothing, also when
   an earlier checkpoint's drain is outstanding: that drain is `held`
   (`drain.paused.kind: no-launch`, input in custody). **The hold is
   durable.** It is written in the same status write that records the run
   processed and frees the active slot, so a completion killed right after
   leaves it in place. A later checkpoint, or retirement's final capture, adds its
   input to the held drain and answers `held`: it starts no model, and no
   continuation does. Only an operator's explicit launch lifts it:
   `oats okf retry --source FILE --launch` (or `run-source --manual`
   without `--no-launch`), which itself needs harvest on. A worker launched
   that way hands the drain on as usual.
7. **An explicitly requested rejudgment goes first.** After `oats okf retry
   --rejudge` abandoned a run, every path that starts a run (a checkpoint, a
   drain's continuation, retirement, `run-source --manual`) starts its
   rejudgment: the abandoned run's inputs, `recoveryOf`, its publication
   guards and `previous.json`, with the request cleared in the same status
   write. While a PR of an earlier attempt is open or merged again, nothing
   starts (`needs-recovery`, `phase: pending-rejudgment`): never a second PR
   for the same evidence.

**One deadline.** An invocation has one time budget (110 s). Every blocking
call within it (`git`, `gh`, `oats`) gets at most what is left, whatever
its own timeout, and none starts once it is spent. Every lock wait within it
(a base, the worker, the capture) ends with it too: a lock still busy then
is `E_DEADLINE` and nothing was done under it. Settlement takes at most
30 s of it and capture 85 s. A harvester's spawn keeps its full 90 s
timeout: with under 91 s left (the spawn plus a second for the records
written before it) no harvester is started (`deferred`, nothing spawned, no
run active, the drain and the input in custody, `next` the exact
`run-source --source FILE --manual`); the harness version check only uses
the time beyond that. In plain terms: the whole checkpoint has 110 s, and
a harvester needs 91 s of it, so a busy source (slow settlement or capture)
can leave too little: the checkpoint then defers and an operator recovers
with the printed `run-source --manual`. A spawned worker is
not launched with under 15 s left, or when staging stopped at the deadline:
it stays confirmed, the run stays active, and the answer is `deferred` with
`phase: ready` (or `scaffolded`), `run`, `home`, `launched: false` and
`next`, the exact `oats okf retry --source FILE --launch`. A repeated
checkpoint or retire reports the same, never launches it, and never spawns
another. Commands run by an operator (`complete`, `retry`, `run-source`)
have no invocation deadline: each call keeps its own timeout (`git-timeout`).

**Retirement.** The retire hook takes the final capture within the same
budget, after the same switch read as a checkpoint (the deployment's now, or
the source's explicit spawn override, with the soul's opt-out read live):
confirmed off since spawn takes no final capture and starts nothing;
unknown consent refuses the retirement (`E_HARVEST_CONSENT_UNKNOWN`,
nothing captured, not recorded as harvest-off, the home kept). An
incomplete or uncertified capture (including a busy capture lock) still
refuses retirement, as before. Once custody is certified it requests
the same finite drain of everything unprocessed and reports it in
`meta.drain`, separately from `meta.capture`. The hook's first batch is
admitted as a checkpoint's is: by the deployment's switch now, or by an
explicit spawn override for this source (origin `spawn`), which admits that
first batch; later continuations, run from the deployment, still need the
deployment's switch on. There is no lasting provider consent.
- `started`: a harvester took the first batch; the rest follow its completion.
- `already-running`: a run is active; the final input is recorded in the
  drain (`handoff`) and that run's completion hands it on, after the source
  home is gone (successors are not children of a retired source).
- `empty`: nothing unprocessed.
- `held`: a no-launch hold (above); the final input joins the held drain
  and nothing is launched; `next` is the explicit `retry --source FILE --launch`.
- `not-launched`: the source never launched a model session (for example a
  no-launch spawn's compensation): no harvester is launched; `next` resumes.
- `deferred` with `busy: true`: the worker lock is held by another process
  and no run is active (a settlement, or a completion already past its
  handoff). Nothing hands the final input on: the drain is recorded, the
  input is in custody, and `next` is the exact `run-source --source FILE
  --manual`. The hook waits for the lock at most 20 s, and only out of what
  the spawn does not need.
- `needs-recovery`, `deferred` or `failed`: custody is certified and retained;
  `next` is the exact command (`run-source --manual`, `retry --launch` for a
  worker prepared but not launched, or the active run's recovery). The hook
  never claims a drain it did not do, and never launches past its deadline.
- A promised handoff (`started`, `already-running` with `handoff`) carries
  the `prerequisite` above: with the deployment off when the active run
  completes, the drain pauses with its input in custody.

With harvest off at retirement, no final capture is taken and no drain is
requested; earlier custody stays. A captured (portable) source certifies
custody only: its drain stays held for its admitted operation.

**The harvester retires after delivery (#47).** Once every destination has a
delivery receipt (a verified PR, a directory publication, or no change),
`oats okf-harvest harvest-status` answers `retire`: the harvester hands over
the run and its PR URLs in its final reply and retires. A delivery in
progress, failed or stopped keeps it (`stay`, or `max-age`). The knowledge
maintainer reviews the PR without it: it amends and merges, or closes, and
never waits for a harvester. `notify-harvester` remains only for harvesters
spawned by 4.1 that still wait.

**Recording the review outcome.** A live source records it at its next
checkpoint (step 3). For a retired source, the source deployment's operator
does: `oats okf harvest-status --soul <soul> --json` lists, per source,
`outstanding` with every earlier run that has a destination whose review
outcome is not recorded (`kind: review`, each destination's status, PR and
last error, also after a failed settlement) and its exact command, for example
`cd /deployment && oats okf complete --source /state/sources/<id>/source.json --run <run> --soul <soul> --json`,
plus an active, deferred or stuck run (`active` / `deferred` /
`needs-recovery`), a requested rejudgment (`rejudgment`) and an unfinished
drain (`drain` with its `prerequisite` and, when paused, why;
`pending-input`). That command records each destination on its own: a newly
recorded close answers `E_PR` with every destination's receipt in
`error.result`, and a repeat answers the recorded outcomes. `delivered` until then is honest: processed,
not accepted, and it blocks no new work. A closed PR is recorded `rejected`;
rejudging it stays the explicit `oats okf retry --source FILE --run ID --rejudge`.

**Removed and changed** (contract changes):
- oats.okf manages no scheduler job: no code of the package adds, enables,
  disables, removes, lists or installs one. The jobs 4.1 created are removed
  by the operator with the kernel (`oats schedule remove`; see
  [Upgrading from 4.1](#upgrading-from-41)).
- A live bindings document with `cron` or `tz` is refused:
  `E_HARVEST_SCHEDULE_REMOVED: oats.okf 4.2 harvests at checkpoints, not on
  schedules: remove cron/tz from the bindings file, and remove each
  okf-<source id> job okf <= 4.1 created with oats schedule remove <id> --dir
  <deployment> (README#upgrading-from-41).` Source
  descriptors frozen by 4.1 and earlier keep their recorded `cron`/`tz` as
  inert history: they load, their fingerprint (which never covered them) and
  bytes are unchanged, and nothing uses them.
- `run-source` without `--manual` (what a 4.1 job runs) answers
  the same `E_HARVEST_SCHEDULE_REMOVED` and captures nothing. `run-source --source
  FILE --manual` stays the operator's explicit recovery.
- `setup --source`, `--enable`, `--disable`, `--install-host` and
  `--remove-schedules` (a 4.2 candidate's job cleanup) answer `E_REMOVED`,
  naming the checkpoint, the switch and the kernel's `oats schedule remove`.
  `oats okf inspect` no longer reports scheduler health.
- The spawn hook's meta carries `checkpoint: "oats okf harvest"` instead of
  `schedule`. `oats okf harvest` answers `started`, `already-running`,
  `empty`, `held`, `needs-recovery`, `deferred` or `retired`, with `settled`, instead
  of the run's own status. `harvest-status` rows carry `outstanding`, no
  longer `auto`/`schedule`.
- A confirmed worker whose preparation was interrupted (its spawn receipt is
  recorded, it was never launched) is prepared again in place by
  `oats okf retry --source FILE`: persisted stages are kept, a partial one is
  redone, and nothing is spawned twice.
- `oats okf retry` re-reads the switch and the soul's opt-out (an absolute
  one too) before anything that would start new harvest work. While harvest
  is off it answers `harvest-off`, naming what it `refused`, and changes
  nothing. A new run from custody re-reads consent under the source's worker
  lock, right before capture, so a completion that frees the active slot
  meanwhile grants nothing (`run-source --manual` does the same). It refuses:
  - a new run from custody (no active run);
  - `--launch` of an active ready, deferred or scaffolded worker;
  - `--rejudge` of the active run;
  - `--run ID --rejudge`, with or without `--launch`;
  - any combination with `--launch`, such as `--adopt-home … --launch`.
  `--launch` never overrides an opt-out. While off, retry still recovers
  existing custody, without new work: plain `retry` delivers a persisted
  judgment (and its completion pauses the drain rather than hand a batch
  on) or prepares a confirmed worker in place without launching it, and
  `--adopt-home` records a worker whose spawn already happened. Inspection
  and `complete` are unchanged. The manifest-bound `harvest --once` keeps
  its own contract: the host switch does not govern it, and its opt-out
  override stays explicit and recorded. An explicit `retry --launch` of a
  prepared worker clears its `--no-launch`, and a no-launch hold, so its
  completion hands the drain on.
- When the worker's checkout of a delivered run is gone (the harvester
  retired), settlement rebuilds it from the frozen proposal under the run's
  own state. A rebuild that was interrupted (by the deadline or a transport
  failure) never became the run's stage and holds nothing of record: the
  next checkpoint or `complete` discards and redoes it.
- `oats okf complete` on a run that is already processed settles each
  destination on its own (above); first delivery still stops at the first
  failing destination.

**External repositories (#55).** A source spawned with `--repo` outside its
deployment keeps that repository as its context. Every `oats` call that needs
the deployment (the harvester spawn and its session start, the live consent
read, every printed operator or completion command, the harvester's own
`okf-harvest complete`) runs in the deployment the kernel names:
`OATS_WORKSPACE` (hooks), else `OATS_TEAM_SCOPE` (command dispatch), or a
captured source's frozen execution binding, which nothing ambient replaces.
Neither named, or the two naming different deployments, refuses with
`E_DEPLOYMENT_SCOPE` before any read, capture or spawn; oats.okf never looks
for a deployment from the repository. Frozen descriptors are not rewritten.
CI's `external-repo-041` job runs a real external-`--repo` source on
released OATS 0.41.0 through its checkpoint to a real harvester spawn
(`--no-launch`) and retirement, after the released v4.1.1 payload fails the
same fixture on the kernel's scope refusal. No model, host timer or scheduler
job is involved.

### Upgrading from 4.1

oats.okf 4.2 creates and removes no scheduler job; the operator removes the
jobs 4.1 created with the kernel's own commands
([OATS v0.41.0 schedules](https://github.com/awebai/oats/blob/v0.41.0/docs/schedules.md):
Commands, Changing a job).

1. **Quiesce old homes.** A home spawned with 4.1 keeps its hooks, which
   register its job again on spawn replay and retire. Finish or retire such
   homes under a plan first; their unprocessed custody is kept.
2. **Pin and sync 4.2.0** (mirror and catalog pin in one reviewed change,
   then `oats sync`). Harvest stays off until `oats okf setup --harvest on`.
3. **Remove `cron` and `tz`** from every live bindings file
   (`settings.oats.okf.bindings-file`); until then it answers
   `E_HARVEST_SCHEDULE_REMOVED`.
4. **Remove each old OKF job, per deployment.** Every deployment that ran
   4.1 has its own jobs, in its own scheduler: in each one,
   `oats schedule list --dir <that deployment> --json`; an old OKF job is
   `okf-<source id>` running
   `oats okf run-source --source <that source's descriptor> …`. For each,
   `oats schedule remove <id> --dir <that deployment>`. Decide by its definition,
   never by the `okf-` prefix alone, and never with `--force` (it only
   forgets the job and stops nothing). The kernel refuses while the job has a
   tracked instance or an unresolved effect: let it end or settle it
   (`oats schedule reconcile <id> --dir <that deployment>`), then remove it
   again. A refused job is not removed.

After the upgrade `oats okf inspect` shows no scheduler health at all: by
design, since 4.2 has no job to report, not a fault.

The `harvest-review` trigger is not a scheduler job: `oats schedule` neither
lists nor removes it. **Stop** on an uncaptured source tail, a job you cannot
attribute from its definition, or a refusal you cannot settle; never erase
custody, re-create old schedules or edit copied homes.

### The first harvest-on source

Installing and syncing 4.2.0 proves nothing about live behavior; one source,
end to end, does. Before broad enablement:

1. **Prerequisite: the review trigger.** The `harvest-review` trigger
   (`oats.okf:harvest-review`, label `okf-harvest`) is installed for the
   knowledge-base repository and its host timer is active, or no maintainer
   is spawned for the PR. `oats trigger list` shows it; this package never
   installs it.
2. **The canary: deployment ON, exactly one new source.** A global switch is
   not per-source authorization, so the canary is held by the operator, not
   by a flag: the operator switches deployment ON, allows exactly one NEW
   canary spawn, holds all other new production spawns until checkpoint ->
   harvester -> PR -> review -> merge -> receipt-settled passes, then normal
   spawning resumes. On failure switch deployment back OFF, retain evidence
   and unresolved runs; do not assume already-running work is killed.
   Existing harvest-off homes are not backfilled by the toggle.
   **Preflight, before switching on:** holding new spawns is not enough.
   Inventory and quiesce work already running or pending (`oats status`,
   `oats okf harvest-status --soul <soul> --json` for every soul with
   oats.okf: active runs, paused drains, outstanding reviews) and every
   existing source that could checkpoint, retire or complete while the
   deployment is on (a home spawned with harvest on, or a retired source
   with outstanding work): each is finished, held or accepted into the canary
   scope explicitly, with what was decided recorded.
   **Homes copied before 4.2.0 keep their copied modules.** The live switch
   read is in this release's code; a home spawned with an earlier version
   (or an earlier 4.2 candidate) runs the hooks and commands it copied, which
   read the settings its spawn captured: a pin or sync does not reach it, and
   switching the deployment off is no proof such a home cannot capture or
   start a run. Inventory and quiesce those homes (finish, retire under a
   decision, or hold them) before relying on the switch; nothing rewrites a
   copied home in place.
   A spawn-only provider setting (`oats spawn <soul> --provider oats.okf
   harvest=on`) does not make a canary: its first run starts, but its
   continuation and settlement run in deployment scope and pause while the
   deployment is off (the scope above).
3. **Checks, in order**, from the seat's home unless noted:
   - spawn: `meta.harvest: "on"`, `meta.checkpoint: "oats okf harvest"`, no
     `meta.schedule`; `oats schedule list` gains no `okf-` job;
   - `oats okf harvest --json` → `status: "started"`, `launched: true`, a
     `run` and `instance`; a second call → `already-running` with that run;
   - the harvester completes (`delivered`, its PR labelled `okf-harvest`),
     hands over and retires (`okf-harvest harvest-status` → `retire`);
   - the maintainer reviews and merges (or closes) the PR;
   - the next `oats okf harvest --json` → `settled: [{run, outcome:
     "accepted"}]` (or `"rejected"`), apart from `status`;
   - retire → `meta.retired: true`, `meta.capture.complete: true`,
     `meta.drain.status` reported;
   - from the deployment, `oats okf harvest-status --soul <soul> --json` →
     the source's `outstanding` is empty, or lists exactly what is owed with
     its command.
   Any other answer is a stop: report it with the run id; do not retry an
   unknown effect.

**Rolling back** is a reviewed re-pin of the previous version, and retiring
sources is not by itself a safe boundary. A retired source's harvester and
operator complete its runs with the deployment's selected package, and 4.1's
`complete` finishes the active run but hands no drain on: the rest of a 4.2
drain would have nothing to continue it. (A test runs 4.1.1's actual code at
this boundary.) Before re-pinning:

1. Hold new spawns of harvesting souls, and retire every home spawned with
   4.2 that harvests: its copied 4.2 retire hook requests a drain, which only
   4.2 continues.
2. Settle every 4.2 obligation under 4.2. Inventory every soul with oats.okf
   and every state namespace (each distinct bindings file and `stateDir`):
   `oats okf harvest-status --soul <soul> --json` for each. Do not re-pin
   while any source lists ANY `outstanding` row: a drain (`active`,
   `deferred`, `needs-recovery`, `rejudgment`, `drain`,
   `pending-input`) or a review whose outcome is not recorded (`review`,
   including a destination whose last settlement failed). Run each row's
   command; a paused drain needs the deployment's harvest switch on while it
   finishes, and a review needs its PR merged or closed by the maintainer
   first. Review rows are no exception. 4.1's `complete` stops at a
   destination already recorded closed, so it never records a later merge
   of the same run (a test runs 4.1.1's actual code on that case). There is
   no qualified route that keeps 4.2 settling after a re-pin.
3. Then re-pin. Do not recreate schedules, and do not edit frozen
   descriptors to make a rollback look complete. Sources registered by 4.2
   have no `cron`/`tz` in their frozen bindings, which 4.1's spawn and
   retire hooks need to register a job; that is why their homes are retired
   first. Sources registered by 4.1 are unaffected.

## 4.1.1 — fixes to complete and harvest --once

- `oats okf complete --run <id>` reports `delivered` when the maintainer has
  amended an open PR on top of the delivered commit. It no longer fails with
  `E_PR`.
- Two `harvest --once` calls for one seat can no longer both install
  overlapping notes.
- A rerun of a draining one-shot continues from custody, even when a listed
  note was edited since.

See [CHANGELOG.md](CHANGELOG.md).

## 4.1.0 — a one-shot reviewed harvest from an explicit record set

When a seat moves (for example from a classic deployment to a v2 workspace)
its unharvested notes must still reach the knowledge base, but nothing was
registered to capture them. The operator now harvests that seat once, from a
manifest of hash-verified files:

```sh
oats okf harvest --once --home /abs/instance-home --records /abs/manifest.json --soul <its soul> [--override-opt-out] [--no-launch]
```

```json
{"version":1,"instance":"<instance name>","roots":["/abs/archive"],
 "notes":[{"path":"notes/x.md","sha256":"<64 hex>"},{"path":"/abs/archive/y.md","sha256":"<64 hex>"}]}
```

- **Inputs:** only the listed files. A relative path is in the home; an
  absolute one is in the home or a listed root. Every file is a regular,
  single-link `.md` reached through no symlink (canonical paths: no symlinked
  directory anywhere on the way). Its sha256 is checked against exactly the
  bytes then used. Any bad entry refuses the whole manifest before anything is
  stored. Bounds: 2000 entries, 16 MiB a file, 256 MiB in all.
- **Session records** (archived harness transcripts) are refused with
  `E_UNSUPPORTED` until OATS offers `oats capture --file` (feature
  `capture-file`); oats.okf never parses harness formats itself.
- **Attribution:** the seat's soul and its `okf.json` owner (pinned as at
  registration); writes only to the nodes it owns, reads read-only. `--soul`
  must name the seat's soul, and a seat cannot run it on itself.
- **The normal path:** the knowledge-harvester judges, `complete` publishes a
  PR labelled `okf-harvest`, the knowledge-maintainer reviews it. Nothing
  merges directly. The PR's provenance carries
  `once: {manifest, entries, override}`, never paths.
- **One-shot:** no home pointer, no schedule, no capture. Its custody is
  `<stateDir>/sources/<id>/` with `once` in the descriptor and a receipt
  `once.json` (entry names and hashes, runs). The id is derived from the seat,
  owner and manifest, so a rerun with the same manifest continues it: it runs
  the next bounded run (each run says how many inputs remain), or answers
  `already-delivered`. Since 4.1.1, a rerun continues from custody: the
  manifest must hash to the one in the receipt, and the listed notes are not
  read again, so a note edited since never enters the one-shot. A different
  manifest repeating notes that another one-shot of the seat holds
  (harvested or still draining) is refused (`E_ONCE_OVERLAP`): rerun that
  one-shot's manifest to continue it. The check compares the receipt's
  names and hashes before any note is read, and then the input ids. The
  checks and the install run under one seat lock
  (`<stateDir>/once-<hash>.lock`).
- **Switches:** the host's harvest switch does not apply (an explicit
  operator action). A soul's opt-out, or an opt-out that cannot be read, is
  refused unless `--override-opt-out`, which the receipt and the PR record.
- **Privacy:** the same exclusion rules as every harvest; the harvester's task
  says the records are archived and may hold third-party content.
- `oats okf harvest-status --home <seat>` shows the seat with no registered
  source and its one-shots apart (`once`: state, runs, PRs).

## 4.0.7 — acceptance of an amended and merged PR

`oats okf complete --run <id>` after the maintainer's `amend+merge` verdict
records acceptance of the merged PR at its merge commit. It no longer fails
with `E_BASELINE`, and nothing is rejudged. See
[CHANGELOG.md](CHANGELOG.md).

## 4.0.6 — harvest completion on a real host

- `oats okf complete` persists the harvester's judgment first, then delivers
  in a detached worker. After persisting the judgment it waits up to 30 s:
  it answers with the final receipt when delivery ends by then, otherwise
  with `status: delivering` and its progress.
  A killed `complete` loses nothing. Rerunning it resumes and never judges
  again.
- A worker lock left by a dead process is reclaimed automatically.
- A Git base whose head moved outside its knowledge root is no longer a
  baseline change. Only changed root bytes need a rejudge.
- Staging fetches a base root's blobs in one batch, and delivery fetches no
  blob outside the root.
- `harvest-status` reports `unknown` when it cannot read a soul's opt-out.

See [CHANGELOG.md](CHANGELOG.md).

## 4.0.3 — consultation with harvest off

Harvest is off by default. Before 4.0.3, a home spawned with harvest off had no
source, so every `oats okf` consult command and `inspect` failed. Such a home
now consults through its soul's declaration and the deployment's bindings; it
still registers, captures and schedules nothing. Homes spawned by 4.0.0–4.0.2
work after `oats sync`, with no respawn. See [CHANGELOG.md](CHANGELOG.md).

## 4.0.2 — no okf team

The harvester and the maintainer no longer join an okf team; they live in the
deployment's default team, like every instance:
- `run-source` spawns the harvester with no `join`;
- the `harvest-review` trigger template has no `spawn.teams`;
- the package souls carry no `team`.

There is no `okf` team to declare or map. A deployment that wants them in
another team opts them in locally, as for any soul (OATS team model v2). See
[CHANGELOG.md](CHANGELOG.md).

## 4.0.1 — security fix

**Upgrade from 3.0.0 or 4.0.0.** A crafted Git base tree could make base
validation write files outside its scratch directory; 4.0.1 refuses such a
base with `E_PATH`. 4.0.1 also:
- refuses credentials embedded in repository URLs and redacts URLs in all output;
- makes `review-context` trust only the accepted `okf-base.json`;
- ties the maintainer's merge to the reviewed head;
- makes `okf-needs-human` a hard stop;
- makes `run-source` and `retire` re-read the soul's harvest opt-out.

See [CHANGELOG.md](CHANGELOG.md).

## 4.0.0 — knowledge operations: harvest, maintenance, triggers

Requires OATS **>=0.29.0** (package souls, triggers and workspace automations).

**Three capabilities in one package.**

| Capability | For | Skills | Commands |
|---|---|---|---|
| `oats.okf` (knowledge slot) | every working soul with OKF knowledge | `okf-consultation`, `okf-instance-knowledge` | consult (`bases index cat ls links search`), `setup`, `harvest-status`, `init`/`migrate`, source custody (`run-source complete retry`), the spawn and retire hooks |
| `oats.okf-harvest` | the harvester soul | `knowledge-theory`, `knowledge-harvest`, `okf-authoring` | `okf-harvest complete`, `okf-harvest harvest-status` |
| `oats.okf-maintenance` | the maintainer soul | `knowledge-theory`, `knowledge-review`, `okf-authoring`, `okf-trigger-setup` | `okf-maintenance review-context`, `okf-maintenance notify-harvester` |

- `knowledge-theory` (the OKF promotion doctrine, formerly `memory-harvest`)
  and `okf-authoring` (formerly `okf`) ship as identical copies in the two
  role capabilities; a test fails if they differ.
- Working souls get no harvest doctrine at all.

**Two package souls.**
- `oats.okf/knowledge-harvester` and `oats.okf/knowledge-maintainer`: `work:
  directory`, `team: okf`, `knowledge: none`, each with its own capability
  `from: here`.
- They replace the `agents/memory-harvest` capability agent. The manifest has
  no `agents:`.

**The harvester.**
- `run-source` spawns `oats.okf/knowledge-harvester` for each run. It joins
  the okf team through the soul's messaging capability, taken from `spawn
  --preview`, the same way a trigger spawn does.
- It must read the notes AND every transcript window. The judgment receipt
  cites the turn ids a record-fed promotion relied on (`outcomes[].turns`,
  enforced) and the task refs it saw (`tasks.refs`).
- `oats okf-harvest complete` runs the source's frozen `oats okf complete`
  from the source deployment, so there is still ONE publication path. If
  oats.okf cannot run there, it answers `E_SOURCE_INACTIVE`, and the
  harvester reports and stays.
- The PR carries the label `okf-harvest` (created if missing) and a fenced
  `okf-harvest` provenance block (C3): `{version, run, input[], source: {soul,
  soulId, instance, ownedNodes, readNodes, bases}, tasks: {provider, refs},
  harvester: {instance, alias}}`.
- Until 4.2.0 the harvester stayed alive until the PR was merged or closed.
  Since 4.2.0 it retires once every destination is delivered (see 4.2.0).
  `okf-harvest harvest-status` answers `stay`, `retire` or `max-age`.
  `harvester-max-age` defaults to 7d. The harvester never closes the PR.

**The maintainer.**
- It is spawned per PR by the `harvest-review` trigger template:
  `triggers/harvest-review.json`, `repo` required, label `okf-harvest`, soul
  `oats.okf/knowledge-maintainer`, teams `[okf]`, `max 2, perKey 1`, templated
  only from whitelisted fields.
- `review-context` validates the provenance as untrusted input and returns a
  reading list. The maintainer then merges, amends and merges, requests
  changes, or closes.
- It never silently supersedes a human-accepted decision: such a PR gets
  `okf-needs-human` and goes to a human.
- `okf-trigger-setup` teaches the workspace automation file first
  (`oats-triggers/okf-harvest-review.yaml`, `kind: oats-trigger`, `from:
  oats.okf:harvest-review`, `runsOn`, `owner`), and `oats trigger add` as the
  machine-private alternative.

**The harvest switch.**
- `harvest: on|off` is an `oats.okf` setting, **default off**, set per host in
  `oats-local.yaml` (`oats okf setup --harvest on|off` writes it).
- A soul may only opt out, with `knowledge: { harvest: off }` in soul.yaml, and
  the opt-out is absolute. It is read from the soul's own soul.yaml, because
  the kernel's merged settings are later-wins. An unreadable opt-out counts
  as off, and so does a soul `harvest: on` (which is also reported).
- With the switch off, spawn registers no source and there is no capture or
  custody. Retire has nothing to capture, and a manual `harvest` answers
  `E_HARVEST_OFF`.
- An already registered source's checkpoint (since 4.2.0), retire, drain
  continuation and `run-source` do nothing while the switch is off.
- `oats okf harvest-status [--soul X]` reports the effective value, why, and
  the registered sources. Run from the deployment it reports the
  deployment's current switch; run in a home it reports that home's
  spawn-time settings (a checkpoint there reads the deployment's).

**Working souls.**
- The inject teaches the work mode: consult soul and instance knowledge at
  task start and after compaction; update instance knowledge before
  compaction; consult again every so often and before decisions; capture with
  judgment.
- `okf-instance-knowledge` teaches the capture test, what to capture and what
  not to, the note form (type, claim, why, evidence, generality) and when to
  write.

**Removed.**
- `oats okf read` (`E_REMOVED`; use `cat`).
- The `memory-harvest` and `okf` skills from `oats.okf`.
- The `agents/memory-harvest` capability agent.

**Upgrading.**
- Pin `oats.okf` 4.0.0 on OATS >=0.29.0.
- Declare the `okf` team with its messaging mapping: with aweb (the default;
  oats.aweb >=1.15.0 honours `join=okf`), `messaging.byTeam.okf: { team: aweb:<org>.okf }`.
- Harvest is off until a host sets `harvest: on`, including for sources
  registered by 3.x.
- Install the review trigger on the one merge-capable host (see
  `okf-trigger-setup`).

## 3.0.0 — consult knowledge remotely; no per-instance copy

**Changed.**
- Instances consult their soul's knowledge **remotely, at the accepted state**:
  no knowledge bytes are copied into an instance home. A new consult CLI ships
  in the capability — `oats okf bases`, `index`, `cat`, `ls`, `links` and
  `search` (all with `--json`) — reading a Git base's accepted commit from a
  host-wide bare partial clone at `<stateDir>/cache/<base-id>.git` (blobs are
  fetched on first read), and a directory base in place under its cooperative
  lock. Only the accepted commit is ever served; `--fresh` refetches the
  accepted branch, otherwise it is refetched when older than the new
  `consult-max-age` setting (seconds, default 300). A failed fetch serves the
  last fetched accepted commit with `stale: true` and the reason. Every answer
  carries a receipt `{base, kind, commit|digest, fetchedAt, stale}`. Paths
  resolve like OKF links and never leave the base root.
- A new full skill, **`okf-consultation`** (plus `references/consult.md`),
  teaches the consult CLI: the model, the task-start checklist,
  consult-while-working triggers, navigation, search, citing, freshness and
  gotchas. The `okf` skill stays the format/authoring craft and points to it.
  The injection names two kinds of knowledge and tells every instance to
  consult both at the start of every task, after compaction and while it
  works, to make decisions and to understand things:
  - **soul knowledge**, the accepted bases, read by consultation: load
    `okf-consultation`, then use `oats okf index`, `cat` and `search`;
  - **instance knowledge**: its own STATE.md, log.md and notes/.
- Spawn registers the accepted resolution (per base: commit or digest, and its
  nodes, validated once per commit and cached) without materializing files;
  the spawn brief points at `oats okf index`. `read --base A --path P` stays as
  an alias of `cat` (same `path`/`text`/`receipt` fields).
- The memory-harvest worker is spawned with `--harness` when `oats version`
  reports the `harness` feature, else `--runtime`. The kernel composes no okf
  injection for a capability agent, so the consultation protocol does not
  apply to the worker. Its `AGENTS.md` says it judges owned nodes from its
  staged roots in `./work`, never through `oats okf index|cat|search`: those
  serve the accepted state, not its staging.

**Removed.** The `./knowledge/` snapshot and every per-call
`knowledge-view-<uuid>` directory. The memory-harvest worker soul's
`CLAUDE.md -> AGENTS.md` symlink (npm drops symlinks; the capability tree now
ships none and a test enforces it — the kernel composes each instance's
`CLAUDE.md` itself). `oats okf refresh` returns `E_REMOVED` (okf
3.0.0 has no per-instance views; `index`/`cat` always read the accepted state).
Harvest staging, which is a worker scratch rather than an instance copy, is
unchanged.

**Upgrading.** Nothing to do on the host. A 2.x instance's `./knowledge/` is
ignored — `oats okf inspect` reports it as `legacy-local-view` — and may be
deleted by hand. Wire, payload and record protocol versions are unchanged.

## Background

The v2 runtime was a breaking change from soul-contained
v1 knowledge. All knowledge lives in external
bases. Skills remain curated soul artifacts; v2 never automatically edits them.
Procedure candidates may become external Playbook concepts.

**Release payload:** `oats-package/capabilities/oats-okf/`, enumerated by
`oats-package/oats-package.json`. The obsolete unenumerated root `oats.json`,
`bin/`, `agents/`, `skills/` and `injects/` copies have been removed; they are not
an alternative runtime. The distribution retains its manifest and LICENSE, and
the capability is self-contained, including both runtime skills, worker soul,
injections, validator and schemas. Source version metadata is not a claim that
a tag was published or deployment/installed acceptance passed.
Historical verification notes retain their original checkpoint versions; current
compatibility is declared by the manifests and this guide.

## Configuration and ownership

A workspace declares the package (`packages: { oats.okf: v4.2.0 }`) and selects
it as the knowledge capability (`defaults: { knowledge: { oats.okf: { from:
package } } }`, or per soul). Each deployment points it at its bindings file
in its own `oats-local.yaml`:

```yaml
settings:
  oats.okf:
    bindings-file: /absolute/config/okf-bindings.json
```

The **2.1.2 diagnostic correction** names a missing/invalid runtime setting in
existing wire `error: {code: "needs-configuration", message: "..."}`. Only fixed
setting names and constraints are emitted, never supplied values, paths, aliases,
unknown keys or raw exception text. It covers `bindings-file`, `state-dir`,
`harvest-runtime` and an invalid `harvest-model`; null/omitted model remains valid
native-default intent at this codec boundary. The equivalent check validates the
RETAINED bound runtime, not mutable request settings, before store access.
Unrelated malformed envelopes and general errors remain code-only. This changes
no wire/payload schema, selected-model/helper rule, readiness gate or remote
validation policy. The manifest declares all seven strings in `binding.reasons`
for a reasons-capable kernel's byte-exact allowlist; unlisted text still must not
cross that boundary. Older closed binding-interface readers reject this new
metadata, so both package and capability require OATS >=0.24.4. Release and
upgrade the compatible kernel before selecting this provider release.
Provider emission alone does not establish CLI display, installation or readiness.

The **absolute** bindings document is capability-owned JSON:

```json
{
  "version": 1,
  "stateDir": "../durable-okf-state",
  "bases": {
    "project": {
      "id": "project-knowledge",
      "kind": "git",
      "repository": "https://github.com/example/project.git",
      "root": "knowledge",
      "acceptedBranch": "main",
      "pr": {"repository": "example/project"}
    },
    "team": {
      "id": "team-knowledge",
      "kind": "directory",
      "path": "../team-knowledge"
    }
  }
}
```

Since 4.2.0 the document has no `cron` or `tz`: a live one carrying either is
refused with `E_HARVEST_SCHEDULE_REMOVED` (see 4.2.0 for the migration).
Paths inside this document resolve from its directory, not cwd. Git supports
HTTPS, SSH and durable local repositories; `root: "."` is a dedicated knowledge
repository. Initial PR support is **same-repository branches**, using native
`git` and `gh` with the operator's ordinary credentials. Configure the matching
GitHub `owner/repo`. There is no direct-write Git fallback, fork-routing system,
new ACL, public/private model or mandatory doctrine for other capabilities.

Directory custody works without `git`, `gh`, a `.git`, or a fake repository.
Directory bases inside ANY Git working tree are deliberately rejected, including
ignored subdirectories: relabeling tracked custody must not bypass PR delivery.
Use physical, non-symlinked, nonoverlapping paths. State must be outside accepted
bases and source homes/worktrees. A local Git locator must be a durable canonical
repository, not a disposable linked worktree. Bases cannot overlap. There is one
OKF root-link namespace **per base**, not one per node.

Each persistent soul carries **`soul/okf.json`**, not knowledge bytes:

```json
{"version":1,"owner":"domain-expert-stable-id","owns":["project/expert"],"reads":["project/steward","team/operations"]}
```

Each accepted base carries **`okf-base.json`**:

```json
{"version":1,"id":"project-knowledge","nodes":{"expert":{"path":"expert","owner":"domain-expert-stable-id"},"steward":{"path":"steward","owner":"steward-stable-id"}}}
```

**A bound base's `id` must equal the `id` in that base's `okf-base.json`.** The
alias (`project` above) is yours to choose, and it is what souls' `okf.json`
names; the `id` is the base's own. Take it from the base, e.g. the aweb base's
is `aweb-oss-knowledge`. A mismatch fails every read of that base with `E_BASE`
("base identity/nodes mismatch").

Stable owner IDs must not ambiguously identify different souls in one state
namespace. If a stable owner ID already identifies a different soul in this state
namespace (for example after renaming a knowledge-owning soul after it spawned),
registration is refused and names both the existing soul and the new one. The two
remedies are explicit: retire the existing registration first, or use a fresh
state directory. Nodes are nonoverlapping subdirectories with an index, owned by
one stable ID. `owns` routes responsibility; `reads` selects initial context.
Neither is an ACL. Every configured base is discoverable and readable. Missing
explicit configuration, base metadata, ownership, or indexes fails required spawn
safely; reads never silently bootstrap empty knowledge.

JSON Schemas are in `schemas/` in the capability and repository. The provider-
specific portable forms are `okf-portable-declaration.schema.json` and
`okf-portable-payload.schema.json`; the generic ProviderBinding1 and lifecycle
receipt envelopes remain kernel contracts. Runtime also
checks filesystem containment, identities, overlap, base metadata and complete
OKF conformance; schema validation alone cannot establish these properties.

## Portable source bindings (2.1.0; OATS >=0.24.0)

The coordinated first-cut target is OKF **2.1.0** with OATS **0.24.0** or later.
Metadata is not runtime or publication proof, and this candidate does not claim
compatibility with 0.23.x. Do not copy internal codec commands into an older
installation. Final installed verification must use the actual release pair.

A portable soul owns its knowledge declaration, not the deployment's concrete
credentials or mutable readiness. Its decoded `knowledge` value uses
`oats.okf.locations@1`:

```json
{
  "contract": "oats.okf.locations",
  "version": 1,
  "payload": {
    "owner": "domain-expert",
    "stores": {
      "reference": {"fixed": {"id":"public-reference","kind":"git","repository":"https://example.invalid/knowledge.git","root":"knowledge","acceptedBranch":"main","pr":{"repository":"example/knowledge"}}},
      "local": {"default": {"id":"local-notes","kind":"directory","path":"path:/srv/oats/example/local-notes"}},
      "destination": {"inherit": "write.default"}
    },
    "reads": [{"store":"reference","node":"conventions"}],
    "owns": [{"node":"expert","destination":"destination"}]
  }
}
```

`fixed` is a source-owned equality constraint, `default` is a source fallback
candidate, and `inherit` requires a separately supplied binding. Reads never
become write destinations. Every owned node names a destination or requires the
explicit `write.default`; the provider never invents one.

A matching workspace entry carries provider-owned bindings inside its envelope:

```json
{
  "knowledge": {
    "stores": [{
      "contract": "oats.okf.locations",
      "version": 1,
      "payload": {"bindings": {
        "write.default": {"id":"workspace-knowledge","kind":"directory","path":"path:/srv/oats/example/workspace-knowledge"}
      }}
    }]
  }
}
```

Workspace, import-adoption and operator values remain separate candidates. OKF
does not choose precedence; it emits requirements/candidates under
`/bindings/knowledge/...` for the kernel's single resolver. Other providers own
their own payloads—the kernel does not impose the OKF store/node model on them.

In 2.1.2, normalization first derives the knowledge-owned binding addresses from
that source's fixed/default/inherited stores and required write destinations.
Only matching entries in workspace/adoption/operator maps are parsed as OKF
locators. Sibling aweb human/team/consent entries and undeclared store addresses
are ignored by OKF, not removed from the shared request or weakened for their
own provider. Dotted aliases, declared custom inheritance and implicit
`write.default` remain supported; malformed OWN values still fail and missing
required fields remain resolver requirements. Declaration order does not change
ownership, precedence or provenance; there is still one kernel resolver.

Portable preparation selects explicit capability settings:

```json
{
  "bindings-file": "/srv/oats/example/config/okf-bindings.json",
  "state-dir": "/srv/oats/example/state",
  "harvest-runtime": "pi",
  "harvest-model": "provider/model-if-explicitly-selected"
}
```

`bindings-file` is the host-owned descriptor location used for path custody;
`state-dir` is independent durable state. Both are normalized physical absolute
paths and neither is derived from a disposable instance home. `harvest-runtime`
is selected (manifest default: `pi`); `harvest-model` is optional and is never
guessed. These nonsecret values are captured into the effective binding.
`git-timeout` (seconds, default 600) bounds every Git operation that talks to a
remote: clone, fetch, push and ls-remote. Local object reads keep a short fixed
limit. Every configured base must be usable at spawn: this is a deployment
invariant, not a per-soul optimization, because `oats okf cat --base <alias>`
may target any configured base and partial availability would make reads
ambiguous. A bad base therefore blocks every knowledge source in that deployment,
and the required hook names the base alias, repository and remedy: fix the
binding for that alias in the bindings file, or remove the base from the
bindings. Git base clone, fetch and checkout/materialization failures are typed
as `E_BASE_UNAVAILABLE` with `{base, repository, step, reason}` where `reason` is
`timeout`, `auth`, `not-found`, `network` or `unknown`; an `unknown` reason also
includes the original Git failure text, and raw `spawnSync ETIMEDOUT` is not an
operator-facing diagnostic. Shallow Git bases are refused before registration as
`E_BASE_SHALLOW`; bind a full repository instead. A Git base is staged as a
single-branch partial clone (blobs fetched on first read) and only the base root
is materialized; the index still carries the whole tree, and the scope check
accepts an entry outside the root being absent from the staging tree, which is
now true by construction, while anything present or staged outside the root is
judged as before. A large repository, or one carrying large files outside the
knowledge base, costs nothing beyond the accepted branch's trees.

Owner pins are keyed by the soul identity the kernel provides in
`OATS_SOUL_ID` (repository key plus soul name for a workspace soul; the resolved
soul path for a classic soul), so a workspace deployment's per-commit soul
copies never re-identify a soul. A pin written by an earlier version as a path
under `agents/<same soul name>/(soul|souls/<commit>)` is rewritten to the
identity once; any other mismatch stays a refusal.

`oats okf migrate --legacy` stages the accepted base before it writes any
record, so an unreadable base leaves nothing behind; a failure after the record
exists is written into it (`receipt.status: failed` with the error), and
`oats okf migrate --forget ID` removes a record that never delivered.

The manifest exposes broker-owned `binding-normalize`, `binding-bind`, and
`binding-check` commands. They are bounded JSON protocol entrypoints, not manual
operator commands. The framework verifies and obtains exact executable approval
for retained provider bytes **before** running any codec. Normalize emits
requirements/candidates/model; bind emits nonsecret ProviderBinding1 fields;
check is read-only and can return `ready`, `needs-configuration`,
`authorization-required`, or `unavailable`. A binding is not proof of store
acceptance, credentials, provider enrollment, privacy, or wider-team consent.

Captured command/lifecycle invocation uses short-lived, same-user mode-0600
snapshots:

- `OATS_BINDING_FILE` contains exactly the retained ProviderBinding1.
- `OATS_INVOCATION_CONTEXT_FILE` carries the generic subject/context/action and
  incarnation/intent projection; execution reads this file, while binding check
  consumes only its inline stdin projection.
- `OATS_SOURCE_RECEIPT_FILE` additionally carries the parent-qualified persistent
  or helper lifecycle receipt for captured spawn/retire.

The framework creates them outside source homes and retained artifacts and removes
them after the synchronous invocation. The provider validates them strictly and
never stores their paths. A persistent registration freezes the complete binding,
rendered v1 runtime documents, qualified source identity, role, execution binding
and explicit responsible human into the existing durable source descriptor. A
helper registers no owner/source. `responsibleHuman: null` specifically means
messaging was disabled; a missing value is unknown and refuses.

Fresh captured lifecycle execution requires admitted generic inputs. Invalid or
unadmitted supplied context never falls back. An already registered source may
replay its qualified descriptor+binding contract without generic input, but this
compatibility path cannot create a new registration. Scope completion/retry can
finish only retained runs under their source binding—not invent a live source
incarnation or grant new worker/native authority. See
[invocation transport and limits](INVOCATION-WIRE-STATUS.md).

Captured persistent sources receive no schedule (none does since 4.2.0); one
registered earlier had a job with explicit saved `--deployment`/`--resolution`
selectors and no `--soul`. Consult reads, inspect and existing-run completion
use the exact frozen descriptor after source/config deletion. **First-cut captured worker creation is
operation-only:** a current admitted persistent-instance `knowledge:harvest`
operation with an explicit backend request may create and launch its retained
worker. See [the exact entrypoint and limits](CAPTURED-WORKER-STATUS.md).
Raw/null-intent harvest/run-source, schedules, always-on lifecycle harvesting,
relaunch/rejudge/adoption/recovery remain held. No live helper-selection fallback
or broader qualification follows from API availability or data-custody tests.
Captured `setup`, `init`, `migrate` and
`unlock` deliberately return non-ready/refuse before mutation; run those only as
separate explicit operator administration on the legacy/provisioning boundary.

Git locators retain exact accepted-branch and same-repository PR routing. Check
uses private temporary read staging and verifies the effective remote before
materializing raw Git objects. It never invokes checkout smudge/process filters
or working-tree encodings; native clone/fetch authentication remains separate.
Knowledge publication remains PR-only with no direct-write fallback.

Runnable protocol data is in
[`examples/portable-binding/`](examples/portable-binding/). Those examples use
reserved documentation paths and `example.invalid`, not deployment values.

## Explicit provisioning

Prepare per-base node maps. `/absolute/config/project-nodes.json`:

```json
{"expert":{"path":"expert","owner":"domain-expert-stable-id"},"steward":{"path":"steward","owner":"steward-stable-id"}}
```

And `/absolute/config/team-nodes.json`:

```json
{"operations":{"path":"operations","owner":"operations-stable-id"}}
```

From the deployment config context, using a soul selector when targeted:

```sh
# NEW directory base, explicit direct provisioning; refuses existing paths.
oats okf init --base team --nodes /absolute/config/team-nodes.json --confirm --soul domain-expert --json

# Git initialization is a staged operator proposal, never an automatic push.
oats okf init --base project --nodes /absolute/config/project-nodes.json --output /absolute/new-bundle-stage --soul domain-expert --json
```

For Git, put that bundle at the configured root in an **operator-owned checkout**,
commit, open/review/merge a PR, then activate working sources. `init` does not
pretend a local scaffold is already accepted Git knowledge. Existing bases/node
ownership changes require an explicit reviewed operator change, not harvest.

## Working-agent curriculum and reads

Working agents receive an index-first, read-only injection. They keep
`STATE.md`, append-only `log.md`, and content-versioned `notes/` in instance home.
They are not instructed to run harvesting or told how a harvester operates.
After compaction/resume, re-read state and relevant indexes. Consult prior
rationale before re-deriving it. Do not bulk-load bases or mirror repository code.

There is **no local copy** of any base in an instance home (3.0.0). Spawn
records the accepted resolution (per base: Git commit or directory digest, and
its nodes) in the source descriptor; the instance reads through the consult CLI,
from its home:

```sh
oats okf index                                   # owned then read nodes' indexes
oats okf cat --base project /expert/decisions/retry-policy.md
oats okf links --base project /expert/decisions/retry-policy.md
oats okf cat --base project ../lessons/storm.md --from /expert/decisions/retry-policy.md
oats okf ls --base project /expert/lessons       # entries + frontmatter type/title/description
oats okf search backoff                          # [--base A | --all] [--node N] [--regex]
oats okf bases                                   # accepted commit, freshness, validity, owns/reads
# From deployment context, including after source retirement:
oats okf cat --source /absolute/state/sources/UUID/source.json --base project expert/index.md --soul domain-expert --json
```

Paths resolve like OKF links: `/node/x.md` from the base root, a relative path
against `--from`'s directory, a bare `node/x.md` from the root. `..` escapes,
filesystem paths, URLs, hidden paths, symlinks and submodules are refused.

Git bases are read from one host-wide **bare partial clone** per base
(`<stateDir>/cache/<base-id>.git`, `--filter=blob:none --single-branch`) at the
fetched `refs/heads/<acceptedBranch>`: the same preflight, shallow, remote and
hardening checks as staging apply; blobs arrive on first read (a batched fetch
precedes `ls`/`search`). A per-base lock serializes clone/fetch; a cold cache is
built aside and renamed into place. The accepted branch is refetched when
`consult-max-age` has passed or with `--fresh`; a failed fetch serves the
cached commit with `stale: true` and its reason; with nothing cached the read
fails with `E_BASE_UNAVAILABLE`. `bases` reports whether the accepted commit
validates; the verdict is cached per commit (computing it materializes the
base root into a transient host scratch, removed immediately).

Directory readers hold the same cooperative lock as publication while reading
accepted bytes in place (staging and publication queue behind them for up to
10 s). A pending journal refuses reads with `E_RECOVERY` rather than exposing a
half-update. An open PR is not accepted knowledge. A `./knowledge/` left by okf
2.x is never read or deleted; inspect reports it as `legacy-local-view`.
Cannot-write is explicit guidance, **not an OS sandbox**; all tools run with the
user's ordinary access.

## Durable per-source capture and automation

Required spawn registers a random source ID and durable descriptor outside the
source. The home contains only a pointer. The descriptor freezes bindings,
owned destination paths/owners, source role and allowlisted provenance; it does
not copy instance metadata wholesale, credentials or launch environments.

Every capture includes **notes AND record**. Notes are retained by content hash;
changed live versions remain untouched. Record capture uses the authored absolute
`OATS_CLI_BIN`, native `capture --home`, then `recall --ids-only` byte metadata
to plan bounded text windows before fetching them (within the 16 MiB transport
limit) while the source exists. Full returned record text is copied into durable windows, not
commands needing a live home. Final capture drains the entire visible backlog
across windows before certifying custody. Capture has an 85-second budget;
timeouts, holds, skips, malformed/incomplete records and uncertified capture
retain the source home for retry. A single turn over 1 MiB fails closed rather
than truncating. A genuinely empty source record is reported honestly. Record
privacy exclusions remain excluded; no raw excluded session files are copied.

State layout (private, local, **no automatic evidence deletion**):

```text
<stateDir>/owners.json
<stateDir>/sources/<uuid>/source.json       # stable frozen descriptor
<stateDir>/sources/<uuid>/status.json       # captured / processed / delivered / accepted
<stateDir>/sources/<uuid>/inputs/<hash>.json # immutable notes and full record windows
<stateDir>/sources/<uuid>/runs/<uuid>/       # plans, proposals, judgment and receipts
<stateDir>/sources/<uuid>/runs/<uuid>/receipt-history/<alias>/<hash>.json
                                            # immutable receipt observations
<stateDir>/sources/<uuid>/runs/<uuid>/previous.json # frozen predecessor on recovery
<stateDir>/sources/<uuid>/recovery-observations/<hash>.json
                                            # first verified PR identity per publication
<stateDir>/cache/<base-id>.git               # host-wide consult cache (bare partial clone)
<stateDir>/migrations/<uuid>/               # explicit migration preservation
```

No scheduler job (since 4.2.0): the working agent's checkpoints
(`oats okf harvest`) and the retire hook capture, and each requests a finite
drain (see 4.2.0). Commands clear invoking-instance identity. Retire only
captures, records the drain and starts or hands it on; it never waits for a
model or GitHub. Unexpected source disappearance still permits processing
already-enqueued evidence, but reports `finalCaptureUncertified` instead of
pretending the unseen last input was captured.

```sh
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
oats okf harvest-status --soul domain-expert --json          # what each source still owes, with commands
oats okf run-source --source /absolute/state/sources/UUID/source.json --manual --soul domain-expert --json
```

Inspect reports frozen bindings (`owns`, `reads`, `bases`), the registered
`acceptedView` (not a fresh read of today's accepted branch), durable capture /
processing / delivery / acceptance receipts. `status.lastCapture` describes the last
capture attempt, not current source availability.

The additive `authority` summary reports `registration` as `captured`, `legacy`,
or `invalid`; captured records include only their exact qualified source identity
and execution binding. Responsible-human state is `disabled`, `specified`, or
`unknown`—the summary never exposes the human reference itself. Legacy/invalid
records report unknown capture/migration status and never synthesize identity
from aliases, paths or current configuration. Full provider bindings,
provenance, credentials, launch environment and transient snapshot paths are not
inspection output.

For a **live matching source only**, inspect also restores the v1 labeled
Markdown `documents`: `Working state (STATE.md)`, `Log (log.md)`, and sorted
`Pending note: <relative-name>` entries under `notes/` (including nested notes).
The `Durable processing receipts` text document follows them. Missing documents
are omitted; non-Markdown files are not displayed. `liveMemory` reports
`available`, `reason`, and the observation time `observedAt`. Retired, missing,
reused, or unverified homes return **only durable documents**, with an explicit
unavailability reason; they do not erase the durable source's bindings or
receipts. Use `--source` after disappearance/retirement; the home pointer cannot
identify a deleted source.

Inspection checks the durable source's home pointer ID/path and any instance
metadata, rejects symbolic/hard-linked or non-regular Markdown, never follows
symlinked notes directories, and rechecks home identity/retirement after reading.
An unsafe live document returns an `E_PATH` error; other document I/O failures
return `E_INSPECT_FAILED`, with no partial success payload. An unreadable or
unsafe **home identity** is instead reported as `liveMemory.reason: unverified-home`
with its diagnostic while durable receipts remain available. This is a
best-effort live observation, not a locked multi-file snapshot or OS sandbox.

The v1 **256 KiB per-document preview cap** remains explicit: a longer document
carries `truncated: true` and its original `bytes` count; an incomplete trailing
UTF-8 character is omitted. Documents below the cap arrive byte-exact, and the
**entire JSON envelope drains through stdout** (including large receipts).
Inspection is read-only: it does not capture, refresh, schedule work, or launch
a worker. Ordinary commands return the JSON-v1 success/error envelope, with
nonzero exit on failure; native lifecycle hooks retain their hook result shape.

Service agents never register/capture themselves. A source that never launched
a model session cannot cause a harvester launch at retirement. An operator can
request a scaffold-only worker explicitly (it requests no drain):

```sh
# From a source home:
oats okf harvest --no-launch --json
# From the durable deployment context, including after source retirement:
oats okf run-source --source /absolute/state/sources/UUID/source.json --manual --no-launch --soul domain-expert --json
```

## Independent worker and completion

Legacy-source workers spawn through the CLI with `--work directory --no-launch`.
Captured-source worker creation remains refused pending the qualified retained
helper API; no model or scaffold may use legacy helper lookup for captured work.
For the existing legacy worker path:
source work modes and branches never determine custody. Each worker stages
under its OWN `./work/bases/<alias>/` (Git roots may be nested beneath that
checkout), separate from `input.json`, `staging.json` and `judgment.json`. Only
after staging and durable receipts are saved does
the normal automatic path call `session start`. Source lineage is child-of-source
while active, unrelated after retirement; no retired live parent is required.
`harvest-runtime` (pi/claude/codex) and optional `harvest-model` are independent of
the source. A `--no-launch` request stops at ready; it does not start a model.

The complete skill begins with the accept list, reject list and two-part test:
would a future instance act differently, AND could it not discover this by reading
the repository? Rationale, accepted decisions, rejected alternatives, discovered
limits and owned/freshness-marked slow state qualify; code descriptions, residue,
secrets and third-party verbatim content do not. Human-accepted decisions preserve
the explicit who/when acceptance rather than being re-judged. These are OKF's
choices, not compulsory kernel policy.

Worker native file tools read `work/input.json` and `work/staging.json`, edit only
owned staged nodes and allowed base navigation, and write `work/judgment.json`.
The skill defines the receipt. Each input gets promote/merge/drop plus rationale
and actual concept paths; concepts cite the durable input hash (and record turn
IDs). Optional explicit `removals: [{base,path,reason}]` records deleted files;
unexplained deletions are refused. Do not edit source notes or soul skills.

The generated completion command safely quotes executable and all paths and
clears inherited home identity, deployment/resolution and snapshot pointers before
source-targeted dispatch. Captured completion argv carries the source's saved
--deployment/--resolution and omits --soul; legacy descriptors keep their literal
--soul route. Public-provider completion tests execute that generated command
through a selector-checking fixture dispatcher, not a qualified kernel helper
launch. It validates touched scope,
base navigation/history, every staged base, accepted baseline, concept provenance,
explicit judgment and common credential-shaped outputs. Classification and the
broader secret/verbatim exclusion still require the worker's judgment: pattern
checks are not a comprehensive data-loss-prevention claim.

```sh
oats okf complete --source /absolute/state/sources/UUID/source.json --run RUN_UUID --judgment /absolute/worker/work/judgment.json --soul domain-expert --json
```

**Judgment first, delivery in the background.**

`complete` works in two stages.

1. It runs only local checks: the judgment, every staged base and the
   provenance. It then persists the judgment and its proposals in one
   `run.json` write, before any network call. From then on the run never
   judges again: a rerun of `complete` (with or without `--judgment`) resumes
   from what was persisted.
2. Delivery runs in a detached worker (`lib/delivery-worker.mjs`, in its own
   session). It holds the source's `worker.lock` and logs to `delivery.log`
   in the run directory. Its progress is recorded in `run.json` `delivery`:
   - `state`: `starting`, `running`, `done` or `failed`;
   - `pid`, `host` and `step` (`<alias>: <receipt status>`, checkpointed after
     each idempotent step);
   - `error`.

`complete` waits up to 30 s for the worker.
- If delivery ends in time, it answers with the final receipt.
- Otherwise it answers with `status: delivering`, the `delivery` record and the
  next step. `oats okf-harvest harvest-status` reports the same.

A run has at most one delivery worker. A second `complete` that finds a live
one reports its progress and starts nothing.

If a worker dies, a rerun of `complete` starts a new one. That worker resumes
from the last checkpoint. A pushed commit or a created PR is found again, never
pushed or created twice.

Captured completions (a kernel-supplied `OATS_BINDING_FILE`) still deliver
inline: their private binding file need not outlive the call. They can
therefore still exceed an agent's tool-call limit.

**Baselines.** The baseline check runs when delivery starts, before any
destination changes. A Git base passes when its knowledge root still holds the
judged bytes:
- The root's tree at the new accepted head is compared with the judged one.
- If the trees differ, the root is staged at the new head and compared by
  digest. So a mode-only change is no baseline change.

What happens when the head moved outside the root:
- A read-only (no-change) base is accepted, and its receipt records
  `confirmedHead`.
- A written base is committed onto the new head (`receipt.parent`).
- A commit made before the head moved again is delivered as it is: the PR still
  merges cleanly, and nothing is ever force-pushed.

Changed root bytes fail with `E_BASELINE`. The judgment stays persisted, and
recovery is `oats okf retry --rejudge`.

Receipts are created only once every base is confirmed. Recovery therefore never
takes an unconfirmed no-change for a settled destination.

Actual delivery receipts, not instructions or a file saying "done", advance
processing. All-drop/no-change is successful processed input without a fake PR.

- **Git:** real deterministic commit, push, native `gh` PR creation/verification.
  Publication uses a private index rebuilt from the frozen baseline and stages
  only the actual validated content delta, with literal path matching. Harvest
  validation rejects tracked executable-bit changes even if `core.fileMode` or
  worker index flags hide them. Publication preserves every existing file's
  frozen Git mode (new files are `100644`), including after recovery/migration
  materialization; late or staged-only worker mode changes cannot enter a PR.
  It verifies the complete repository diff, permits no paths outside the content
  delta, and matches every knowledge blob and mode to the validated proposal and
  baseline. These checks also run on persisted commits before retrying a push.
  All Git invocations (including clone, recovery and transport) disable
  replacement-object interpretation; local `refs/replace/*` cannot substitute a
  frozen baseline, tree, blob or publication commit. Raw commit objects must have
  exactly their recorded accepted parent (the frozen baseline, or the head it
  moved to outside the root) as their sole parent. Both the frozen knowledge
  snapshot and the publication tree are checked against their immutable objects,
  including on retry. Ignores or content transformations that omit/change validated bytes
  fail before push. The worker's index is preserved; staged outside-base edits
  are rejected even if working bytes match baseline. Every effective fetch/push
  URL (including ambient config, URL rewrites and multiple push URLs) must match
  the frozen repository before publication; no redirected transfer is attempted.
  Status distinguishes commit-intent/committed, push-intent/push-unknown/pushed,
  pr-intent/pr-unknown, delivered, rejected and merge-visible accepted. No force
  push or direct fallback. Changed root bytes require new judgment, never
  automatic rebasing of model output. Same-repository PR head/base/commit must match.
  The publication index is written with `write-tree --missing-ok`, so a
  blob:none stage never fetches the blobs outside the root. The tree check
  still proves the root's content, and that every entry outside it is the
  accepted tree's (by object id).
- **Directory:** durable proposal, cooperative base lock, baseline comparison,
  publication journal, file-by-file atomic replacement and final full validation
  plus digest confirmation. Atomic-write scratch lives in the owned sibling
  lock directory, never in accepted knowledge. Explicit dead-owner unlock also
  removes that scratch, including partial writes, so retry can replay the durable
  proposal. The base and scratch must share a filesystem for atomic rename.
  Journal-installation scratch also lives in that lock. A durable
  `publication-intent` receipt precedes journal installation; a durable
  `publishing` receipt follows installation and precedes any accepted write.
  The journal is removed only after the accepted receipt is durable. Recovery
  skips file writes already confirmed in the journalled proposal; an accepted
  receipt with a remaining journal needs validation and cleanup, not replay.
  Pending/partial publication blocks provider reads.
  This is single-host cooperative recovery, **not a distributed transaction**.
  Multiple destinations can be partially delivered and retain separate receipts.

Retry never silently discards an uncertain publication:

```sh
oats okf retry --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
# Ready scaffold-only worker: explicit launch (operator action, NOT a test).
oats okf retry --source /absolute/state/sources/UUID/source.json --launch --soul domain-expert --json
# Before publication, or after verifying no open/merged PR, preserve old work:
oats okf retry --source /absolute/state/sources/UUID/source.json --rejudge --soul domain-expert --json
# Historical delivered PR later closed unmerged (even after both homes retire):
oats okf complete --source /absolute/state/sources/UUID/source.json --run OLD --soul domain-expert --json
oats okf retry --source /absolute/state/sources/UUID/source.json --run OLD --rejudge --soul domain-expert --json
# Uncertain spawn: inspect first, then adopt ONLY its exact deterministic home.
oats okf retry --source /absolute/state/sources/UUID/source.json --adopt-home /absolute/expected-worker-home --soul domain-expert --json
```

If `--rejudge` returns `abandoned` (nothing delivered yet), request
`run-source --manual` (add `--no-launch` for a scaffold). The pending replacement
keeps the original bounded input set and links the old run to its successor;
prior publication identities stay guarded, including through partial rejudgments.
A PR first discovered after uncertain creation is saved immediately in a separate
recovery observation keyed by frozen base/repository/branch/commit. This also
happens during ancestor checks and before later recovery gates can fail; historical
receipts are never rewritten to pretend delivery was confirmed. Once known,
queries use the recorded PR number in its repository (`gh pr view`), not a list
filtered by the original base. Disappearance, changed URL/head/base, or reopening
or merging a superseded PR blocks further publication, even after home deletion.
An abandoned run without a tracked successor cannot be explicitly recovered with
`--run`; use its pending-input flow instead. If some destinations
are already confirmed, it instead returns `ready` on the same run and existing
worker: re-read `work/staging.json` and judge ONLY its outstanding destinations.
They have fresh stages under `work/rejudgments/<attempt>/bases/`; settled entries
have no writable root. Prior stages, judgments, proposals and receipts remain
preserved, and a new Git attempt gets a distinct publication branch. Complete
still requires one outcome per original input; reasons and concept lists now
cover only outstanding destinations. Previously accepted/delivered/no-change
receipts are retained, not redelivered. Inputs remain unprocessed until every
required destination resolves. A further CAS conflict can be rejudged again.
Use ordinary `retry --launch` only for an explicitly requested ready-worker launch.
After uncertain session start, inspect with `oats session inspect --home ...`;
the package does not automatically retry an unknown model launch. A partial stage
can be abandoned before publication and a new worker requested. Old bytes remain. Git rejudgment checks native PR absence/closed-unmerged state
and retains old remote branches; unknown GitHub reads block it. A directory
journal still pending must recover, not rejudge. Under the cooperative base lock,
an absent journal with only `publication-intent` proves no accepted write was
authorized: retry reconciles that receipt to `validated`. It can retry the same
proposal on an unchanged baseline, or explicitly rejudge a changed baseline,
including after another destination was accepted. This does not discard evidence
or redeliver settled destinations. A `publishing` receipt with a missing journal
is instead uncertain custody: neither retry nor rejudgment proceeds; restore the
journal after operator inspection, never delete it to bypass recovery. These
proofs assume all writers obey the lock/journal protocol, not arbitrary deletion
of coordination state. Frozen ownership checks still apply.
Once a PR merges, repeat **complete with the same source/run**, without judgment,
to reconcile merge-visible acceptance. A merged PR is settled by its merge, before
any baseline check: the receipt becomes `accepted`, with the `mergeCommit`.

The maintainer may amend the PR branch before merging it (the knowledge-review
skill's `amend+merge`). Its head is then not the delivered commit. While the
PR is open, `complete` reports it `delivered` as long as the branch's tip
descends from the delivered commit, by Git ancestry. The receipt's `pr`
then shows the amended head, and the answer's `next` line names it. Nothing
is pushed. A branch rewritten without the delivered commit is refused with
`E_PR`, and is never force-pushed. Once merged, acceptance requires an `okf-review` verdict comment that:
- comes from a repository member, collaborator or owner, or from the account
  that merged the PR;
- has verdict `merge` or `amend+merge`;
- names the merged head as its `headSha`.

A maintainer running on a GitHub App installation token has no member
association, but its verdict counts when the same account merged the PR.

The receipt also records `mergedHead` and `verdict`. A merged PR without such a
verdict fails with `E_PR`, naming the remedy (record the verdict, then complete
again). Merged inputs are never rejudged. Durable proposals can reconstruct a real
Git delivery checkout if the old worker disappeared. No source home is required.

### Closed-after-delivery recovery

Delivery marks captured inputs processed and releases the active worker slot;
it is **not** acceptance. A later `complete --run OLD` reports a closed-unmerged
PR as rejected. Ordinary retry, checkpoints and drains do **not** unprocess or
resubmit those inputs. After operator review, `retry --run OLD --rejudge` selects
that retained run explicitly (the selector requires `--rejudge`). It also checks
current PR state when the operator has not separately reconciled closure.

The command creates one fresh scaffold-only worker/run, with a new publication
identity, original bounded evidence, frozen predecessor in `work/previous.json`,
and fresh accepted stages for **unresolved destinations only**. It does not copy
rejected edits into the stages. The worker must judge afresh, possibly dropping
all remaining claims. Neither the original source nor worker home is needed.
Use the returned **new run ID** for completion, never the superseded one. Add
`--launch` only for an explicitly requested model launch; a repeated request
returns the existing successor without another launch or spawn.

Accepted/no-change destinations and still-open delivered PRs retain their
receipts and have no writable staging root. Unknown, missing or mismatched
known PR identities block recovery. Another active run blocks historical recovery
without changing either run. An atomic capability-owned status update records
`recoveries[old] = new` together with the active slot before any spawn. Repeated
requests cannot create another successor, even after it finishes. If a later
attempt is itself rejected, select that latest run for another explicit review.
Abandoned completion is refused even before its successor is created; stale
workers cannot resume an abandoned publication. Superseded completion is refused. Existing uncertain-spawn adoption and explicit
lock recovery apply to the new run too; never edit status to force a retry.

Old proposals and predecessor snapshots are not overwritten. Receipt transitions
are retained as content-addressed observations under `receipt-history/`; `run.json`
and `status.json` remain current projections, not immutable logs. Historic
processed-input IDs remain processed; the new active run tracks the explicit
rejudgment independently and resolves only its outstanding destinations.
Ancestor PR guards survive every replacement and are rechecked before fresh Git
commit/push/PR creation. These observations cannot atomically lock GitHub against
concurrent external reopen/merge actions; stop and reconcile on any detected
change rather than overriding it. No direct-write or force-push fallback exists.

A source's `worker.lock` is reclaimed automatically when its owner is a process
on this host that is gone. A lock with no readable owner is reclaimed only once
it is 30 s old. Reclaimers are serialized by a `worker.lock.reclaim` guard. A
live holder is never stolen from, and every wait is bounded. Every holder's work
resumes from what it persisted.

Base locks never expire automatically. An unreadable owner needs manual forensic
recovery. A known dead **local** holder is named in the `E_LOCKED` error, with
the command that releases it:

```sh
oats okf unlock --lock /absolute/path/to/lock --token TOKEN_FROM_OWNER_JSON --soul domain-expert --json
```

This refuses living holders and foreign hosts. Never blindly remove a publication
journal or reclaim by age. Retry the journal's recorded source/run after resolving
the lock; unexpected bytes remain an explicit conflict, not an overwrite.

## Explicit v1 migration

Legacy `soul/knowledge/` makes spawn fail with a migration diagnostic, never an
empty replacement. First provision empty external owned nodes and configure v2.
Then stage an explicit preservation/migration:

```sh
oats okf migrate --legacy /absolute/soul/knowledge --base project --node expert --output /absolute/empty-migration-stage --soul domain-expert --json
# Use the exact migration.json path returned above:
oats okf migrate --deliver /absolute/state/migrations/UUID/migration.json --soul domain-expert --json
# Git: review/merge PR, rerun --deliver to confirm merge-visible acceptance.
oats okf migrate --cutover /absolute/state/migrations/UUID/migration.json --soul-dir /absolute/soul --soul domain-expert --json
```

Migration staging must be disjoint from EVERY configured accepted base and
directory coordination artifact, not only the selected destination. Rejected
overlap creates no staging files or preservation state and changes no accepted
bytes. Migration preserves the full original, rewrites bundle-root Markdown links into
the node namespace, validates the full base and delivers via the real provider.
It refuses a nonempty destination node rather than silently merging ambiguous
knowledge. Cutover requires accepted delivery, unchanged original bytes, and
current bindings still mapping the alias to the frozen delivered base. It verifies
accepted readiness, node ownership/path and delivered node content before it
renames the original into durable custody, updates `soul/okf.json`, and never
changes skills. Cross-device rename fails safely; arrange explicit operator
cutover rather than deleting originals. A cutover-intent marker blocks new sources
until the recorded cutover is retried. Update old soul instruction references
explicitly; no permanent knowledge symlink remains inside the soul.

For existing source homes with v1 watermark files, also preserve them explicitly:

```sh
oats okf migrate --source-home /absolute/legacy-instance-home --soul domain-expert --json
```

This copies allowlisted state/log/notes and old cursor files into migration
custody, deleting nothing. After soul migration, `harvest` re-registers the source
and captures visible notes/record. Old v1 watermarks are preserved, **not trusted
as v2 processing proof**; replay can yield merge/drop judgments instead of loss.

## Tests and release gates

```sh
npm test
# Full suite plus the optional probes against an actual >=0.24.4 CLI (the real
# home-dispatch probes need >=0.43.0 and skip, saying so, on an older one):
OATS_OKF_CONSUMER_CLI=/absolute/oats/bin/oats.mjs npm test
# Native capture/recall transport (60 x 350kB):
OATS_OKF_NATIVE_CLI=/absolute/oats/bin/oats.mjs node --test --test-name-pattern='R1 actual native' test/oats-okf.test.mjs
# okf 4.2.0: a real home's checkpoint and retire hook follow the deployment's switch,
# not its spawn-time settings (a disposable file:// v2 workspace; no model):
OATS_OKF_NATIVE_CLI=/absolute/oats/bin/oats.mjs node --test test/real-home-dispatch.test.mjs
# okf 4.2.0 (#55): an external --repo source on released OATS 0.41.0 (CI's external-repo-041 job):
OATS_OKF_EXTERNAL_CLI=/absolute/oats-0.41.0/bin/oats.mjs node --test test/external-repo-consumer.test.mjs
# Full standalone suite with both public-boundary probes (source OATS >=0.24.4):
OATS_OKF_CONSUMER_CLI=/absolute/oats/bin/oats.mjs OATS_OKF_NATIVE_CLI=/absolute/oats/bin/oats.mjs npm test
```

The suite uses real temporary repositories and deterministic fake `gh`; directory
fixtures lack Git/gh. Tests cover command dispatch, strict manifest mutation,
final source deletion, full record backlog, rewritten notes/replay, frozen
bindings/ownership, contention, partial publication and receipt-write crashes,
PR failure/unknown, merge visibility, migration preservation, exclusions and
actual complete receipts. Inspection tests cover large state/log/notes through
both declared dispatch and the public `knowledge:inspect` runner, explicit
preview truncation, disappeared/reused/unsafe homes, file-safety errors, identity
changes during reads, and durable external-view placement. The opt-in public
consumer probe uses isolated HOME, config, schedules and inert runtime
executables, checks source-targeted access after retirement and fresh reader
scaffolding, and installs **no host timer**.
Default CI skips the optional probes explicitly. A manual CI run can supply
an exact published `consumer_version` to install that public kernel in a disposable
prefix and run them; it does not acquire/lock/trust the OKF distribution. See
[SCHEMA-STATUS.md](SCHEMA-STATUS.md) for schema coverage and evidence limits.

Scaffolded fresh reading is **not fresh real-model learning**. Release still
requires parent-controlled installed-artifact/trust probes, actual remote PR
probes and a selected-runtime fresh agent demonstrating learned expertise without
the source. This repository's tests do not publish real PRs or start model sessions.
