# Captured worker first slice — source implementation, real gate pending

This successor adds an actual captured worker branch to the existing OKF run,
staging, judgment and publication lifecycle. It does not remove the general
E_CAPTURED_HELPER guard or make API2 availability sufficient authority.

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

The native request is the existing version1 backend/optional stopGraceMs subset:
provider generates the actual worker task. Task/env/model overrides in that file
refuse. Backend is explicit, never borrowed from SOURCE or current config.
Unknown protocols, malformed selectors, links and changed input refuse.

## Authority and real custody

Before capture/run/scaffold writes, consume the kernel-produced paired invocation:
registered persistent SOURCE, exact source/context/human/binding, current non-null
instance+intent and knowledge:harvest action. Read only the PUBLIC SOURCE helper
lookup and require its exact provider/definition/key, work/context/human/bindings,
approved default-OKF-only profile and API2. Own required Pi runtime/plugin/launch
behavior stays held, never filtered away. Kernel still enforces actual retained
requirements/host/approvals/witnesses before native effects.

The public lookup must additionally expose:
`helperSelection.launchSelection = null | {runtime, model}` from its verified
retained launch. This is an explicit implementation dependency requested from
parent/lifecycle; absence or mismatch refuses, never reads private kernel files.
Captured first slice is Pi with a nonempty independently retained model, matching
any selected harvest-model pin; no fallback/parent model substitution.

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

## Required publication metadata — parent-owned

The new consumer requires the first-cut kernel **>=0.24.0**, INCLUDING the public
helper launchSelection tuple, current admitted operation/paired input contract,
actual captured native host/backends and complete record-witness guards. API2
alone is insufficient. Version0.24.0 is planned, not an invented published tag.
Before publication the parent must coordinate compatibility floor updates in
`oats-package/oats-package.json` and `oats-package/capabilities/oats-okf/oats.json`
(currently >=0.23.0). Current package version2.0.0 is unchanged; final package
version, framework/catalog/mirror/registry delivery are parent's decisions.
Do not advertise the new path as supported by existing0.23.x installations.

## Evidence limits

Focused consumer units use injected PUBLIC response data only; they verify
refusals/argv/custody/unknown-state behavior, not current kernel admission or a
real worker/model. Real parent gate is still required on assembled reviewed code
and genuine existing native auth. No developer model/backend/account operation,
record lib/bin edit, extra full suite or old source-review replay was performed.
