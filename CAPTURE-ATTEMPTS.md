# Native capture attempts

The foreground checkpoint, manual harvest and retire hook share capture through
`sources.mjs`. It saves notes, observes a native attempt, then recalls only the
session boundaries certified by that attempt. No record window is enqueued from
an incomplete receipt. Existing inputs and recall cursors remain durable through
errors. An idle checkpoint or manual harvest gives already verified, unprocessed
custody priority over optional capture and historical settlement. It validates
live consent and source identity, then uses the existing run selection,
publication/rejudgment, no-launch and spawn-budget guards. A pending native
attempt supplies no input until its receipt and recall are verified; it cannot
block a worker over earlier immutable custody. With no backlog, a bounded
capture observation can defer, with an explicit recovery command.

Harvest-on retirement refuses removal until final capture and recall finish.
Live-confirmed harvest-off or soul opt-out instead ends new harvesting. Under
the source capture lock it can settle a provably never-dispatched queued request
or a matching validated closed receipt, without native dispatch, notes capture,
recall, new custody or a worker. The lock covers settlement and the retired-state
transition. Dispatch intent, a runner claim, an own gate without terminal proof,
invalid/foreign/overflowed output or uncertain ownership still refuses removal.
Unknown consent never authorizes this path. Existing custody and receipts stay;
this settlement does not certify uncaptured final bytes.

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
  stable instance identity (`instance`, `agent`, creation/incarnation and kind).
  Routine kernel restart, wake, backend and prompt bookkeeping can change. No
  environment, credentials or launch recipe is saved.
- `dispatch.json`: durable dispatch intent, written before starting the runner.
- `runner.json`: exclusive runner claim; its PID is diagnostic, never completion
  evidence or authority to retry an uncertain native invocation.
- `receipt.json`: atomic private close observation, binding the request digest
  and attempt ID to bounded native stdout, exit code, signal and overflow flag.
  It distinguishes an actual closed native process from a proven failure before
  native dispatch; only the former can carry a native capture certificate.
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
An attempt dispatched by an earlier invocation cannot alone certify retirement:
its windows are recalled and then a fresh final-purpose attempt is taken, so a
later session tail is not hidden by a delayed receipt. A queued checkpoint request
first dispatched inside the retire invocation is fresh regardless of its original
purpose flag; freshness is the dispatch observation in that invocation.

A gate is staged with its complete owner record and atomically renamed into
place. A crash before publication leaves an inert staging directory and cannot
publish an ownerless gate. Gate mutations use a short provider coordination
lock. Capture and retirement locks recover only a recorded, provably dead local
owner. They atomically publish a staged directory containing their owner and
rename away before recursive release cleanup; crashes leave owned locks or inert
staging/cleanup debris. Pre-existing ownerless metadata locks require explicit
reconciliation, regardless of age. This recovery
only serializes gate metadata; it does not authorize native dispatch. Gate
release requires the exact owned request and its durable closed-output receipt.
The owned gate is atomically renamed away and its parent synced before recursive
cleanup, so interrupted cleanup cannot publish an ownerless gate. Inert
`.released-*` directories may remain after a cleanup crash without holding the
root.
A missing or unconsumed current attempt never permits replacement dispatch.
Known terminal skipped/held/failed/incomplete receipts are consumed and deferred;
the next invocation may retry. A runner whose exclusive claim proves it has not
started native capture also records a closed, non-dispatched terminal observation
when validation or executable startup fails. The foreground does the same when
the OS refuses runner creation. These observations release their own gate and
defer for retry; they never certify native capture. A changed CLI before dispatch
is retryable; an in-flight attempt is observed using its saved CLI/root/owner,
even after an installed-kernel upgrade. Invalid receipts remain uncertain and
held.

## Uncertain-state recovery

A crashed foreground can be retried: the short source lock can recover and the
persisted attempt prevents duplicate dispatch. If the runner finishes while the
foreground is gone, a later invocation reads its receipt. A gate left after
receipt publication can be released by that exact receipt. A runner crash after possible native
dispatch but before receipt publication is intentionally different: its native
child may still be running, so the source and shared gate remain held regardless
of PID or age. An existing exclusive runner claim can belong to that live
runner; a duplicate runner never overwrites its receipt or releases its gate.
Missing/unreadable request, dispatch or gate ownership, an unobserved foreground
crash around runner launch, and corrupt/overflowed native output likewise remain
uncertain. Queued observations include a bounded blocker attempt ID and uncertain
completion state when exact gate/request metadata supports it; unreadable ownership
is reported as unknown. This never infers native closure from process liveness.
A genuinely replaced source identity remains refused, while ordinary
kernel bookkeeping updates do not invalidate its receipt.

