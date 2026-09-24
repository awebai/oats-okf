# oats.okf 2 — external knowledge, independent judgment

The official OKF knowledge capability: **2.1.5**, requiring **OATS >=0.24.4**.
This is an additive release in the v2 family; wire, payload and record protocol
versions are unchanged. The v2 runtime is a breaking change from soul-contained
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

Install/trust this package and activate `oats.okf` using the OATS package and
configuration skills. Activation may target sources, not necessarily the service
worker. The legacy live-source runtime needs one effective setting:

```sh
oats use oats.okf --soul domain-expert --settings bindings-file=/absolute/config/okf-bindings.json
```

Portable provider-binding preparation additionally requires an explicit
`state-dir` setting alongside `bindings-file`. Both are captured as host-owned
absolute locations; the codec does not derive state from an instance home or
reread the bindings file during normalize/bind.

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
invariant, not a per-soul optimization, because `oats okf read --base <alias>`
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

New captured persistent sources receive a schedule with
`definitionVersion: 2`, `recurrencePolicy: "capture"`, explicit saved
`--deployment`/`--resolution` selectors and `--json`. It omits legacy `--soul`
selection. Read, refresh, inspect and existing-run completion use the exact frozen
descriptor after source/config deletion. **First-cut captured worker creation is
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
<stateDir>/sources/<uuid>/runs/<uuid>/receipt-history/<alias>/<hash>.json
                                            # immutable receipt observations
<stateDir>/sources/<uuid>/runs/<uuid>/previous.json # frozen predecessor on recovery
<stateDir>/sources/<uuid>/recovery-observations/<hash>.json
                                            # first verified PR identity per publication
<stateDir>/sources/<uuid>/views/             # descriptor-selected read/refresh caches
<stateDir>/migrations/<uuid>/               # explicit migration preservation
```

One scheduler **command job per source**, not a fleet sweep. Every registration,
including `harvest` after source migration, idempotently creates/verifies the job;
setup failures are reported and retained for retry. Existing disabled jobs are
not implicitly re-enabled. Its stable cwd is
the deployment context; argv includes the durable descriptor and `--soul` source
selector so dispatch remains activation/trust-gated after source retirement.
Commands clear invoking-instance identity. Retire only captures/enqueues; it
never waits for a model or GitHub. Once a retired source is drained (every
captured input processed) its `okf-<id>` job is switched off and then removed
from the kernel scheduler, so `oats schedule list` does not accumulate dead
rows; the job definition is kept as evidence in the source's own
`schedule.json`. A source with pending input keeps its job enabled until the
worker drains it, which then settles the job the same way; a job that is still
running at that moment stays disabled and is removed on the next settle.
Unexpected source disappearance still permits processing already-enqueued
evidence, but reports `finalCaptureUncertified` instead of pretending the unseen
last input was captured. No timer is installed automatically.

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
to reconcile merge-visible acceptance. Durable proposals can reconstruct a real
Git delivery checkout if the old worker disappeared. No source home is required.

### Closed-after-delivery recovery

Delivery marks captured inputs processed and releases the active worker slot;
it is **not** acceptance. A later `complete --run OLD` reports a closed-unmerged
PR as rejected. Ordinary retry/scheduled processing does **not** unprocess or
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
# Full suite plus all three optional probes against an actual >=0.24.4 CLI:
OATS_OKF_CONSUMER_CLI=/absolute/oats/bin/oats.mjs npm test
# Native capture/recall transport (60 x 350kB), plus idempotent scheduler probe:
OATS_OKF_NATIVE_CLI=/absolute/oats/bin/oats.mjs node --test --test-name-pattern='R1 actual native' test/oats-okf.test.mjs
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
Default CI skips the three optional probes explicitly. A manual CI run can supply
an exact published `consumer_version` to install that public kernel in a disposable
prefix and run them; it does not acquire/lock/trust the OKF distribution. See
[SCHEMA-STATUS.md](SCHEMA-STATUS.md) for schema coverage and evidence limits.

Scaffolded fresh reading is **not fresh real-model learning**. Release still
requires parent-controlled installed-artifact/trust probes, actual remote PR
probes and a selected-runtime fresh agent demonstrating learned expertise without
the source. This repository's tests do not publish real PRs or start model sessions.
