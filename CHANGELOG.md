# Changelog

## 4.0.1 — 2026-09-27

### Security

- **Arbitrary file write from a crafted base tree (fixed; affects 3.0.0 and
  4.0.0).** Validating a Git base's accepted commit copied every tree entry to
  `join(scratch, name)` with no containment check. Git accepts literal `..`
  entries (`hash-object --literally`), and they survive the bare partial
  clone. So the first `oats okf bases` or spawn against a crafted accepted
  commit could create any not-yet-existing file, with attacker content,
  anywhere the user can write.
  - Every tree entry is now checked against the canonical path rules (no
    `..`, absolute path, backslash, NUL, control character, percent-escape or
    `.git` segment).
  - The resolved target must stay inside the scratch, and all entries are
    checked before anything is written. The first bad entry refuses the whole
    base with `E_PATH`.
  - The staging materializer asserts the same containment.
  - GitHub's receive checks probably block such a push; local and self-hosted
    bases do not.
  - **Upgrade from 3.0.0 or 4.0.0.**

### Fixes

- **Credentials are never shown to agents** (#16).
  - A repository URL with userinfo (`https://user:token@…`) is refused at
    binding; use a Git credential helper or an SSH key.
  - Every repository shown in `bases` output and in errors is redacted
    (`displayRepo`/`redactUrls`), including Git's own failure text.
- **`review-context --checkout` trusts only the accepted base.**
  - Node ownership comes from `okf-base.json` at `origin/<base>`, never from the
    PR head or the PR body.
  - The owned nodes are the accepted nodes whose owner is the source's owner.
    The harvester now records `source.owner` in the provenance; a 4.0.0 PR
    without it falls back to `source.soul`.
  - Nodes the provenance claims but the source does not own are listed
    (`claimedNotOwned`).
  - Any change to `okf-base.json` is outside the owned nodes (`baseMetaChanged`).
  - A provenance base root containing `..` or an absolute path is refused.
- **The merge is tied to the reviewed head:** `gh pr merge … --squash
  --match-head-commit <headSha>`, after a final `review-context`.
- **`okf-needs-human` is a hard stop.** `review-context` reports
  `blocked: "needs-human"` and `settled: true` for any event (opened,
  reopened, ready_for_review), and knowledge-review stops at step 1. Only a
  human removing the label clears it.
- **`run-source` and `retire` re-read the harvest switch, soul included.**
  - A soul that adds `knowledge: { harvest: off }` after spawn, or a
    deployment that turns harvest off, stops capture at the next `run-source`.
  - Retire then takes no final capture; inputs already in custody stay.
  - Registration records the soul directory for this re-read.
- **`OATS_SETTINGS_ORIGINS` (kernel 0.29.0) is read as an extra signal.** A
  harvest value whose origin is the soul never switches harvest on.
  - Origins name only the last layer, and the host's settings merge after the
    soul's. So a host `harvest: on` hides a soul's `off` there, and `soul.yaml`
    stays the authority for the absolute opt-out.
  - `OATS_SETTINGS_ORIGINS` is stripped from child processes like
    `OATS_SETTINGS`.

## 4.0.0 — 2026-09-26

Knowledge operations: the oats.okf-harvest and oats.okf-maintenance
capabilities, the knowledge-harvester and knowledge-maintainer package souls,
the harvest-review trigger template, the harvest switch, and provenance-carrying
harvest PRs. See the README.