Retain the source home, its independent native history, attempt directory and
record root. Inspect the request, dispatch and runner claims and the kernel's
own lock diagnostics. A missing receipt is not a failed pass or a completed
pass. Never delete a kernel lock or edit a receipt to force completion. This
provider supplies no automatic redispatch/reset for an uncertain attempt. Stop
new provider callers and have the operator/maintainer reconcile native process
ownership and record custody before any explicit provider-state recovery; when
completion cannot be proven, keep the source and evidence. Kernel lock recovery
remains the kernel's operation.

For a root-wide stall, use this read-only inspection sequence:

1. Stop new provider checkpoint/manual/retire callers while preserving any native
   process already running. Preserve the source home, its native history, the
   source registry directory and the effective record root.
2. Read `capture-attempts/current.json` beside the source descriptor. Locate its
   UUID directory and retain `request.json`, `dispatch.json`, `runner.json`,
   `receipt.json` (if present) and `consumed.json` (if present). The pointer,
   attempt IDs and request digests must agree; source physical/stable identity
   and the saved root must still match. Missing evidence is unknown.
3. Read `<saved root>/.oats-okf-capture/gate/owner.json`. Its directory, attempt ID
   and request digest identify the blocking attempt, which may belong to another
   source. Retain that attempt's files too. Do not rename/delete the published
   gate or a coordination lock, and never touch the kernel `.capture.lock`.
4. A matching, private, closed valid receipt permits ordinary observation to
   release its exact gate; complete native output still needs recall for
   harvest-on certification. Confirmed harvest-off retirement may settle a valid
   closed or provably unissued attempt under its different consent contract.
5. Without terminal evidence, bring the retained files, native history and the
   kernel's lock/process diagnostics to the maintainer for reconciliation.
   A reboot, absent PID or old timestamps cannot prove output closure or custody.
   Keep the source and root held until explicit reconciliation establishes the
   missing facts. Do not synthesize a receipt or edit a request/consumed marker.

There is no reset/unlock operation for uncertain capture state in this provider.
Any maintainer-directed recovery outside these ordinary validated paths is a
separate operation, not permission granted by these diagnostics.

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

## Deferred retirement visibility

A failed final capture writes `retirement-deferred.json` beside the source
status. Its first-deferred timestamp survives repeated retire attempts and
successful checkpoints; the latest attempt/reason is separate. An ordinary
pending checkpoint creates no retirement obligation. Only verified final
custody, or a retirement resolved under the existing harvest-off consent and
settled-capture rules, clears it. No warning grants permission to remove a home.

`harvest-status` reports a deferred-source count, oldest observed age and
per-source since/age, using its bound source registry and soul/home filters.
Readiness observes the bound registry in aggregate and emits the stable
`retirement-capture-deferred` warning, including count and age, even with harvest
off. This warning leaves an otherwise ready provider ready. The released kernel
check result stays within its closed `status`/`problems`/`warnings` shape; no new
kernel API is needed.

The observation scans at most 500 registry entries, 4 MiB of source/marker data
and a 100 ms admission window. It reads no live homes, transcripts, capture
roots or worker state, starts no capture/recall/model/worker, and creates no
locks or files. Unreadable, changed or redirected evidence reports unknown
coverage; a bound reports truncated coverage. With incomplete coverage, the
exact count is null and the observed count/oldest age are lower bounds, never a
claimed zero. Readiness exposes only sanitized aggregate numbers and fixed
warning text; source names, paths, attempt IDs and raw errors stay off its wire.

Final certification requires a fresh pass within the retire invocation after
recalling a retained receipt. If every native pass exceeds that foreground
share, retirement can remain deferred despite completed detached passes. The
source and durable obligation remain visible until the limitation is resolved;
there is no final-tail inference from a hook phase, metadata or PID.

A failure to update the retirement marker preserves the original capture error
and attaches `retirementMarkerError`; the hook diagnostic also reports the
bounded marker error code. If final custody succeeds but marker cleanup fails,
retirement remains refused with an explicit marker-cleanup diagnostic until a
retry clears it. These secondary failures never authorize source removal.
