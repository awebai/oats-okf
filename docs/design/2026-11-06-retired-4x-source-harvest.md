# Design: harvesting a retired 4.x seat's notes under oats.okf 5.x (#125)

Status: design for decision, nothing built. Lane `lane:setup`; maintainer
setup-maintainer-pepe. Written against the released `v5.8.0`
(`cfc595a9edea`), whose harvester source gate is byte-identical to
`v5.7.0`, the version the reporting deployment pins. Kernel facts are from the
OATS 0.69.12 documentation.

Issue: [#125](https://github.com/awebai/oats-okf/issues/125). Related:
[#99](https://github.com/awebai/oats-okf/issues/99),
[#100](https://github.com/awebai/oats-okf/issues/100).

## 1. The gap, stated precisely

A seat spawned on oats.okf 4.x recorded the 4.x `harvest` setting in its
`instance.json` (`providers['oats.okf'].harvest`, with its origin in the
`oats.okf` capability entry's `settingsOrigins`). When the deployment set
the switch, the origin is `host` (or `spawn`, `workspace`); when nobody did,
it is `manifest-default`.

The harvester's required spawn hook (`oats-package/capabilities/oats-okf-harvest/lib/source-snapshot.mjs`,
`checkSource`) does, in this order:

1. resolves the source: a live home, else the completed retirement recovery
   copy named by the kernel's `retired` event (single known incarnation);
2. reads the recorded soul snapshot (`record.soulDir/soul.yaml`) and refuses
   `E_OPTED_OUT` on `harvest: off` anywhere in that text;
3. loops over the record's `harvest`, `harvest-runtime`, `harvest-model`
   keys: origin `manifest-default` is ignored; `harvest: off` from `soul` is
   `E_OPTED_OUT`; **any other key with any other origin, or a key with no
   recorded origin, is `E_SOURCE`** ("a setting removed in oats.okf 5.0 that
   the source itself refuses; its authority cannot be established").

Step 3 is where every 4.x seat of a deployment that had `harvest: on` (or an
explicit `off`) refuses. The 5.0.0 design (PR #58) intended it: "Host cleanup
does not erase explicit keys recorded in old homes: those sources need
respawn before 5 harvest." But a record is never rewritten, and respawn means
retire then spawn: the old notes land in the retirement recovery copy, whose
`instance.json` still carries the key, so the same `E_SOURCE` follows. The
respawn route never carried a 4.x seat's notes anywhere. That is the gap.

Two further facts bound the design:

- **4.x had the same soul opt-out.** v4.0.5 README: "A soul may only opt
  out, with `knowledge: { harvest: off }` in soul.yaml, and the opt-out is
  absolute. It is read from the soul's own soul.yaml, because the kernel's
  merged settings are later-wins." The host switch was the deployment's
  consent to 4.x's own machinery (source registration, transcript capture,
  scheduled runs), all of which 5.x removed. 5.x doctrine (README, "What is
  enforced"): "It is per soul. No instance, note, host or spawn setting opts
  out."
- **Step 2 is independent of step 3 and of the host switch.** The merged
  record value can be masked (a host `on` hides a soul `off` in
  `providers`), the soul.yaml text cannot. So step 3 never protected the
  opt-out; it protected record/5.0 consistency.

## 2. Options judged

**A. Admit a retired 4.x record whose removed keys came from a non-soul
layer** (the issue's option, narrowed). For a source resolved through the
retirement recovery, a removed key whose recorded origin is any layer other
than `soul` (`host`, `spawn`, `workspace`, …) is ignored exactly as
`manifest-default` is today. Everything else is unchanged: soul-origin `off`
stays `E_OPTED_OUT`; a soul-origin value other than `off`, and a key with no
recorded origin, stay `E_SOURCE`. The opt-out continues to come from the
recorded soul.yaml (step 2), not from `okf.json` as the issue phrases it:
`okf.json` holds owner/owns/reads and has never carried the opt-out.

**B. No code change: re-propose from a live 5.x seat.** Spawn a 5.x
instance of the same soul, hand it the recovery copy's notes, let it
re-judge and propose under its own name. Rejected as *the* route: the
proposal's `Source:` then names an instance that did not do the work, the
provenance block cannot say otherwise (the maintainer's parser refuses
unknown keys), someone copies files between homes by hand, and for ~15 seats
it multiplies spawns. It remains available to anyone today and needs no
decision; the README can say so as a fallback, not as the route.

**C. Admit live 4.x records the same way.** Semantically the host key has no
more authority on a live record than on a retired one. Not recommended now:
a live 4.x home has a route (retire it; the recovery is then the source),
the 5.0.0 refusal on live records was a deliberate upgrade nudge accepted by
both maintainers, and widening it is not needed for the reporting case.
Instead, the live refusal's message gains the remedy: *retire the home, then
propose from its recovery*. If both sides prefer one rule for live and
retired, A extends to live records by dropping one condition; the invariant
argument in §3 is the same.

**D. Make `--preview` refuse like the spawn.** Not possible in the provider:
the kernel runs no spawn hook in a preview (OATS docs, configuration.md:
"the argv comes from the provider's spawn hook, which a preview does not
run"; only launch hooks have a preview phase, `launchPreview`). A
spawn-preview hook phase is a kernel ask. Our hook already separates the
read-only `checkSource` from the writing `snapshotSource`, so adopting such a
phase would be cheap. Recommended as a written ask to the kernel owner, not a
dependency of this work.

**E. A read-only pre-check command**, e.g. `oats okf-harvest check
--task-file <proposal>` dispatched from the deployment with
`--soul oats.okf/knowledge-harvester`, running `checkSource` only and
printing the verdict the spawn hook would give. Advisory (the spawn re-checks
at apply). Cost: the capability currently declares "no commands of its own";
command dispatch must supply `OATS_CLI_BIN` and `OATS_WORKSPACE` (the kernel
documents both for dispatched commands; to verify at build). Benefit: a
refusal found before a spawn, which matters because a rolled-back harvester
spawn can leave its messaging alias occupied and the procedure forbids
reusing the name. Optional; recommended if the aweb side wants it for the
batch of ~15.

## 3. Recommendation

**A, plus documentation, plus the plain `--preview` statement.** D as a
kernel ask; E optional, decided by the requester's need.

### 3.1 The rule (what the hook will do)

In `checkSource`, after the soul.yaml opt-out check, for each removed key
present in `providers['oats.okf']`:

| recorded origin of the key | live source | retired source (recovery) |
|---|---|---|
| `manifest-default` | ignored (today) | ignored (today) |
| `soul`, `harvest: off` | `E_OPTED_OUT` (today) | `E_OPTED_OUT` (today) |
| `soul`, any other value or key | `E_SOURCE` (today) | `E_SOURCE` (today) |
| `host`, `spawn`, `workspace`, any other named layer | `E_SOURCE`, message gains the remedy "retire the home, then propose from its retirement recovery" | **ignored (new)** |
| no recorded origin | `E_SOURCE` (today) | `E_SOURCE` (today) |

The snapshot's private `source.json` records what was ignored
(`legacyKeysIgnored: ["harvest"]`), so the harvester and a later reader can
see the admission was a 4.x-record one. No provenance-block field changes
(the maintainer's parser is strict).

**One fail-closed addition, separable:** refuse `E_SOURCE` when the recorded
soul.yaml carries a `harvest:` value other than `off`. 4.x treated a soul
`harvest: on` as off ("also reported"); 5.x refuses such a soul at spawn.
Today a masked soul `on` (host `off` wins in the record) passes step 2 and,
under A, would be admitted. The addition keeps 4.x's reading. False positives
(the word in a comment) fail closed, as the existing `harvest: off` regex
already does.

### 3.2 Why the opt-out invariant holds

"Never harvest a seat whose soul opted out" is decided by step 2, from the
soul snapshot the kernel copied at spawn (retire removes no soul copy; the
reporting case read it after retirement), by text match, unmasked by any layer. A is a change to step 3 only, for keys whose
origin is not the soul. The two cases where a soul's `off` is not in the
soul.yaml text do not exist: 4.x and 5.x both define the opt-out as that
text. If the soul snapshot is gone, step 2 cannot read it and the hook
refuses (ENOENT surfaces as a refusal); it never infers "not opted out".

What A does **not** make a privacy barrier: the accepted decision
`oats/oats-okf-expert/decisions/personal-data-exclusion-is-not-a-publication-guarantee.md@acb4713bae82`
still holds; the opt-out is per soul and checks the recorded source, and the
content screen and maintainer review remain the publication controls.

### 3.3 Coverage of #99 and #100

- **#99, retired seats of a deployment that had `harvest: off`:** covered.
  Their record carries `harvest: off` from `host`; under A it is ignored and
  the soul decides. This follows 5.x doctrine (a host `off` is not an
  opt-out); it is a judgement the two sides should confirm explicitly,
  because under 4.x that deployment had declined 4.x's machinery.
  **#99's live-home asks** (`harvest --home` binding, context, dropping a
  half-registered source) are 4.x machinery that answers `E_REMOVED` in
  5.x: excluded.
- **#100, item 3 (homes a 4.0.5 hook keeps from retiring):** covered once
  the kernel's `oats retire <instance> --force` has run. `--force` does not
  skip work preservation (kernel docs), the recovery reaches `phase:
  complete` after the post-hook check, and the `retired` event names it; the
  record then carries `harvest: on` from `host`, which A ignores. A recovery
  left at `phase: before-hooks` still refuses (today's rule, unchanged). The
  context fix #100 asks for is 4.x code and excluded.
- The 4.x custody under `<stateDir>/sources/` is never read by this route;
  the README's "4.x source records after the pin" keeps governing its
  removal.

### 3.4 `--preview` (item 2)

Say it plainly, in three places: README ("What the harvester does", step 2
or 3), the `okf-propose` skill where it prescribes preview-then-apply, and
the `knowledge-harvest` skill's source section:

> `oats spawn --preview` runs no provider hook: it shows the harvester's
> composition, not the source check. The source is checked at apply, in the
> required spawn hook; a refusal rolls the spawn back and leaves no
> harvester home, but the chosen name may stay occupied as a messaging
> alias.

Plus the kernel ask (D) and, if wanted, E.

### 3.5 README line (item 3)

Under "Upgrading to 5.0", a new bullet after "Explicitly set removed keys",
and a cross-reference from "4.x source records after the pin":

> **A retired 4.x seat's notes: propose from its retirement recovery.** Its
> record keeps the 4.x keys, so it cannot be respawned into a 5.x source;
> write a proposal in the shape above naming the retired instance, its home
> and soul, and `incarnation` copied from the recovery copy's
> `instance.json` `createdAt`; list its notes under `## Backing notes`; spawn
> the harvester. From 5.x.y the harvester ignores a removed key the host,
> the spawn or the workspace set on a **retired** source; the soul's own
> `knowledge: { harvest: off }`, read from the recorded soul snapshot, still
> refuses, and so does a soul `harvest:` value other than `off` or a key with
> no recorded origin. Needs: the recovery at `phase: complete` and kept until
> capture, the soul snapshot (`agents/<soul>/souls/<commit>`) still present,
> complete event history (OATS >=0.49.0). A live 4.x home is still refused:
> retire it first. `--preview` does not run this check.

### 3.6 Verification

- Unit: the existing `okf4-instance-record.json` fixture through
  `retiredSource()` with origins `host`, `spawn`, `workspace`, and no origin;
  soul `off` masked by host `on`; soul `on` masked by host `off`; the live
  record keeps refusing with the new remedy. These prove the hook's logic
  against a fake kernel history (what the fake must model: the `retired`
  event with `workRecovery`, `recovery.json` phases, `settingsOrigins`).
- Acceptance: one rehearsal on a real retired 4.x seat in the reporting
  deployment on the released version, by the aweb side, before the batch:
  proposal written, `--preview`, apply, `harvest-source/source.json` shows
  `from: recovery` and `legacyKeysIgnored`, the harvester judges and opens
  or declines. A fixture cannot stand in for the real kernel's event history
  of a 4.x-era spawn. The real-kernel CI job has no 4.x-spawned seat; it is
  not extended for this.

### 3.7 Limits

- Kernels that recorded no `incarnation` on the seat's events (before
  `eventsApi 2`) still refuse ("empty or unknown incarnations"); not ours to
  change.
- A recovery at `before-hooks`, a missing soul snapshot, a reused instance
  name without a single retired incarnation: refused as today.
- The proposal for a retired seat is written by someone else; "a valid
  instance and soul pair proves consistency, not authorship" applies, and the
  harvester's promotion judgement and the maintainer's review stay the
  gates. The personal-data exclusion applies to those proposals as to any.

## 4. Decisions asked of both sides

1. Accept A (retired only, non-soul origins ignored, `source.json` notes it)?
2. Accept the separable fail-closed addition (soul `harvest:` other than
   `off` refuses)?
3. Confirm #99's reading: a 4.x host `harvest: off` is not an opt-out.
4. Live records: keep refusing with the new remedy (recommended), or one rule
   for live and retired (C)?
5. `--preview`: documentation now; file the kernel ask (D); add the
   pre-check command (E) or not.
6. Release: a minor (`5.9.0`), since admission widens; no kernel floor
   change.
