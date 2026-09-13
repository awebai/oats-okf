# Schema and consumer verification status

## Candidate and authoritative payload

The working v2 candidate's distribution and capability manifests declare
**2.0.0**, with **OATS >=0.23.0**. These declarations are not evidence of a
published release or a passing released-consumer probe. The v1.6.1 baseline
and its older compatibility floor do not describe this candidate's runtime.

The authoritative payload is `oats-package/capabilities/oats-okf/`, enumerated
by `oats-package/oats-package.json`. The private root npm package supplies
standalone tooling. Obsolete unenumerated root `oats.json`, `bin/`, `agents/`,
`skills/` and `injects/` copies have been removed after checking manifest,
validator, test, CI and framework consumer paths. The distribution manifest,
LICENSE and actual exported capability remain; its canonical worker
`CLAUDE.md -> AGENTS.md` symlink is unchanged. A baseline test prevents those
obsolete copies from returning. This remains **2.0.0 before tagging**, not a
published patch.

## What `npm test` and default CI check

`npm test` runs `scripts/validate-manifests.mjs` and **all** `test/*.test.mjs`.
The suite exercises the v2 implementation, not legacy harvest-branch behavior:

- **Manifest validation and mutation rejection:** package/capability manifests
  use the vendored schema keywords implemented by the local validator, including
  `oneOf` and `const`. Exported resources and their descendants must stay inside
  the distribution after realpath resolution; escapes, dangling links and
  directory cycles fail. Mutation tests verify declared operation/command
  dispatch and skill closure against the enumerated payload.
- **OKF configuration schemas:** `test/okf-schema-parity.test.mjs` compares the
  root and exported `okf-bindings`, `okf-soul` and `okf-base` schema files
  byte-for-byte. Accepted/malformed fixtures exercise both the shipped schema
  constraints and runtime validators, including unknown properties, reserved
  identities, node references and settings. Its deliberately small schema
  checker refuses unsupported keywords. Filesystem, ownership and custody
  invariants remain runtime checks, not JSON Schema claims.
- **V2 custody and lifecycle:** real temporary Git repositories with a
  deterministic fake `gh`, and actual non-Git directories without Git/gh on
  PATH. Tests cover source registration/scheduling, bounded record planning,
  notes plus records, retirement/source deletion, frozen destinations, worker
  staging, exclusions, judgments, PR uncertainty, accepted-versus-delivered
  receipts, directory conflicts/crash recovery and explicit migration cutover.
- **Reader views:** bases are materialized at `bases/<alias>` separately from
  `view.json`; receipts, read/refresh results and injected navigation agree.
  Aliases including `input.json`, `view.json` and `staging.json` traverse
  registration, delivery and fresh reads. Failure tests check partial-build
  cleanup, destination preservation and registration retries on both sides of
  the durable source pointer without resetting source identity or evidence.
  Descriptor-selected read/refresh caches stay under the durable source's
  `views/` directory for live, retired, disappeared and reused homes, never in
  the invoking context/repository. Home-selected views retain their home layout.
- **Inspection compatibility:** both manifest command and operation routing
  return the v1 labeled STATE/log/notes Markdown documents for a live matching
  source, alongside v2 receipts, frozen bindings and registered view freshness.
  Tests assert complete large stdout, explicit 256 KiB/UTF-8 preview metadata,
  identity checks before/after reading, missing/retired/reused-home suppression,
  symlink/hardlink/non-regular file rejection and explicit error envelopes.
  Inspection is a best-effort live view, not a locked snapshot; it neither
  captures evidence nor mutates custody/worker state.

Neither local schema checker is a general JSON Schema implementation. The
vendored OATS lock schema is not exercised, and the OKF root/exported byte-parity
check is **not** a claim of parity with fresh canonical OATS schemas.

## Optional public CLI probes

Three tests skip by default, with explicit Node test skip output:

1. `test/consumer.test.mjs` uses `OATS_OKF_CONSUMER_CLI` (absolute CLI path) to
   exercise public command dispatch, targeted hooks, directory worker
   scaffolding, retirement, completion after source deletion and fresh-reader
   scaffolding. It also transports large live STATE/log/notes through native
   `oats okf inspect` and `oats operation run knowledge:inspect`, checks
   disappeared/reused-home suppression and external read/refresh cache paths.
   It copies only the enumerated OKF capability into a disposable owned-capability
   fixture. It does **not** acquire the OKF distribution.
2. The native capture/recall test in `test/oats-okf.test.mjs` transports sixty
   synthetic 350 kB Claude records through the actual public kernel into durable
   bounded input, then exercises fixture completion after source removal.
3. The native scheduler test checks registration idempotence and disabled-job
   preservation without installing a host timer.

Native tests use `OATS_OKF_NATIVE_CLI`, falling back to
`OATS_OKF_CONSUMER_CLI`. All three run with:

```sh
OATS_OKF_CONSUMER_CLI=/absolute/oats/bin/oats.mjs npm test
```

The selected CLI must exist and satisfy the real compatibility floor; do not
relabel an older kernel to manufacture a pass. Consumer fixtures isolate HOME,
config, schedule state and executable PATH, and use an inert model executable.
No real model session, deployment mutation or GitHub write is part of a probe.

CI exposes an optional `workflow_dispatch` **public-consumer** job. Supply an
exact published `@awebai/oats` version at or above the declared floor; the job
installs that kernel in a disposable prefix and runs the full suite with the
consumer variable set. Tags, ranges and source specifiers are rejected; an
unavailable or incompatible version fails rather than falling back or skipping.
With empty input the job is skipped, not counted as consumer evidence. Adding
this job does not claim it has run successfully on GitHub.

## Release acceptance still separate

Before publication, record exact artifact/kernel/harness versions, commands and
outcomes for parent-controlled gates that these tests do **not** certify:

1. **Installed OKF distribution:** acquire → lock/restore → trust → activate →
   scaffold/retire with the actual minimum and intended released consumer.
   Verify enumerated resources and dispatch; owned-source fixtures do not prove
   package acquisition, executable trust or lock restoration.
2. **Real GitHub delivery:** verify PR creation, review/merge and accepted-head
   visibility against an authorized disposable remote. Fake `gh` receipts and
   local Git merges are not evidence of a remote PR.
3. **Fresh selected-runtime learning:** a real fresh agent must answer from
   delivered knowledge without the source home/transcript. Scaffold-visible
   bytes and synthetic native records are not evidence of model learning.

The v2 declarations, green standalone suite and optional CI configuration do not
close these acceptance gates or authorize publication by themselves.
