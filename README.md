# oats.okf 5 — external knowledge, consulted remotely, proposed at checkpoints

The official OKF (Open Knowledge Format) knowledge package for OATS:
**5.0.0**, requiring **OATS >=0.29.0**. CI runs it against the released
OATS 0.44.0 kernel (see [Tests and CI](#tests-and-ci)).

A working soul's knowledge lives outside the soul, in OKF bases: Git
repositories (or plain directories) of Markdown concepts grouped in nodes,
each node owned by one soul. An instance reads that knowledge remotely, keeps
its own working notes in its home, and at important checkpoints proposes what
it learned. A knowledge harvester turns a proposal into a reviewed PR on the
base, and a knowledge maintainer reviews and merges it. Nothing writes
accepted knowledge except a merged PR (or an explicit operator change).

5.0 replaces the 4.x harvest machinery (source custody, capture of notes and
transcripts, runs, drains, the worker and delivery engine, the harvest
switch); see [Upgrading to 5.0](#upgrading-to-50). The history of earlier
versions is in [CHANGELOG.md](CHANGELOG.md).

## What the package contains

| Capability | For | Skills | Commands |
|---|---|---|---|
| `oats.okf` (knowledge slot) | every working soul with OKF knowledge | `okf-consultation`, `okf-instance-knowledge`, `knowledge-theory` | consult (`bases index cat ls links search`), `inspect`, `init`, `migrate`, `unlock`, `setup --remove-legacy-settings`; the spawn and soul-scaffold hooks |
| `oats.okf-harvest` | the harvester soul | `knowledge-harvest`, `knowledge-theory`, `okf-authoring` | none (its `complete` and `harvest-status` answer `E_REMOVED`) |
| `oats.okf-maintenance` | the maintainer soul | `knowledge-review`, `knowledge-theory`, `okf-authoring`, `okf-trigger-setup` | `okf-maintenance review-context`, `okf-maintenance notify-harvester` |

- Two package souls: `oats.okf/knowledge-harvester` and
  `oats.okf/knowledge-maintainer` (`work: directory`, `knowledge: none`, each
  with its own capability `from: here`).
- One trigger template: `oats.okf:harvest-review`
  (`triggers/harvest-review.json`).
- `knowledge-theory` (the promotion doctrine) ships as identical copies in all
  three capabilities, and `okf-authoring` in the harvest and maintenance
  capabilities.

The release payload is `oats-package/`, enumerated by
`oats-package/oats-package.json`. The OKF JSON Schemas ship in the
capability's `schemas/`, with copies in the repository's `schemas/`.

## Configuration

A workspace declares the package (`packages: { oats.okf: v5.0.0 }`) and
selects it as the knowledge capability (`defaults: { knowledge: { oats.okf:
{ from: package } } }`, or per soul). Each deployment points it at its
bindings file in its own `oats-local.yaml`:

```yaml
settings:
  oats.okf:
    bindings-file: /absolute/config/okf-bindings.json
```

### Settings

| Setting | Meaning |
|---|---|
| `bindings-file` | Absolute path of the bindings document (below). Required for everything except help and the soul-scaffold hook. |
| `state-dir` | Normalized absolute durable state directory recorded in a portable binding; required by the binding wire's normalize phase, never derived from an instance home. |
| `git-timeout` | Seconds for each Git operation that talks to a remote (clone, fetch, push, ls-remote); default 600. Local object reads keep a short fixed limit. |
| `consult-max-age` | Seconds a Git base's cached accepted commit may age before a consult read refetches; default 300, 0 refetches on every read. |

Any other key is refused (`E_CONFIG`).

**The soul's opt-out stays.** A soul author can write
`knowledge: { harvest: off }` in soul.yaml: its instances still consult and
keep instance knowledge, but are never told to propose, and the harvester
refuses to harvest them (its spawn hook checks the recorded soul in code). A
public soul is reachable from outside, and its notes must not be harvested.
5.0 removes the HOST harvest switch, not this author's safety opt-out. Absent
means the normal 5.0 proposal flow.

Every other 4.x harvest key is removed: a host or spawn `harvest` (even
`off`; a host value also masks the soul's opt-out), and `harvest-runtime` and
`harvest-model` in any layer. Wherever one is set, every
`oats okf` command and hook (except the cleanup below) refuses with
`E_REMOVED` before doing anything, in one sentence that names the layer that
set it, for example:

```text
settings.oats.okf.harvest from host (oats-local.yaml#/settings/oats.okf) was removed in oats.okf 5.0; agents now propose knowledge and spawn oats.okf/knowledge-harvester at checkpoints; run oats okf setup --remove-legacy-settings --soul <soul> --json from this deployment.
```

- A **host** value (`oats-local.yaml`) names the cleanup command.
- A **soul** `harvest` other than `off`, or a soul `harvest-runtime` or
  `harvest-model`, says to change it in the soul's reviewed source and
  sync/respawn; host cleanup cannot change a soul.
- A **spawn** value (`--provider oats.okf harvest=…`) says to drop it from
  the spawn command.
- `harvest-runtime` and `harvest-model` say the harvester now launches with
  the kernel's own harness and model selection.
- When the kernel does not say where the key came from
  (`OATS_SETTINGS_ORIGINS`), the sentence says "from an unknown origin" and
  lists where to look.

The binding check (readiness) answers the same sentence as a
`needs-configuration` problem.

### The bindings document

The absolute bindings document is capability-owned JSON:

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

- Paths inside it resolve from its own directory, not the working directory.
- **Git bases** support HTTPS, SSH and durable local repositories;
  `root: "."` is a dedicated knowledge repository. PRs are same-repository
  branches (`pr.repository` is the GitHub `owner/repo`). A repository URL
  carrying a credential (`user:token@`) is refused: use a credential helper
  or an SSH key. A local repository must be a canonical repository, not a
  linked worktree. Shallow repositories are refused (`E_BASE_SHALLOW`).
- **Directory bases** need no Git or `gh`. A directory inside any Git working
  tree is refused (`E_DIRECTORY_GIT`): relabelling tracked files must not
  bypass PR review. Directory bases can be consulted, initialized and
  validated, but 5.0 has no PR harvest for them (see
  [How knowledge is proposed](#how-knowledge-is-proposed)).
- Bases, `stateDir` and the bindings document must not overlap. A bound
  base's `id` must equal the `id` in that base's `okf-base.json`; the alias
  (`project` above) is yours to choose and is what souls name.
- `cron` or `tz` (4.1 schedules) is refused with
  `E_HARVEST_SCHEDULE_REMOVED` (see [Upgrading from 4.1](#upgrading-from-41)).

What oats.okf 5.0 keeps under `stateDir`:

```text
<stateDir>/cache/<base-id>.git     # host-wide consult cache (bare partial clone)
<stateDir>/migrations/<uuid>/      # explicit migration preservation
```

4.x left `owners.json` and `sources/` there; 5.0 neither reads nor deletes
them.

### The soul declaration and base metadata

Each knowledge-owning soul carries **`okf.json`** (not knowledge bytes):

```json
{"version":1,"owner":"domain-expert-stable-id","owns":["project/expert"],"reads":["project/steward","team/operations"]}
```

Each accepted base carries **`okf-base.json`**:

```json
{"version":1,"id":"project-knowledge","nodes":{"expert":{"path":"expert","owner":"domain-expert-stable-id"},"steward":{"path":"steward","owner":"steward-stable-id"}}}
```

- References are `alias/node`. Nodes are non-overlapping subdirectories, each
  with `index.md` and `log.md`, owned by one stable owner id. The base root
  has `index.md` and `log.md`; every other file is Markdown inside a node, and
  hidden paths are refused.
- `owns` names the nodes the soul's harvests may write; an owned node's
  `owner` in `okf-base.json` must equal the soul's `owner` (`E_OWNER`
  otherwise). `reads` selects initial context. Neither is an access control:
  every configured base is readable.
- A soul without `okf.json` cannot spawn with oats.okf: provision it
  (`init`, or `migrate` for a legacy soul) or deactivate oats.okf for that
  soul. The soul-scaffold hook creates no knowledge.

## Consultation

Instances read their soul's knowledge **remotely, at the accepted state**:
no knowledge is copied into an instance home. From the instance home:

```sh
oats okf index                                   # owned then read nodes' indexes
oats okf cat --base project /expert/decisions/retry-policy.md
oats okf links --base project /expert/decisions/retry-policy.md
oats okf cat --base project ../lessons/storm.md --from /expert/decisions/retry-policy.md
oats okf ls --base project /expert/lessons       # entries with frontmatter type/title/description
oats okf search backoff                          # [--base A | --all] [--node N] [--regex] [--case-sensitive]
oats okf bases                                   # accepted commit, freshness, validity, owns/reads
oats okf inspect --json                          # declaration, bases and this home's working memory
```

From the deployment, the same commands take `--soul <soul>` and read that
soul's declaration.

- Paths resolve like OKF links: `/node/x.md` from the base root, a relative
  path against `--from`'s directory, a bare `node/x.md` from the root. `..`
  escapes, filesystem paths, URLs, hidden paths, symlinks and submodules are
  refused.
- A Git base is read from one host-wide bare partial clone per base
  (`<stateDir>/cache/<base-id>.git`) at the fetched accepted branch; blobs
  arrive on first read. The branch is refetched when `consult-max-age` has
  passed or with `--fresh`. A failed fetch serves the cached commit with
  `stale: true` and the reason; with nothing cached the read fails with
  `E_BASE_UNAVAILABLE`.
- A directory base is read in place under its cooperative lock; a pending
  publication journal refuses reads with `E_RECOVERY`.
- Every answer carries a receipt (`base`, `kind`, `commit` or `digest`,
  `fetchedAt`, `stale`). Cite what you relied on as
  `alias/node/concept.md@<short-oid>`.
- An open PR is not accepted knowledge.
- `inspect` returns the declaration, the bound bases and the home's STATE.md,
  log.md and `notes/**/*.md` (each capped at 256 KiB, with `truncated` and
  the original `bytes`). A `./knowledge/` left by okf 2.x is reported as
  `legacy-local-view` and never read.

The `okf-consultation` skill teaches the consult CLI.

## Instance knowledge and the spawn hook

The `oats.okf` spawn hook is required. For a working instance it:

1. checks the soul's declared nodes against the accepted bases (Git bases are
   primed into the host cache within a bounded time, at most 64 of them; a
   base that cannot be primed is a warning naming `oats okf bases`, not a
   refusal);
2. creates the home's instance knowledge if missing: `STATE.md`, `log.md`
   and `notes/`;
3. answers a brief that names the consult commands, the owned and read
   nodes, and the exact spawn command for proposals (for a soul that opts
   out, the instruction never to propose).

A service (capability) instance gets a brief and no knowledge upkeep. A
failure answers `{warning: "oats-okf <CODE>: <message>"}` with exit 1, so the
kernel refuses the spawn. The hook never answers `meta`: the kernel keeps a
hook's meta as the receipt of external state, and a capability without a
retire hook that reported one is quarantined when a spawn rolls back. This
hook creates only the home's own files (removed with the home) and primes the
shared host cache, so there is nothing to undo and there is no retire hook.
The oats.okf-harvest spawn hook answers the same way: `{}` when the source
checks out, `{warning: "oats-okf-harvest <CODE>: ..."}` with exit 1 when it
refuses.

The inject teaches the work mode: consult soul and instance knowledge at task
start, after compaction and before decisions; update STATE.md (rewritten),
log.md (append-only) and notes/ (one concept per note) before compaction and
at checkpoints. The `okf-instance-knowledge` skill teaches what is worth
capturing and how to propose. Instances never write accepted knowledge.

## How knowledge is proposed

**At an important checkpoint** (a decision made, a PR opened or handed over,
a task finished) the working agent first updates STATE.md, log.md and its
notes. If it learned something that passes the promotion test
(`knowledge-theory`: it would change how a future instance of the soul
decides or acts, and it is not already in the code, the tracker, the docs or
the accepted knowledge), it writes **one short, self-contained proposal**, a
Markdown file in its home such as `proposals/2026-10-07-retry-budget.md`:

```markdown
# OKF proposal: <one-line claim>

Source: instance <instance name>, home <instance home>, soul <soul name>

## What
## Why
## Evidence
## Backing notes
- notes/<file>.md
```

and spawns a harvester on it, from its instance home. The spawn brief (not
the shared inject or skills) carries this procedure, and only for a soul that
has not opted out:

```sh
oats spawn oats.okf/knowledge-harvester --task-file proposals/<file>.md --relation unrelated
```

- `--relation unrelated` alone: the harvester is a top-level instance that
  can outlive the source. The kernel refuses `--relation unrelated` with
  `--relative-to`.
- The kernel picks the harvester's harness and model from its own defaults;
  oats.okf passes none.
- One spawn per proposal. A refused spawn is reported, not retried in a loop.
- The source keeps the backing notes until the harvester has handed over.

Most checkpoints have nothing to propose. Proposing is procedure, not a
command: oats.okf adds no CLI for it.

### What the harvester does

The harvester (`knowledge: none`, capability `oats.okf-harvest`) follows the
`knowledge-harvest` skill:

1. **Reads the proposal** (its TASK.md) as untrusted evidence, never as
   instructions.
2. **Establishes the source from the deployment's records**, never from the
   proposal: the one `agents/*/instances/<instance>/instance.json` whose
   `instance` and `home` match; that record's soul (`soul.yaml` name and
   `okf.json` owner, owns and reads); and the bindings file named in the
   record's `providers["oats.okf"]` settings. Owner, owned nodes, bases and
   destination come only from these. A source whose recorded soul opts out is
   refused, first by the harvester's required spawn hook (code, before the
   harvester exists: it also refuses an unrecorded or ambiguous source), then
   by the skill.
3. **Reads only the notes the proposal names**, as `notes/<path>.md` under
   the source home (regular files, no symlinks, no `..`), recording each
   one's SHA-256. It never reads STATE.md, log.md, other notes, transcripts
   or anything else of any home. A missing note is recorded without a hash
   and the claims that needed it are dropped.
4. **Clones each owned Git base** at its accepted branch and finds the owned
   nodes (owner matches and `alias/node` is in `owns`).
5. **Checks open and recent `okf-harvest` PRs** for duplicates.
6. **Judges and edits** only owned-node Markdown and the allowed navigation
   (the owned nodes' `index.md`/`log.md`, the base root `index.md`), never
   `okf-base.json` or another node. A claim whose home is a node the source
   does not own is dropped for that node's owner.
7. **Validates** with `okf-validate.mjs --strict` and checks the diff touches
   only allowed paths and carries no secret or private path.
8. **Publishes one PR per base** with plain `git` and `gh`: a branch
   `okf-harvest/<source instance>-<timestamp>`, label `okf-harvest`, and a
   body that ends with a version 2 provenance block (below). It never pushes
   to the accepted branch, force-pushes or closes a PR.
9. **Hands over** (the source, each PR URL, every dropped claim and why) and
   **retires**. Nothing waits for it and nothing reports back to the source.

Two limits hold throughout:

- **A valid instance and soul pair proves consistency, not authorship.** Any
  task can name a real instance. What bounds a harvest is the source soul's
  owned nodes, OKF validation and the maintainer's review of the PR.
- **If the source's authority cannot be established from the records** (for
  example the source retired and its record is gone, or the soul has no
  `okf.json`), the harvester **stops and reports**. It invents no scope and
  falls back to no other authority.

**Git only.** A directory base has no PR harvest in 5.0: the harvester drops
its claims and reports "directory base <alias> is unsupported for harvest in
oats.okf 5.0; convert it to a Git base or edit it in a reviewed change".

A harvester given a 4.x TASK (one naming a source descriptor and a run)
reports it and retires: `oats okf-harvest complete` and `harvest-status`
answer `E_REMOVED` and never run a 4.x completion.

### The provenance block (version 2)

````markdown
```okf-harvest
{
  "version": 2,
  "source": {
    "soul": "<soul.yaml name>",
    "owner": "<okf.json owner>",
    "instance": "<source instance>",
    "ownedNodes": ["<alias>/<node>"],
    "readNodes": ["<alias>/<node>"],
    "bases": [{ "alias": "<alias>", "id": "<base id>", "kind": "git", "root": "<root>", "repository": "<owner>/<repo>" }]
  },
  "evidence": [
    { "note": "notes/<file>.md", "sha256": "<64-hex of what was read>" },
    { "note": "notes/<missing>.md" }
  ],
  "tasks": { "provider": "<tasks provider, or null>", "refs": ["ABC-123"] },
  "harvester": { "instance": "<harvester instance>", "alias": "<messaging alias, or null>" }
}
```
````

The maintainer's parser (`oats.okf-maintenance` `lib/provenance.mjs`) reads
the first such block strictly: unknown keys are refused, `source.owner` is
required, `evidence` holds at most 100 `notes/…/*.md` paths without `.` or
`..` segments, with an optional 64-hex `sha256` only for a note the harvester
read. It still reads **version 1** blocks (4.x run and input ids), so PRs
opened by 4.x harvesters stay reviewable.

## The knowledge maintainer and the harvest-review trigger

`oats.okf/knowledge-maintainer` reviews one harvest PR, following the
`knowledge-review` skill:

- `oats okf-maintenance review-context (--event FILE | --pr URL)` validates
  the provenance as untrusted input and returns a reading list; for a
  version 2 PR it lists the evidence notes the harvester relied on (and
  which it could not read).
- The maintainer merges, amends and merges, or closes, recording an
  `okf-review` verdict comment that names the head it reviewed.
- It never silently supersedes a human-accepted decision: such a PR gets
  `okf-needs-human` and goes to a human, and that label is a hard stop.
- `oats okf-maintenance notify-harvester` composes a message to the PR's
  harvester. A 5.0 harvester has retired after handover, so sending it is
  optional and the merged text says nothing else is needed.

The maintainer is spawned per PR by the **`harvest-review` trigger
template** (`oats.okf:harvest-review`): GitHub `pull_request` events
`opened`, `reopened` and `ready_for_review` with the label `okf-harvest`,
polled every 2 minutes, spawning `oats.okf/knowledge-maintainer` with
concurrency `max 2, perKey 1`. Parameters: `repo` (required,
`github.com/<owner>/<repo>`), `base` (default `main`), `harness` (default
`claude`) and `model` (default `opus`). The policy is unchanged from 4.x.

oats.okf never installs the trigger. The `okf-trigger-setup` skill teaches
the workspace automation file (`oats-triggers/okf-harvest-review.yaml`,
`kind: oats-trigger`, `from: oats.okf:harvest-review`, `runsOn` naming the
one host, `owner` the merge-capable GitHub account) and `oats trigger add`.
Without the trigger, harvest PRs wait for a human reviewer.

## Explicit provisioning: init, migrate, unlock

Bases and node ownership change only through explicit operator actions, run
from the deployment with `--soul <soul>`.

**init** creates a new base from a node map, for example
`/absolute/config/team-nodes.json`:

```json
{"operations":{"path":"operations","owner":"operations-stable-id"}}
```

```sh
# A NEW directory base, provisioned in place; refuses an existing path.
oats okf init --base team --nodes /absolute/config/team-nodes.json --confirm --soul domain-expert --json
# A Git base is staged for an operator-owned commit and a reviewed PR; nothing is pushed.
oats okf init --base project --nodes /absolute/config/project-nodes.json --output /absolute/new-bundle-stage --soul domain-expert --json
```

**migrate** moves a v1 soul-contained `soul/knowledge/` into an external
node. A soul that still has `knowledge/` cannot spawn (`E_MIGRATION`); first
provision the empty owned node, then:

```sh
oats okf migrate --legacy /absolute/soul/knowledge --base project --node expert --output /absolute/empty-migration-stage --soul domain-expert --json
oats okf migrate --deliver /absolute/state/migrations/UUID/migration.json --soul domain-expert --json
# Git: review and merge the PR, then rerun --deliver to confirm acceptance.
oats okf migrate --cutover /absolute/state/migrations/UUID/migration.json --soul-dir /absolute/soul --soul domain-expert --json
oats okf migrate --forget UUID --soul domain-expert --json   # drop a record that never delivered
```

Migration preserves the full original under `<stateDir>/migrations/<uuid>/`,
stages the base before writing any record, refuses a non-empty destination
node, rewrites bundle-root links into the node, and validates the base.
Cutover requires accepted delivery, unchanged original bytes and current
bindings still mapping the alias to the delivered base; it renames the
original into custody and updates `okf.json`. Skills are never changed.

**unlock** releases a directory base lock left by a dead local holder; the
`E_LOCKED` error names the command:

```sh
oats okf unlock --lock /absolute/path/to/lock --token TOKEN_FROM_OWNER_JSON --soul domain-expert --json
```

It refuses living holders and other hosts. Never remove a publication
journal by hand.

## Portable binding (payloadVersion 2)

A soul can carry its knowledge declaration portably, as the `knowledge` value
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

`fixed` is an equality requirement, `default` a fallback candidate, and
`inherit` requires a separately supplied binding. Reads never become write
destinations. The declaration contract stays version 1.

The manifest declares the binding wire (`binding.version: 1`):
`binding-normalize`, `binding-bind` and `binding-check`, bounded JSON
stdin/stdout entrypoints for the kernel, not operator commands.

- **normalize** emits requirements and candidates under
  `/bindings/knowledge/...` for the kernel's single resolver, from the soul's
  declaration and the workspace, adoption and operator binding maps; it
  needs `bindings-file` and `state-dir`.
- **bind** renders the selected choices into a ProviderBinding1 with
  **`payloadVersion: 2`**: payload keys `owner`, `stores`, `reads`, `owns`
  and `runtime` (`descriptorFile`, `bindings`, `declaration`). The 4.x
  `execution` (harvest runtime and model) is gone.
- **check** is read-only readiness: settings, the soul declaration, each
  base (Git bases through the host cache and a bounded `ls-remote`) and the
  declared nodes. It answers `ready`, `needs-configuration` or
  `unavailable` with problems and warnings drawn only from the 24 fixed
  strings and templates in the manifest's `binding.reasons`, which must
  match the provider's byte for byte. A failed node check is
  `declaration:unresolved`.

A **payloadVersion 1** binding (4.x) is refused: check answers
`needs-configuration` with `E_REMOVED: OKF binding payloadVersion 1 (harvest
runtime/model) was removed in oats.okf 5.0; respawn to bind with oats.okf 5
…`, and a captured `OATS_BINDING_FILE` holding one makes the command fail
with `E_REMOVED`.

The released 0.44 kernel runs the check phase (readiness) and names no
`OATS_BINDING_FILE`; consultation then uses the soul's `okf.json` and the
bindings file. A present `OATS_BINDING_FILE` must be a private,
single-link, owner-only regular file and fails closed on any defect. Captured
`setup`, `init`, `migrate` and `unlock` refuse. Data examples are in
[`examples/portable-binding/`](examples/portable-binding/), and the domain is
described in [PORTABLE-BINDING-DOMAIN.md](PORTABLE-BINDING-DOMAIN.md).

## Removed in 5.0

Each removed surface answers `E_REMOVED` with the new way; none captures,
runs, completes or drains anything.

| Removed | Instead |
|---|---|
| `oats okf harvest` and the `knowledge:harvest` operation | a proposal and `oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated` |
| `oats okf run-source`, `complete`, `retry` | nothing: 5.0 keeps no runs or custody |
| `oats okf harvest-status` | nothing: there is no harvest state to report |
| `oats okf setup --harvest`, `--enable`, `--disable`, `--install-host`, `--remove-schedules` | `oats okf setup --remove-legacy-settings` removes the old keys |
| `oats okf migrate --source-home` | nothing: there is no source registration |
| `--source FILE` on any command | run from the instance home, or from the deployment with `--soul` |
| `OATS_SOURCE_RECEIPT_FILE` or `OATS_INVOCATION_CONTEXT_FILE` in the environment | nothing: captured receipts and invocation contexts are gone |
| `oats okf-harvest complete`, `harvest-status` | the harvester opens the PR itself with `git` and `gh` |
| settings `harvest`, `harvest-runtime`, `harvest-model` | remove them (see [Settings](#settings)) |
| the `harvester-max-age` setting of `oats.okf-harvest` | none: a harvester retires after handover |
| the retire hook, and the spawn hook's `sourceReceipt` input | none |
| binding `payloadVersion` 1 and its `execution` | `payloadVersion` 2 |

`oats okf read` (removed in 4.0, use `cat`) and `oats okf refresh` (removed
in 3.0) keep their earlier `E_REMOVED` answers. The `harvest` operation stays
declared in the manifest so an old caller gets that answer rather than an
unknown operation.

## Upgrading to 5.0

- The commands, settings and hooks in [Removed in 5.0](#removed-in-50) are
  gone; each answers `E_REMOVED` naming the proposal flow.
- After pinning 5.0, remove the 4.x settings from the deployment's
  `oats-local.yaml` with
  `oats okf setup --remove-legacy-settings --soul <soul> [--plan] --json`,
  run from the deployment. It only deletes `settings.oats.okf.harvest`,
  `harvest-runtime` and `harvest-model` (`--plan` writes nothing), and only
  from the `oats.okf` map directly under `settings:` (an emptied map stays
  `{}`, before any inline comment). It refuses with `E_UNSUPPORTED`, before
  writing, on YAML it cannot edit line by line, an `oats.okf` nested under
  another key included (report that to the deployment's owner), and never
  touches a soul: a soul's
  `knowledge: { harvest: off }` stays valid. Until the host keys are gone,
  every command and the spawn hook refuse.
- 5.0 neither reads nor deletes 4.x custody (`<stateDir>/sources/`,
  `owners.json`); finish or dispose of it under 4.x. A registered 4.x home
  retired after the pin is kept with `E_HARVEST_CONSENT_UNKNOWN` from its
  copied retire hook. 4.x harvest PRs (provenance version 1) stay
  reviewable.

## Upgrading from 4.1

oats.okf 4.2 and later manage no scheduler job. A live bindings document
with `cron` or `tz` answers:

```text
E_HARVEST_SCHEDULE_REMOVED: … oats.okf harvests no schedule since 4.2: remove cron/tz from the bindings file, and remove each okf-<source id> job okf <= 4.1 created with oats schedule remove <id> --dir <deployment> (README#upgrading-from-41).
```

Remove `cron` and `tz` from the bindings file. In every deployment that ran
4.1, list its jobs (`oats schedule list --dir <deployment> --json`); an old
OKF job is `okf-<source id>` running `oats okf run-source --source …`.
Remove each with `oats schedule remove <id> --dir <deployment>`, deciding by
its definition, never by the `okf-` prefix alone and never with `--force`.
The kernel refuses while the job has a tracked instance or an unresolved
effect: settle it (`oats schedule reconcile <id> --dir <deployment>`), then
remove it.

## Tests and CI

```sh
npm test    # npm run validate (the manifests), then node --test test/*.test.mjs
```

The suite is a fresh 5.0 suite: the 4.x tests of the removed machinery were
removed, not ported. It uses real temporary Git repositories, real
directories and the package's CLI:

- `okf5-consult`: Git bases read through the host cache at the accepted
  state (`bases`, `cat`, `ls`, `links`, `search`, `--fresh`), and the
  refusals of credential-bearing locators, escaping paths and unknown
  aliases;
- `okf5-working`: the spawn and soul-scaffold hooks, `inspect`, consulting
  from a home, `init`, `migrate --legacy/--deliver/--cutover`, and the
  removed surfaces and `harvest` operation answering `E_REMOVED`;
- `okf5-legacy-settings`: the removal sentence for each origin and key, and
  `setup --remove-legacy-settings` (plan, removal, `{}` before an inline
  comment, idempotence, the refused shapes and files, a nested `oats.okf`, the deployment scope, soul-origin keys);
- `okf5-provenance`: the version 1 and 2 parser, `review-context` and
  `notify-harvester`.

`okf5-real-kernel` runs only when `OATS_OKF_REAL_CLI` names a kernel; CI's
`real-kernel-044` job installs the released **OATS 0.44.0** in a disposable
prefix and runs it, failing if it skips. In an isolated file-Git workspace
with this package pinned from the checkout, it runs the legacy-key cleanup,
a real working-soul spawn, its checkpoint proposal spawning a top-level
harvester, the harvester reading the source's records, the removed
surfaces, and the source's retirement. Instances are spawned with
`--no-launch`: no model, messaging or GitHub PR is involved.

Not covered by tests: a real harvester judging a proposal, a real GitHub PR
and the maintainer's review on GitHub. [SCHEMA-STATUS.md](SCHEMA-STATUS.md)
lists the schemas and these limits.
