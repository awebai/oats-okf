import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../oats-package", import.meta.url)));
const packageManifest = JSON.parse(readFileSync(join(ROOT, "oats-package.json"), "utf8"));
const CAPABILITY = join(ROOT, packageManifest.capabilities[0]);
const manifest = JSON.parse(readFileSync(join(CAPABILITY, "oats.json"), "utf8"));
const CLI = join(CAPABILITY, manifest.commands.harvest.trim().split(/\s+/)[0]);

// Do not let the test runner's live instance or Git overrides select a home,
// kernel CLI, repository or hooks. Every boundary below uses isolated fixtures.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OATS_|GIT_)/.test(key)));
const gitEnv = {
  ...cleanEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
function git(repo, args, input) {
  return execFileSync("git", ["-C", repo, ...args], { env: gitEnv, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function initRepo(repo) {
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "--initial-branch=main"]);
  // Synthetic history in a temporary repository; never commit in the checkout.
  const tree = git(repo, ["hash-object", "-t", "tree", "-w", "--stdin"], "");
  const head = git(repo, ["commit-tree", tree], "fixture baseline\n");
  git(repo, ["update-ref", "refs/heads/main", head]);
  return head;
}

// Match package command dispatch: the manifest supplies the entrypoint AND
// fixed argv. User argv is appended; ordinary commands never get OATS_EVENT.
function runSpec(spec, args = [], env = {}, cwd = ROOT) {
  assert.equal(typeof spec, "string", "manifest must declare the executable");
  assert.ok(spec.trim(), "manifest executable must not be empty");
  const [entrypoint, ...fixedArgs] = spec.trim().split(/\s+/);
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(CAPABILITY, entrypoint), ...fixedArgs, ...args], {
      cwd,
      env: { ...gitEnv, ...env },
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    // Decode across pipe chunks; Buffer.toString per chunk can split UTF-8.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => done({ code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

function runCommand(name, args = [], env = {}, cwd = ROOT) {
  assert.ok(Object.hasOwn(manifest.commands || {}, name), `missing command ${name}`);
  assert.equal(Object.hasOwn(env, "OATS_EVENT"), false, "ordinary commands must not inject OATS_EVENT");
  return runSpec(manifest.commands[name], args, env, cwd);
}

function runHook(event, env = {}) {
  const hook = manifest.hooks?.[event];
  return runSpec(typeof hook === "string" ? hook : hook?.command, [], { ...env, OATS_EVENT: event });
}

function runOperation(name, args = [], env = {}, cwd = ROOT) {
  assert.ok(Object.hasOwn(manifest.operations || {}, name), `missing operation ${name}`);
  return runCommand(manifest.operations[name].command, args, env, cwd);
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-okf-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeOatsPath(t) {
  const bin = join(tempDir(t), "bin with spaces");
  mkdirSync(bin);
  const script = join(bin, "oats");
  writeFileSync(script, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.OATS_TEST_CALLS, JSON.stringify(args) + "\\n");
if (args[0] === "capture" || args[0] === "recall") {
  console.log(process.env[args[0] === "capture" ? "OATS_TEST_CAPTURE" : "OATS_TEST_RECALL"] || "{}");
  process.exit(0);
}
if (args[0] !== "spawn") throw new Error("unexpected boundary command");
const taskFile = args[args.indexOf("--task-file") + 1];
fs.writeFileSync(process.env.OATS_TEST_RECORD, JSON.stringify({
  args,
  taskFile,
  task: fs.readFileSync(taskFile, "utf8"),
  taskMode: fs.statSync(taskFile).mode & 0o777,
}));
if (process.env.OATS_TEST_RESPONSE !== undefined) {
  process.stdout.write(process.env.OATS_TEST_RESPONSE);
  process.exit(Number(process.env.OATS_TEST_EXIT || 0));
}
if (process.env.OATS_TEST_ERROR_CODE) {
  console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: process.env.OATS_TEST_ERROR_CODE, message: "synthetic spawn failure" } }));
  process.exit(1);
}
const purpose = args[args.indexOf("--purpose") + 1];
const instance = \`memory-harvest-\${purpose}\`;
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: {
  instance,
  agent: "memory-harvest",
  home: "/synthetic/home",
  work: args[args.indexOf("--work") + 1],
  tmux: { window: instance },
} }));
`);
  chmodSync(script, 0o755);
  return bin;
}

