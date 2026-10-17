# Native capture attempts

The foreground checkpoint, manual harvest and retire hook share capture through
`sources.mjs`. It saves notes, observes a native attempt, then recalls only the
session boundaries certified by that attempt. No record window is enqueued from
an incomplete receipt. Existing inputs and recall cursors remain durable through
errors. Checkpoint and manual harvest defer without preparing a worker while
capture is pending; retirement refuses removal until final capture and recall
finish. Turning harvest off does not resolve an outstanding attempt.

`capture-attempt.mjs` persists one current attempt under the source's private
custody before dispatch. `capture-runner.mjs` is a detached **per-attempt** process;
it inherits no foreground pipes and exits after its one native process closes.
It is not a service or scheduler. The selected absolute `OATS_CLI_BIN` runs
`capture --home HOME --quiet`, with the existing cleaned native environment and
launch-history selection. No provider timeout, TERM or KILL is applied to it.
The foreground's deadline bounds observation and subsequent recall only.

The effective record root is `TURN_RECORD_ROOT`, relative to the native command's
context when relative, otherwise `homedir()/.turn-record`. Canonicalization
resolves aliases before the provider creates `<root>/.oats-okf-capture/gate`.
This gate is shared across sources, owners, processes and provider state
directories. It is unrelated to the kernel's `.capture.lock`, which this provider
never removes or reclaims. Recall receives the exact saved root and owner.
Busy gates leave a queued source attempt; the next explicit checkpoint or manual
retry attempts dispatch again. There is no resident queue dispatcher.

## Durable state and authority

`<source directory>/capture-attempts/current.json` names a UUID directory with:

- `request.json`: attempt ID, selected CLI/context, canonical root, native owner,
  final/checkpoint purpose, source descriptor digest, physical home identity and
  instance-metadata digest. No environment, credentials or launch recipe is saved.
- `dispatch.json`: durable dispatch intent, written before starting the runner.
- `runner.json`: exclusive runner claim; its PID is diagnostic, never completion
  evidence or authority to retry an uncertain native invocation.
- `receipt.json`: atomic private close observation, binding the request digest
  and attempt ID to bounded native stdout, exit code, signal and overflow flag.
- `consumed.json`: the matching receipt has either been recalled into custody or
  was explicitly observed as noncomplete. A later invocation may create a new
  attempt. Previous requests and receipts remain available.

All provider state uses private directories and atomic fsync-backed JSON writes.
Reads reject symbolic links, hardlinks, non-files, oversized or changed files and
foreign ownership/permissions. Native stdout retention is capped at 16 MiB per
attempt. Stderr is drained without storage. Overflowed or unreadable output never
certifies capture. There is no automatic attempt-evidence deletion.

The runner publishes its receipt only after native output closes, including on a
nonzero exit. Only a valid JSON receipt with `complete:true`, the selected
home/owner and `sourceRoots:"launch-history"` can proceed to recall. Complete
session boundaries must identify consistent thread/source/session/stream and a
cwd within the source home. Recall validates the first boundary and every
planned turn's identity/source before persisting windows. Exit zero, shared
capture health, a dead PID or elapsed age cannot substitute for this proof.
A completed checkpoint attempt cannot alone certify retirement: its windows are
recalled and then a new final-purpose attempt is taken.

Gate mutations use a short provider coordination lock. Its dead-owner recovery
only serializes gate metadata; it does not authorize native dispatch. Gate
release requires the exact owned request and its durable closed-output receipt.
A missing or unconsumed current attempt never permits replacement dispatch.
Known terminal skipped/held/failed/incomplete receipts are consumed and deferred;
the next invocation may retry. Invalid receipts remain uncertain and held.

## Uncertain-state recovery

A crashed foreground can be retried: the short source lock can recover and the
persisted attempt prevents duplicate dispatch. If the runner finishes while the
foreground is gone, a later invocation reads its receipt. A gate left after
receipt publication can be released by that exact receipt. A runner crash before
receipt publication is intentionally different: its native child may still be
running, so the source and shared gate remain held regardless of PID or age.

Retain the source home, its independent native history, attempt directory and
record root. Inspect the request, dispatch and runner claims and the kernel's
own lock diagnostics. A missing receipt is not a failed pass or a completed
pass. Never delete a kernel lock or edit a receipt to force completion. This
provider supplies no automatic redispatch/reset for an uncertain attempt. Stop
new provider callers and have the operator/maintainer reconcile native process
ownership and record custody before any explicit provider-state recovery; when
completion cannot be proven, keep the source and evidence. Kernel lock recovery
remains the kernel's operation.

## Verification

`test/capture-attempt.test.mjs` uses controlled native-shaped fixtures for
bounded return, source/root coordination, receipt failures, restart and process
death. `test/oats-okf.test.mjs` exercises checkpoint/manual/retire guards and
bounded recall. The opt-in `test/capture-native.test.mjs` uses the selected
released `OATS_OKF_NATIVE_CLI` with disposable HOME, record, transcript and native
history roots. Its controller pauses a real exact-home process while it owns
its native lock for over 60 seconds, then resumes it and verifies the genuine
receipt and recall. This proves deadline survival and custody, not capture
throughput. Run heavy tests under the host's shared suite/load policy with an
isolated environment and bounded test concurrency.
