# Schema and consumer verification status

## Current baseline

The exported distribution and capability manifests both declare **1.6.1** and **OATS >=0.22.3**. Release tag `v1.6.1` already exists. Earlier references to an unreleased 1.4.1 package and pending released-0.19.0 fixtures are historical, not a prohibition on a release that has already happened.

The authoritative payload is `oats-package/capabilities/oats-okf/`, enumerated by `oats-package/oats-package.json`. Root private npm metadata and unenumerated payload copies do not select the installed capability.

## What standalone CI checks

`npm test` runs the local manifest validator and only `test/*.test.mjs`:

- Package and capability manifests are checked against the vendored schema keywords used by this repository, including `oneOf` hook/requirement alternatives and `const`. This is a small local validator, not a general JSON Schema implementation. The vendored lock schema is not exercised by these tests, and no fresh canonical-schema byte-parity claim is made.
- Enumerated capabilities, their manifests, exported skills/agents/injections, command/hook entrypoints and config profiles must remain inside the distribution after realpath resolution. Exported directory descendants are checked too; escapes, dangling links and directory cycles fail. Repository-only tooling cannot satisfy an exported resource.
- Behavioral tests execute the exported CLI against a fake structured OATS boundary. They check argv preservation, canonical CLI selection, effective runtime settings, spawn-envelope failures and temporary task custody. Real temporary Git repositories cover workspace branch reclaim/refusal, while record tests distinguish preparation from accepted watermarks. Inspect tests read large JSON through an actual pipe.

No tests spawn live agents, install capabilities, modify deployments or perform model judgment. Custody assertions about worker instructions do not prove that a worker executed those instructions or delivered a PR.

## Consumer gates still requiring evidence

Before a subsequent release, run isolated installed-artifact probes and record the exact package tag, kernel version, harness versions, commands and outcomes:

1. Acquire → lock/restore → trust → activate → scaffold/retire with the declared minimum kernel and the intended released consumer. Check enumerated skills/agents and operation dispatch, not uninstalled source copies.
2. Exercise actual local-soul, workspace-soul and repo-resident harvests; verify Pi/Claude scaffold parity, selected-runtime behavior, retired-flag/sub-floor rejection, and task-file cleanup through the real consumer boundary.
3. Verify delivery and fresh-reader learning separately from a successful process launch. Record promotion/PR outcomes and reader-visible knowledge; do not count scaffolding alone as that gate.

These probes are **not run by this CI**, and this baseline repair supplies no new consumer-pass evidence. The historical 0.19.0 fixture TODO is superseded by this explicit verification gap, not silently marked passed. Future external-knowledge/directory custody work needs its own acceptance evidence; v1.6.1 does not claim that implementation.