function harvestFixture(t, mode, { model, runtime, errorCode } = {}) {
  const scope = tempDir(t);
  const root = join(scope, "agents");
  const home = join(root, "source", "instances", "source-instance-1");
  const context = join(scope, "context");
  const work = join(home, "work");
  mkdirSync(join(home, "notes"), { recursive: true });
  mkdirSync(context, { recursive: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(home, "notes", "pending.md"), "---\ntype: Lesson\n---\n\nPending.\n");

  let soul = join(home, "soul");
  if (mode === "workspace") {
    const soulRepo = join(scope, "soul repo ' ;");
    initRepo(soulRepo);
    soul = join(soulRepo, "agents", "source", "soul");
  } else if (mode === "repo") {
    initRepo(context);
    soul = join(context, "agents", "source", "soul");
  }
  mkdirSync(soul, { recursive: true });

  const record = join(scope, "spawn-record.json");
  return {
    home,
    context,
    soul,
    record,
    calls: join(scope, "calls.jsonl"),
    env: {
      OATS_HOME: home,
      OATS_ROOT: root,
      OATS_INSTANCE: "source-instance-1",
      OATS_AGENT: "source",
      OATS_SOUL: soul,
      OATS_CONTEXT: context,
      OATS_KIND: mode === "local" ? "local" : "persistent",
      OATS_WORK: mode === "workspace" ? "workspace" : "worktree",
      OATS_SETTINGS: JSON.stringify({ ...(model !== undefined ? { "harvest-model": model } : {}), ...(runtime !== undefined ? { "harvest-runtime": runtime } : {}) }),
      OATS_TEST_RECORD: record,
      OATS_TEST_CALLS: join(scope, "calls.jsonl"),
      OATS_CLI_BIN: join(fakeOatsPath(t), "oats"),
      ...(errorCode ? { OATS_TEST_ERROR_CODE: errorCode } : {}),
    },
  };
}

const argValue = (args, flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

test("soul-scaffold creates an idempotent OKF bundle", async (t) => {
  const dir = tempDir(t);
  const soul = join(dir, "soul");
  const env = { OATS_SOUL: soul, OATS_AGENT: "test-agent", OATS_SETTINGS: "{}" };
  const first = await runHook("soul-scaffold", env);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { meta: { scaffolded: true } });
  assert.match(readFileSync(join(soul, "knowledge", "index.md"), "utf8"), /okf_version: "0.1"/);
  assert.match(readFileSync(join(soul, "knowledge", "log.md"), "utf8"), /knowledge bundle scaffolded/);

  const second = await runHook("soul-scaffold", env);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { meta: { scaffolded: true } });
});

test("spawn creates persistent-instance continuity files", async (t) => {
  const home = tempDir(t);
  const result = await runHook("spawn", {
    OATS_HOME: home,
    OATS_INSTANCE: "test-agent-1",
    OATS_AGENT: "test-agent",
    OATS_KIND: "persistent",
    OATS_TASK: "Exercise the package hook.",
    OATS_REPO: "/tmp/example",
    OATS_BRANCH: "test",
    OATS_WORK: "worktree",
    OATS_SETTINGS: "{}",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).meta.memory, "okf");
  for (const path of ["STATE.md", "log.md", "notes"]) assert.equal(existsSync(join(home, path)), true, `${path} was not scaffolded`);
  assert.match(readFileSync(join(home, "STATE.md"), "utf8"), /Exercise the package hook/);
});

