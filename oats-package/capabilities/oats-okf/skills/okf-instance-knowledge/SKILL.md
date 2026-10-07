---
name: okf-instance-knowledge
description: >-
  Keeping this instance's own knowledge (STATE.md, log.md, notes/) with
  judgment: the capture test, what is worth writing down and what is not,
  one concept per note with type, claim, why, evidence and generality, when to
  write (at the decision, before compaction, before a task boundary, at a
  checkpoint), how a note cites the soul knowledge it confirms or
  contradicts, and how to propose durable knowledge at an important
  checkpoint (a short self-contained proposal and a direct
  oats.okf/knowledge-harvester spawn). Use at the start of every task, when a
  decision is taken or rejected, when something costs effort to find out,
  when a human corrects you, before compaction, at a checkpoint, and before
  finishing a task.
---

# Instance knowledge

Your instance knowledge is your working memory: what you are doing, what
happened, and what you learned. It lives in instance home (not ./work):
- **STATE.md**: the current task picture, **rewritten** as it changes. What
  the task is, where it stands, what is decided, what is blocked. `# Next`
  names ONE next step.
- **log.md**: dated significant events, **append-only**. Never rewrite
  history.
- **notes/**: **one concept per insight**, one Markdown file each.

Your future self reads it after compaction. At a checkpoint you may propose
what you learned, and a knowledge harvester reads your proposal and the notes
it names to decide what becomes soul knowledge. Write for both.

## The capture test

> Would my future self after compaction, or a harvester judging a proposal
> of mine, decide or act better for having it — and is it absent from the
> code, the tracker and the repository docs?

Both halves must hold. The capture bar is lower than the promotion bar: you
capture what might matter; the harvester promotes what does. Do not
self-censor a real decision because it might not be promoted.

## Capture

- **Decisions taken, and why.** The why is the part that dies with you.
- **Alternatives rejected, and why.** Code shows the outcome, never the road
  not taken; without this, a later instance "helpfully" takes it.
- **Discoveries that cost effort**: facts about the world that were written
  nowhere.
- **Limitations, and the workaround that worked.**
- **Conclusions of an investigation**, not its transcript.
- **Blockers**, with what they block and what unblocks them.
- **Human direction and corrections**, as you understood them, with when.
- **Surprises**: the world behaved differently from what your soul knowledge
  says. That is a *candidate supersession*: flag it as one and cite the
  concept it contradicts.
- **Process and environment lessons** the repository cannot express.

## Don't capture

- Descriptions of the code, or maps of the repository: code is the truth
  about code, and a stored description drifts and lies.
- Command logs and tool output; retries that taught nothing.
- Secrets and credentials, however they appear.
- Third-party messages verbatim (a lesson *about* one is fine).
- What the tracker or the docs already hold: link to it instead.

## The form of a note

```markdown
---
type: Decision            # Decision | Rejected | Discovery | Limitation | Conclusion | Lesson | Blocker
title: Retry budget is per request, not per connection
description: One-line claim, the sentence an index would show.
generality: soul          # instance (true only for this task) | soul (likely true for the soul) — a hint, not a verdict
observed: 2026-09-26, load test on the staging cluster (turns around the 14:10 run)
---

The claim, then **why**: the reasoning, the alternatives, the evidence.
Relates to: oats/expert/decisions/retries.md@5b6a9cab (refines it).
```

- A one-line claim in `description`; the *why* in the body.
- Evidence and provenance: what was observed, when, from what.
- **Generality** tells the harvester whether you think it outlives the task.
- A note that confirms, refines or contradicts soul knowledge **cites it**
  (`alias/node/concept.md@<short-oid>`, from `oats okf`'s receipt). That is
  what lets the harvester situate it.

## When

- **At the decision, as it happens.** A decision reconstructed at the end has
  lost its why.
- **Before compaction** and **before a task boundary**: update STATE.md and
  log.md, and write the notes you have been meaning to write.
- **At an important checkpoint** (a decision made, a PR opened or handed
  over, a task finished): first update STATE.md, log.md and the relevant
  notes, then decide whether to propose (below). Retirement is not a
  checkpoint of its own: propose before you hand over, not after.
- **Consult first**: before writing a note, check notes/ and `oats okf search`
  so you refine or cite rather than duplicate.

## Proposing knowledge at a checkpoint

Soul knowledge changes only through a reviewed PR. You do not write it: you
**propose**, a knowledge harvester judges and opens the PR, and the
knowledge maintainer reviews it.

**When.** At an important checkpoint, when something you learned passes the
promotion test (**knowledge-theory**): it would change how a future instance
of your soul decides or acts, and it is not already in the code, the tracker,
the docs or the accepted knowledge (`oats okf search` first). Most
checkpoints have nothing to propose; that is fine. Propose one coherent
topic per proposal.

**Write the proposal** as a Markdown file in your instance home, for example
`proposals/<YYYY-MM-DD>-<slug>.md`. It becomes the harvester's TASK, so it
must stand on its own: the harvester never sees your session.

```markdown
# OKF proposal: <one-line claim>

Source: instance <your instance name>, home <your instance home>, soul <your soul's name>

## What
The claim(s), one concept each, in a sentence or two.

## Why
Why it outlives this task: the decision it informs, the mistake it prevents.

## Evidence
What was observed, when, by whom; the soul knowledge it confirms, refines or
contradicts (`alias/node/concept.md@<short-oid>`); task refs (ABC-123).

## Backing notes
- notes/<file>.md   (optional; paths relative to your instance home)
```

- **Self-contained.** What, why and evidence are in the proposal. The named
  notes back it; they are not a list of everything to capture, and the
  harvester reads only the notes you name, never STATE.md, log.md, other
  notes, your transcript or anything else of your home.
- **No secrets, credentials or private paths** in the claim, why or evidence:
  they could reach a PR. Your home path appears only on the `Source:` line,
  for the harvester to find your record; it is never published.
- The `Source:` line is a pointer, not authority. The harvester checks it
  against the deployment's own records (your instance record, your soul's
  okf.json, the bindings) and takes your owner, owned nodes and bases from
  those, never from the proposal.

**Spawn the harvester** from your instance home:

```sh
oats spawn oats.okf/knowledge-harvester --task-file proposals/<file>.md --relation unrelated
```

- `--relation unrelated` alone: the harvester is a top-level instance that
  outlives you; it is not your child, and there is no `--relative-to`.
- The kernel picks the harvester's harness and model from its own defaults
  (the package soul, then the workspace and host): pass none.
- One spawn per proposal. If the spawn is refused, report the refusal to your
  human and do not retry it in a loop. Never use a wrapper, `--yolo` or a
  permission bypass to make it start.
- Note the proposal in log.md (date, file, harvester instance). Keep the
  backing notes until the harvester has handed over its PR: if a note is gone
  when it reads it, it drops the claim that needed it.

## The theory, briefly

- **Decision versus description.** A decision is superseded explicitly, and
  the new one names the old; a description goes stale silently. Capture
  decisions, not descriptions.
- **Code is truth about code.** Anything a fresh instance could learn from
  the repository in ten minutes is not worth your note.
- **Indexical residue dies with the instance.** "Was working on X", "the PR
  from this morning" mean nothing to anyone else. Write the durable claim
  underneath it, or nothing.
