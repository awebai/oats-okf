# oats.okf 2 — external knowledge, independent judgment

The official OKF knowledge capability for **OATS >=0.23.0**. This is a breaking
runtime change from soul-contained v1 knowledge. All knowledge lives in external
bases. Skills remain curated soul artifacts; v2 never automatically edits them.
Procedure candidates may become external Playbook concepts.

**Release payload:** `oats-package/capabilities/oats-okf/`, enumerated by
`oats-package/oats-package.json`. The obsolete unenumerated root `oats.json`,
`bin/`, `agents/`, `skills/` and `injects/` copies have been removed; they are not
an alternative runtime. The distribution retains its manifest and LICENSE, and
the capability is self-contained, including both runtime skills, worker soul,
injections, validator and schemas. This remains the **2.0.0 pre-tag candidate**,
not a published patch release.

## Configuration and ownership

Install/trust this package and activate `oats.okf` using the OATS package and
configuration skills. Activation may target sources, not necessarily the service
worker. Runtime needs one effective setting:

```sh
oats use oats.okf --soul domain-expert --settings bindings-file=/absolute/config/okf-bindings.json
```

The **absolute** bindings document is capability-owned JSON:

```json
{
  "version": 1,
  "stateDir": "../durable-okf-state",
  "cron": "*/15 * * * *",
  "tz": "UTC",
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

Stable owner IDs must not ambiguously identify different souls in one state
namespace. Nodes are nonoverlapping subdirectories with an index, owned by one
stable ID. `owns` routes responsibility; `reads` selects initial context. Neither
is an ACL. Every configured base is discoverable and readable. Missing explicit
configuration, base metadata, ownership, or indexes fails required spawn safely;
reads never silently bootstrap empty knowledge.

JSON Schemas are in `schemas/` in the capability and repository. Runtime also
checks filesystem containment, identities, overlap, base metadata and complete
OKF conformance; schema validation alone cannot establish these properties.

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

Spawn creates an **immutable accepted snapshot** at `./knowledge/`; `view.json`
records each base's relative `path` (`bases/<alias>`), digest and Git accepted
head. Base content lives only under `./knowledge/bases/<alias>/`, separate from
the control receipt; aliases such as `view.json` remain valid. Root links such as
`/steward/decision.md` resolve from that base's snapshot, not filesystem `/`.
Fresh provider reads coordinate with publication:

```sh
oats okf read --base project --path expert/index.md --json
oats okf refresh --json    # returns a NEW immutable view path; old views remain
# From deployment context, including after source retirement:
oats okf read --source /absolute/state/sources/UUID/source.json --base project --path expert/index.md --soul domain-expert --json
oats okf refresh --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
```

Home-selected reads/refreshes create `./knowledge-view-<uuid>/` in that home.
**Every `--source` read/refresh creates its new view under
`<stateDir>/sources/<source-id>/views/knowledge-view-<uuid>/`**, even if the source
is still live. It never writes a cache into the invoking context/repository,
a replacement home, or a retired/missing home. `path` and base receipts identify
the actual materialized view. Choose either `--home` or `--source`, not both.

Directory readers hold the same cooperative lock as publication while copying
accepted bytes. A pending journal blocks fresh views rather than exposing a
half-update. A view is published only after all bases and node references validate;
failed builds remove only their private staging directory and can be retried at
the same destination. Registration prepares its view before saving the durable
source pointer, then publishes it; retries after that pointer resume the same
source and snapshot without resetting evidence. Pre-existing unregistered views
are preserved and reported, not deleted. Existing views remain valid older snapshots. Git readers clone the
configured accepted branch; an open PR is not accepted knowledge. Views have no
automatic garbage collection. Cannot-write is explicit guidance, **not an OS
sandbox**; all tools run with the user's ordinary access.

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
<stateDir>/sources/<uuid>/views/             # descriptor-selected read/refresh caches
<stateDir>/migrations/<uuid>/               # explicit migration preservation
```

One scheduler **command job per source**, not a fleet sweep. Every registration,
including `harvest` after source migration, idempotently creates/verifies the job;
setup failures are reported and retained for retry. Existing disabled jobs are
not implicitly re-enabled. Its stable cwd is
the deployment context; argv includes the durable descriptor and `--soul` source
selector so dispatch remains activation/trust-gated after source retirement.
Commands clear invoking-instance identity. Source retirement does not remove the
job synchronously under the scheduler's host lock. Retire only captures/enqueues;
it never waits for a model or GitHub. An idle retired source job returns empty.
Unexpected source disappearance still permits processing already-enqueued
evidence, but reports `finalCaptureUncertified` instead of pretending the unseen
last input was captured. Disable drained jobs explicitly if desired. No timer is installed automatically.