test("harvest implementation uses no private kernel-file boundary", () => {
  const source = readFileSync(CLI, "utf8");
  assert.doesNotMatch(source, /lib\/core\.mjs/);
  assert.doesNotMatch(source, /oats root/);
  assert.doesNotMatch(source, /pathToFileURL|resolveOatsConfig|spawnInstance/);
  assert.match(source, /process\.env\.OATS_CLI_BIN/);
  assert.match(source, /execFile\(packageRuntimeCli\(\)/);
  // Sync capture/recall and branch checks are part of the released runtime.
  // Ban shell-string execution, not argv-safe child_process APIs.
  assert.doesNotMatch(source, /\bexec(?:Sync)?\s*\(|shell\s*:\s*true|return "oats"/);
});

test("baseline exports the readable okf and memory-harvest skill closure", () => {
  // Mirror consumer discovery rather than looking at hard-coded on-disk paths:
  // undeclared bytes, grandchildren and symlinked child directories do not count.
  const hasSkillDoc = (dir) => {
    try { return statSync(join(dir, "SKILL.md")).isFile(); } catch { return false; }
  };
  const skills = new Map();
  for (const declared of manifest.skills || []) {
    const tree = join(CAPABILITY, declared);
    assert.ok(statSync(tree).isDirectory(), `declared skill tree must be a directory: ${declared}`);
    const entries = hasSkillDoc(tree) ? [{ name: basename(tree), dir: tree }] : readdirSync(tree, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && hasSkillDoc(join(tree, entry.name)))
      .map((entry) => ({ name: entry.name, dir: join(tree, entry.name) }));
    assert.ok(entries.length, `declared skill tree contributes no skills: ${declared}`);
    for (const { name, dir } of entries) skills.set(name, { dir, text: readFileSync(join(dir, "SKILL.md"), "utf8") });
  }
  for (const name of ["okf", "memory-harvest"]) {
    assert.ok(skills.has(name), `missing required baseline skill ${name}`);
    assert.match(skills.get(name).text, new RegExp(`^name: ${name}$`, "m"));
    assert.match(skills.get(name).text, /^description:/m);
  }
  const validator = join(skills.get("okf").dir, "scripts/okf-validate.mjs");
  assert.ok(statSync(validator).isFile(), "okf skill must carry its validator");
  assert.ok(readFileSync(validator, "utf8").trim(), "okf validator must be readable and nonempty");
});

test("manifest exports the packaged ephemeral memory-harvest agent", () => {
  const capability = CAPABILITY;
  const manifest = JSON.parse(readFileSync(join(capability, "oats.json"), "utf8"));
  assert.deepEqual(manifest.agents, ["agents/memory-harvest"]);
  const soul = readFileSync(join(capability, manifest.agents[0], "soul.yaml"), "utf8");
  assert.match(soul, /^name: memory-harvest$/m);
  assert.match(soul, /^kind: capability$/m);
  assert.match(soul, /^work: attached$/m);
  assert.match(readFileSync(join(capability, manifest.agents[0], "AGENTS.md"), "utf8"), /Follow the \*\*memory-harvest\*\* skill.*load it before/s);
});

test("spawn leaves capability agents ephemeral", async (t) => {
  const home = tempDir(t);
  const result = await runHook("spawn", {
    OATS_HOME: home,
    OATS_INSTANCE: "memory-harvest-test",
    OATS_KIND: "capability",
    OATS_SETTINGS: "{}",
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).meta.memory, "none");
  assert.equal(existsSync(join(home, "STATE.md")), false);
});

test("harvest skips without notes before requiring the runtime boundary", async (t) => {
  const home = tempDir(t);
  const result = await runCommand("harvest", ["--json"], { OATS_HOME: home, OATS_SETTINGS: "{}" }, home);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: true,
    result: { harvest: "skipped", reason: "no pending notes" },
  });
});

test("harvest rejects a non-absolute OATS_CLI_BIN instead of searching PATH", async (t) => {
  const fixture = harvestFixture(t, "local");
  fixture.env.OATS_CLI_BIN = "oats";
  const result = await runCommand("harvest", ["--json"], fixture.env, fixture.home);
  assert.equal(result.code, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error.code, "E_SPAWN_FAILED");
  assert.match(envelope.error.message, /OATS_CLI_BIN must be an absolute path/);
  assert.equal(existsSync(fixture.record), false, "relative CLI must never execute");
});

test("local-soul harvest spawns attached through the CLI boundary with effective settings", async (t) => {
  const fixture = harvestFixture(t, "local", { model: "test-provider/harvest-model" });
  const result = await runCommand("harvest", ["--json"], fixture.env, fixture.home);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.instance, "memory-harvest-source-instance-1");
  const record = JSON.parse(readFileSync(fixture.record, "utf8"));
  assert.deepEqual(record.args.slice(0, 2), ["spawn", "memory-harvest"]);
  assert.equal(argValue(record.args, "--purpose"), "source-instance-1");
  assert.equal(record.args.includes("--instance"), false, "retired raw-instance flag must never cross the boundary");
  assert.equal(record.args.includes("--ephemeral"), false, "retired ephemeral flag must never cross the boundary");
  assert.equal(argValue(record.args, "--parent"), "source-instance-1");
  assert.equal(argValue(record.args, "--repo"), fixture.context);
  assert.equal(argValue(record.args, "--work"), "attached");
  assert.equal(argValue(record.args, "--work-dir"), realpathSync(join(fixture.home, "work")));
  assert.equal(argValue(record.args, "--model"), "test-provider/harvest-model");
  assert.equal(record.taskMode, 0o600);
  assert.match(record.task, /LOCAL-SOUL/);
  assert.match(record.task, /Do NOT run git commit/);
  assert.match(record.task, /shared tree belongs to the working instance; leave it untouched/);
  assert.equal(record.args.at(-1), "--json");
  assert.equal(existsSync(record.taskFile), false, "task tempfile must be removed after spawn");
});

