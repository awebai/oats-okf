# Captured operation worker — selected profiles and qualification limits

## Phase1 selected-profile extension (source candidate)

The published 2.1.0 consumer rejected every non-Pi or multi-capability helper.
This source change permits explicitly retained **Claude/Codex** helper selections,
including `model: null` for normal native model configuration, while validating
the whole public capability approval list. The executable OKF helper must itself
be approved; duplicate, missing or unapproved capabilities refuse. The exact
retained helper binding carries the full resource/hook closure to the kernel;
no messaging, authoring or runtime requirement is removed or replaced.

Pi retains the previous strict explicit-model / sole-OKF restriction. This does
not silently choose Claude/Codex for a Pi pilot or qualify an enriched strict-Pi
profile. Inspector API2 availability and executable approvals remain distinct
from native readiness, dispatch acceptance, worker completion and knowledge
acceptance. A required messaging provider that is not ready still blocks the
real public lifecycle. Release/version selection and live qualification remain
maintainer/operator-owned; this change is not the published 2.1.0 tag's bytes.

The captured branch uses the existing OKF run, staging, judgment and publication
lifecycle. It does not remove the general E_CAPTURED_HELPER guard or make API2
availability sufficient native authority.

## Only fresh entrypoint

```sh
oats operation run knowledge:harvest --deployment D --resolution SOURCE_ID \
  --home REGISTERED_SOURCE_HOME --arg native-request=/absolute/backend-only.json \
  --arg worker-mode=launch --json
```

`worker-mode=prepare` performs real admitted capture/run/scaffold/staging without
native dispatch. Legacy v1 callers retain their old paths when these new args
are absent. Captured raw harvest/run-source/schedulers and null-intent/receipt-
only ingress remain held. Existing SOURCE complete/non-rejudging retained-run
retry remains available; rejudge/adopt/recovery paths are not silently widened.
This is worker creation triggered by an admitted persistent-instance operation,
NOT qualification of schedules or always-on automatic lifecycle harvesting.
Those entrypoints remain held; a real operation-launched worker does not qualify them.

The native request is the existing version1 backend/optional stopGraceMs subset:
provider generates the actual worker task. Task/env/model overrides in that file
refuse. Backend is explicit, never borrowed from SOURCE or current config.
Unknown protocols, malformed selectors, links and changed input refuse.

## Authority and real custody

Before capture/run/scaffold writes, consume the kernel-produced paired invocation:
registered persistent SOURCE, exact source/context/human/binding, current non-null
instance+intent and knowledge:harvest action. Read only the PUBLIC SOURCE helper
lookup and require its exact provider/definition/key, work/context/human/bindings,
complete approved capability closure and API2. For Pi, the default-OKF-only
restriction remains. Own required Pi runtime/plugin/launch behavior stays held,
never filtered away. Kernel still enforces actual retained requirements, hooks,
host eligibility, approvals and witnesses; inspection is not their completion.

The public lookup must additionally expose:
`helperSelection.launchSelection = null | {runtime, model}` from its verified
retained launch. The kernel implements this public field; it is a compatibility
requirement, not an outstanding getter proposal. Absence or mismatch refuses,
never reads private kernel files and never implies native readiness.
Pi needs a nonempty independently retained model; ordinary Claude/Codex accept
an explicit retained null/native-default choice. Every runtime must match the
selected harvest runtime and any selected harvest-model pin. No fallback,
parent model substitution, ambient profile emptying or auth handling is added.

Create a REAL existing-format provider run from captured input IDs, preserving
source ID/binding/outer admitted intent/incarnation and endpoint hash in that
run. Choose a fresh deterministic worker address inside the owned run directory,
persist before public scaffold, then use HELPER binding/name for scaffold. Keep
actual returned home/incarnation/hook receipt plus existing kernel directory
proof observations. Staging and every first judgment validate the same source,
helper binding/incarnation and original physical home/work; no fake identity.

Generate input.json/staging.json and completion TASK through the existing worker
implementation. Public native start uses SOURCE+exact helper key+owned home and
frozen provider task/request. Only actual returned helper/source binding,
incarnation, intent and model correspondence can record dispatch acceptance.
Dispatch/task/model completion/judgment/publication remain different states.
Native auth/profile/helpers/OAuth context remains native; no credential handling.

The helper performs actual judgment and uses the existing safely quoted SOURCE
completion command. No seeded run/receipt/judgment/transcript is permitted as
real worker proof. Successful completion may deliver to the owned directory
base (or existing PR-only Git path); no policy/publication redesign is introduced.
Captured TASK explicitly retains home/history instead of requesting unsupported
legacy self-retirement. Public captured retirement remains held.

## Retry and uncertainty

Kernel operation replay returns its exact completed receipt without re-execution.
A new admitted harvest can observe the same active run, or dispatch a genuinely
ready prepared worker after checking the same source/endpoint/helper/model
custody. It cannot replace it with a new run/address or reset a saved task.

Interrupted/unknown scaffold, partial staging, launch-intent or launch-unknown
states are conservatively HELD with actual public observations preserved. No
metadata-only adoption, duplicate native dispatch, implicit retry or cleanup.
Public scaffold has no qualified retry/reconcile selector; that and broader
native recovery are explicitly unsupported in this smallest slice. A known
failed operation's kernel --retry-intent does not itself authorize recreating
an uncertain child. No new provider broker/store/admission/identity system.

## Historical coordinated 2.1.0 metadata checkpoint

The provider release candidate is **2.1.0**, requiring kernel **>=0.24.0** in
both distribution and capability manifests. This is an additive v2-family
release; wire, payload and record protocol versions are unchanged. The kernel
must include public helper launchSelection, current admitted operation/paired
inputs, actual captured host/backends and complete record-witness guards.
API2 availability alone is insufficient; 0.23.x is not a supported pairing.

These version values are chosen release targets, not evidence of published tags,
installed verification or deployment. Parent owns publication order and exact
framework/provider artifacts, mirror/catalog/inventory checks and release gates.
This metadata-only successor does not change production JS or qualify raw,
scheduled or always-on captured harvesting beyond the admitted operation above.

## Evidence limits

Focused consumer units use injected PUBLIC response data only; they verify
refusals/argv/custody/unknown-state behavior, not current kernel admission or a
real worker/model. A separate opt-in actual public prepare test covers retained
admission, helper scaffold/staging and repeated prepare without native dispatch;
that no-launch result is not model, schedule or lifecycle-harvesting qualification.
Real parent gate is still required on assembled reviewed code
and genuine existing native auth. No developer model/backend/account operation,
record lib/bin edit, extra full suite or old source-review replay was performed.