```sh
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
oats okf setup --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
# Explicit OPERATOR consent to install the host timer (not done by tests):
oats okf setup --source /absolute/state/sources/UUID/source.json --install-host --soul domain-expert --json
# Safe definition edit, never removes/reconciles an executing job:
oats okf setup --source /absolute/state/sources/UUID/source.json --disable --soul domain-expert --json
```

Inspect reports frozen bindings (`owns`, `reads`, `bases`), the registered
`acceptedView` (not a fresh read of today's accepted branch), durable capture /
processing / delivery / acceptance receipts, and scheduler health. An absent or
inactive timer is not claimed active; scheduler lookup failures are diagnostic,
not a reason to hide durable receipts. `status.lastCapture` describes the last
capture attempt, not current source availability.

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

Service agents never register/capture themselves. No-launch sources cannot cause
scheduled model launches; a final no-launch source is auto-disabled. An operator
can request a scaffold-only worker explicitly:

```sh
# From a source home:
oats okf harvest --no-launch --json
# From the durable deployment context, including after source retirement:
oats okf run-source --source /absolute/state/sources/UUID/source.json --manual --no-launch --soul domain-expert --json
```

## Independent worker and completion

Workers spawn through the supported CLI with `--work directory --no-launch`:
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
clears home identity before source-targeted dispatch. It validates touched scope,
base navigation/history, every staged base, accepted baseline, concept provenance,
explicit judgment and common credential-shaped outputs. Classification and the
broader secret/verbatim exclusion still require the worker's judgment: pattern
checks are not a comprehensive data-loss-prevention claim.

```sh
oats okf complete --source /absolute/state/sources/UUID/source.json --run RUN_UUID --judgment /absolute/worker/work/judgment.json --soul domain-expert --json
```

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
  exactly the frozen baseline as their sole parent. Both the frozen knowledge
  snapshot and the publication tree are checked against their immutable objects,
  including on retry. Ignores or content transformations that omit/change validated bytes
  fail before push. The worker's index is preserved; staged outside-base edits
  are rejected even if working bytes match baseline. Every effective fetch/push
  URL (including ambient config, URL rewrites and multiple push URLs) must match
  the frozen repository before publication; no redirected transfer is attempted.
  Status distinguishes commit-intent/committed, push-intent/push-unknown/pushed,
  pr-intent/pr-unknown, delivered, rejected and merge-visible accepted. No force
  push or direct fallback. A baseline change requires new judgment, not automatic
  rebasing of model output. Same-repository PR head/base/commit must match.
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
# Uncertain spawn: inspect first, then adopt ONLY its exact deterministic home.
oats okf retry --source /absolute/state/sources/UUID/source.json --adopt-home /absolute/expected-worker-home --soul domain-expert --json
```

If `--rejudge` returns `abandoned` (nothing delivered yet), request
`run-source --manual` (add `--no-launch` for a scaffold). If some destinations
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
to reconcile merge-visible acceptance. Durable proposals can reconstruct a real
Git delivery checkout if the old worker disappeared. No source home is required.

Base locks never expire automatically. An unreadable owner needs manual forensic
recovery; a known dead **local** holder can be released explicitly:

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
# Full suite plus all three optional probes against an actual >=0.23.0 CLI:
OATS_OKF_CONSUMER_CLI=/absolute/oats/bin/oats.mjs npm test
# Native capture/recall transport (60 x 350kB), plus idempotent scheduler probe:
OATS_OKF_NATIVE_CLI=/absolute/oats/bin/oats.mjs node --test --test-name-pattern='R1 actual native' test/oats-okf.test.mjs
# Full standalone suite with both public-boundary probes (source OATS >=0.23.0):
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
Default CI skips the three optional probes explicitly. A manual CI run can supply
an exact published `consumer_version` to install that public kernel in a disposable
prefix and run them; it does not acquire/lock/trust the OKF distribution. See
[SCHEMA-STATUS.md](SCHEMA-STATUS.md) for schema coverage and evidence limits.

Scaffolded fresh reading is **not fresh real-model learning**. Release still
requires parent-controlled installed-artifact/trust probes, actual remote PR
probes and a selected-runtime fresh agent demonstrating learned expertise without
the source. This repository's tests do not publish real PRs or start model sessions.