test("workspace harvest builds a dedicated worktree spawn and defers the model to the harness", async (t) => {
  const fixture = harvestFixture(t, "workspace");
  const result = await runCommand("harvest", ["--json"], fixture.env, fixture.home);
  assert.equal(result.code, 0, result.stderr);
  const record = JSON.parse(readFileSync(fixture.record, "utf8"));
  const soulRepo = realpathSync(resolve(fixture.soul, "..", "..", ".."));
  assert.equal(argValue(record.args, "--repo"), soulRepo);
  assert.equal(argValue(record.args, "--work"), "worktree");
  assert.equal(argValue(record.args, "--branch"), "memory-harvest/source-instance-1");
  assert.equal(argValue(record.args, "--runtime"), "pi");
  assert.equal(record.args.includes("--model"), false);
  assert.equal(record.args.includes("--work-dir"), false);
  assert.match(record.task, /WORKSPACE-MODE/);
  assert.match(record.task, /delivered as a PR/);
  assert.match(record.task, /Do NOT merge it/);
  assert.match(record.task, /Soul knowledge bundle to update: \.\/work\/agents\/source\/soul\/knowledge/);
  assert.equal(record.taskMode, 0o600);
  assert.equal(existsSync(record.taskFile), false);
});

test("repo-resident harvest builds an attached same-tree spawn", async (t) => {
  const fixture = harvestFixture(t, "repo");
  const result = await runCommand("harvest", ["--json"], fixture.env, fixture.home);
  assert.equal(result.code, 0, result.stderr);
  const record = JSON.parse(readFileSync(fixture.record, "utf8"));
  assert.equal(argValue(record.args, "--repo"), fixture.context);
  assert.equal(argValue(record.args, "--work"), "attached");
  assert.equal(argValue(record.args, "--work-dir"), realpathSync(join(fixture.home, "work")));
  assert.equal(argValue(record.args, "--branch"), undefined);
  assert.match(record.task, /ATTACHED to the instance's work tree/);
  assert.ok(record.task.includes(`Soul knowledge bundle to update: ${join(realpathSync(join(fixture.home, "work")), "agents/source/soul/knowledge")}`));
  assert.equal(record.taskMode, 0o600);
  assert.equal(existsSync(record.taskFile), false);
});

test("harvest propagates schema-v1 spawn errors and still removes the task file", async (t) => {
  const fixture = harvestFixture(t, "local", { errorCode: "E_PARENT_NOT_FOUND" });
  const result = await runCommand("harvest", ["--json"], fixture.env, fixture.home);
  assert.equal(result.code, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "E_PARENT_NOT_FOUND");
  const record = JSON.parse(readFileSync(fixture.record, "utf8"));
  assert.equal(record.taskMode, 0o600);
  assert.equal(existsSync(record.taskFile), false);
});

const spawnRecord = (f) => JSON.parse(readFileSync(f.record, "utf8"));
const calls = (f) => readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse);
const pendingNote = (f) => readFileSync(join(f.home, "notes/pending.md"), "utf8");

for (const runtime of ["claude", "codex"]) {
  test(`harvest passes a native ${runtime} model without adding a Pi provider`, async (t) => {
    const f = harvestFixture(t, "local", { runtime, model: "native-model" });
    const result = await runCommand("harvest", ["--json"], f.env, f.home);
    assert.equal(result.code, 0, result.stderr);
    const { args } = spawnRecord(f);
    assert.equal(argValue(args, "--runtime"), runtime);
    assert.equal(argValue(args, "--model"), "native-model");
  });
}

for (const settings of [
  { runtime: "unknown" }, { model: "   " },
  { runtime: "claude", model: "provider/model" },
  { runtime: "codex", model: "provider/model" },
]) {
  test(`harvest rejects invalid runtime settings ${JSON.stringify(settings)} before dispatch`, async (t) => {
    const f = harvestFixture(t, "local", settings);
    const before = pendingNote(f);
    const result = await runCommand("harvest", ["--json"], f.env, f.home);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "E_HARVEST_SETTINGS");
    assert.equal(existsSync(f.calls), false);
    assert.equal(pendingNote(f), before);
  });
}

