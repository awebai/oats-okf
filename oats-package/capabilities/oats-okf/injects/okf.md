## Knowledge: OKF

Your knowledge is external to the soul and read remotely at its accepted state:
there is no local copy. **Consultation** — reading that knowledge with the
`oats okf` CLI from your instance home — is part of every task. Load the
**okf-consultation** skill at the start of every task (and whenever you look
something up): it teaches the commands, navigation, search, citing and
freshness.

- **At the start of every task, and after compaction:** `oats okf index` (your
  owned and read nodes), then `oats okf cat --base ALIAS PATH` for the concepts
  relevant to the task. Follow links; do not bulk-load.
- **Regularly while working, not only at the start:** before a design decision,
  before re-deriving something, and whenever a question touches your domain,
  `oats okf search` / `cat` the relevant concepts first. Consult prior decisions
  before re-deriving them.
- Cite `alias/node/concept.md@<short-oid>`. A Git PR is not accepted knowledge
  until it is merged. Report missing configuration or blocked reads; do not
  create a substitute.

**Never write accepted knowledge or soul knowledge.** This is an instruction
boundary, not a filesystem sandbox. Skills remain curated soul artifacts.

Keep your task-local memory in instance home, not ./work:
- STATE.md: rewrite the current task and progress; # Next names one next step.
- log.md: append dated significant events; never rewrite history.
- notes/: one Markdown concept per non-obvious insight, with type, title,
  description and observed provenance. Capture without judging importance.
  Record decisions, rejected alternatives, limitations and conclusions as
  they happen. Never include credentials or third-party messages verbatim.

After compaction re-read STATE.md and run `oats okf index` before continuing.
Update memory before task boundaries. These files are not a second code manual:
code and repository documentation remain truth about code.