test("spawn argv preserves shell metacharacters as data and keeps task text out of argv", async (t) => {
  const model = "provider/model; touch argv-injected";
  const f = harvestFixture(t, "local", { model });
  const parent = "source ' ; touch parent-injected #";
  f.env.OATS_INSTANCE = parent;
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 0, result.stderr);
  const record = spawnRecord(f);
  assert.equal(argValue(record.args, "--model"), model);
  assert.equal(argValue(record.args, "--parent"), parent);
  assert.equal(argValue(record.args, "--purpose"), "source-touch-parent-injected");
  assert.equal(record.args.includes("--task"), false);
  assert.ok(record.args.every((arg) => !arg.includes("Source notes:")));
  assert.equal(record.taskMode, 0o600);
  assert.equal(existsSync(record.taskFile), false);
  for (const name of ["argv-injected", "parent-injected"]) assert.equal(existsSync(join(f.home, name)), false);
});

test("missing canonical CLI does not fall back to a working oats on PATH", async (t) => {
  const f = harvestFixture(t, "local");
  f.env.PATH = `${resolve(f.env.OATS_CLI_BIN, "..")}:${process.env.PATH}`;
  delete f.env.OATS_CLI_BIN;
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 1);
  assert.match(JSON.parse(result.stdout).error.message, /OATS_CLI_BIN is required/);
  assert.equal(existsSync(f.calls), false);
});

for (const [response, exit] of [
  ["not JSON", 0],
  [JSON.stringify({ schemaVersion: 2, ok: true, result: { instance: "fake" } }), 0],
  [JSON.stringify({ schemaVersion: 1, ok: true, result: {} }), 0],
  [JSON.stringify({ schemaVersion: 1, ok: true, result: { instance: "fake" } }), 1],
]) {
  test(`invalid spawn outcome (${response}, exit ${exit}) preserves notes and cleans task custody`, async (t) => {
    const f = harvestFixture(t, "local");
    const before = pendingNote(f);
    f.env.OATS_TEST_RESPONSE = response;
    f.env.OATS_TEST_EXIT = String(exit);
    const result = await runCommand("harvest", ["--json"], f.env, f.home);
    assert.equal(result.code, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "E_SPAWN_FAILED");
    const record = spawnRecord(f);
    assert.equal(record.taskMode, 0o600);
    assert.equal(existsSync(resolve(record.taskFile, "..")), false);
    assert.equal(pendingNote(f), before);
  });
}

test("workspace harvest refuses unmerged promotion history without dispatch or direct-write fallback", async (t) => {
  const f = harvestFixture(t, "workspace");
  const repo = resolve(f.soul, "../../..");
  const base = git(repo, ["rev-parse", "HEAD"]);
  const tree = git(repo, ["rev-parse", "HEAD^{tree}"]);
  const unfinished = git(repo, ["commit-tree", tree, "-p", base], "unfinished promotion\n");
  const branch = "refs/heads/memory-harvest/source-instance-1";
  git(repo, ["update-ref", branch, unfinished]);
  writeFileSync(join(f.soul, "sentinel.md"), "canonical soul must not change\n");
  const before = pendingNote(f);
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "E_HARVEST_BRANCH_EXISTS");
  assert.equal(existsSync(f.calls), false);
  assert.equal(git(repo, ["rev-parse", branch]), unfinished);
  assert.equal(git(repo, ["rev-parse", "HEAD"]), base);
  assert.equal(readFileSync(join(f.soul, "sentinel.md"), "utf8"), "canonical soul must not change\n");
  assert.equal(pendingNote(f), before);
});

test("workspace harvest reclaims only a branch already merged into the accepted base", async (t) => {
  const f = harvestFixture(t, "workspace");
  const repo = resolve(f.soul, "../../..");
  const head = git(repo, ["rev-parse", "HEAD"]);
  const branch = "refs/heads/memory-harvest/source-instance-1";
  git(repo, ["update-ref", branch, head]);
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /deleted stale harvest branch/);
  assert.equal(git(repo, ["for-each-ref", "--format=%(refname)", branch]), "");
  assert.equal(git(repo, ["rev-parse", "HEAD"]), head);
  assert.equal(argValue(spawnRecord(f).args, "--work"), "worktree");
});

test("workspace mode without a Git soul skips rather than pretending directory custody is implemented", async (t) => {
  const f = harvestFixture(t, "local");
  f.env.OATS_KIND = "persistent";
  f.env.OATS_WORK = "workspace";
  const before = pendingNote(f);
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).result, {
    harvest: "skipped", reason: "workspace-mode soul is not inside a git repo — nowhere to deliver a PR",
  });
  assert.equal(existsSync(f.calls), false);
  assert.equal(pendingNote(f), before);
});

function recordFixture(t, options = {}) {
  const f = harvestFixture(t, "local", options);
  rmSync(join(f.home, "notes/pending.md"));
  const thread = "thread ' ; touch record-injected #";
  const after = "previous ' ; turn";
  const until = "next ' ; turn";
  const watermark = join(f.home, ".okf-harvest-record.json");
  const next = join(f.home, ".okf-harvest-record.next.json");
  const original = JSON.stringify({ threads: { [thread]: { untilTurnId: after, turns: 4 } } });
  writeFileSync(watermark, original);
  f.env.OATS_TEST_CAPTURE = JSON.stringify({ sessions: [{ thread, source: "fixture", lastTurnId: "later" }] });
  f.env.OATS_TEST_RECALL = JSON.stringify({ turns: [
    { id: "first", bytes: 10 }, { id: until, bytes: 10 }, { id: "later", bytes: 10 },
  ], remaining: 3 });
  f.env.OATS_SETTINGS = JSON.stringify({ "record-window-bytes": 21 });
  return { ...f, thread, after, until, watermark, next, original };
}

test("record-fed harvest uses literal capture/recall argv and prepares only a bounded, unaccepted watermark", async (t) => {
  const f = recordFixture(t);
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(calls(f).slice(0, 2), [
    ["capture", "--home", f.home, "--quiet"],
    ["recall", "--thread", f.thread, "--json", "--ids-only", "--limit", "60", "--after", f.after],
  ]);
  assert.equal(calls(f)[2][0], "spawn");
  assert.equal(readFileSync(f.watermark, "utf8"), f.original, "dispatch is not delivered judgment");
  const next = JSON.parse(readFileSync(f.next, "utf8"));
  assert.equal(next.threads[f.thread].untilTurnId, f.until);
  assert.equal(next.threads[f.thread].turns, 6);
  assert.deepEqual(next.pendingHarvest.windows, [{ thread: f.thread, afterTurnId: f.after, untilTurnId: f.until }]);
  assert.match(spawnRecord(f).task, /4 more wait for the next harvest/);
  assert.equal(existsSync(spawnRecord(f).taskFile), false);
  assert.equal(existsSync(join(f.home, "record-injected")), false);
});

test("failed record dispatch leaves the accepted watermark untouched and does not stamp a successful worker", async (t) => {
  const f = recordFixture(t, { errorCode: "E_PARENT_NOT_FOUND" });
  const result = await runCommand("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).error.code, "E_PARENT_NOT_FOUND");
  assert.equal(readFileSync(f.watermark, "utf8"), f.original);
  assert.equal(JSON.parse(readFileSync(f.next, "utf8")).pendingHarvest, undefined);
  assert.equal(existsSync(spawnRecord(f).taskFile), false);
});

test("baseline harvest operation dispatches its declared command without a hook event", async (t) => {
  const f = harvestFixture(t, "local");
  const result = await runOperation("harvest", ["--json"], f.env, f.home);
  assert.equal(result.code, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.result.harvest, "spawned");
  assert.equal(envelope.result.instance, "memory-harvest-source-instance-1");
  assert.equal(argValue(spawnRecord(f).args, "--work"), "attached");
});

for (const [route, dispatch] of [["command", runCommand], ["operation", runOperation]]) {
  test(`baseline inspect ${route} sends complete large JSON through a pipe and labels provider-side truncation`, async (t) => {
    const home = tempDir(t);
    const state = "knowledge α\n".repeat(10000); // exceeds the old 64 KiB pipe failure
    const note = "bounded note\n".repeat(30000); // exceeds the per-document 256 KiB cap
    writeFileSync(join(home, "STATE.md"), state);
    mkdirSync(join(home, "notes"));
    writeFileSync(join(home, "notes/large.md"), note);
    const result = await dispatch("inspect", ["--json"], { OATS_HOME: home }, home);
    assert.equal(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    const [stateDoc, noteDoc] = envelope.result.documents;
    assert.equal(stateDoc.text, state);
    assert.equal(stateDoc.truncated, undefined);
    assert.equal(noteDoc.text, Buffer.from(note).subarray(0, 256 * 1024).toString("utf8"));
    assert.equal(noteDoc.truncated, true);
    assert.equal(noteDoc.bytes, Buffer.byteLength(note));
  });
}
