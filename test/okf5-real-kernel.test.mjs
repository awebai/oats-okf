// oats.okf 5.0.0 on the REAL released kernel (@awebai/oats 0.44.0). CI-only:
// it runs only when OATS_OKF_REAL_CLI names that kernel's bin/oats.mjs (the
// real-kernel-044 CI job installs it and fails on any skip).
//
// Evidence boundary. What is real: the released kernel's sync, operator and
// in-home command dispatch, spawn (soul resolution, module materialization,
// skill composition, the oats.okf spawn hook, the TASK.md copy, lineage) and
// retire; this checkout's oats-package, pinned by commit from a file:// Git
// remote; a real Git knowledge base (a bare repository on disk). What is NOT
// exercised: no model (pi/claude/codex on PATH are fakes that record being
// asked and exit 98, and every spawn is --no-launch), no GitHub (the harvest
// PR is not opened; its v2 provenance block is built from the records and
// checked with this checkout's parser), no messaging (messaging: none, tasks:
// none, oats.core off), no network, host timer or production setting. HOME,
// OATS_HOME_DIR and every repository live in one temporary directory.
//
// One fixture, ordered steps (a)-(e): each subtest is one concern and builds
// on the state the previous one left, as a deployment would live through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseProvenance } from '../oats-package/capabilities/oats-okf-maintenance/lib/provenance.mjs';

const cli = process.env.OATS_OKF_REAL_CLI;
const KERNEL = '0.44.0';
const root = fileURLToPath(new URL('../', import.meta.url));
const write = (file, text) => { fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const real = p => fs.realpathSync(p);
/** Every path under dir (relative, sorted), with each file's size: a cheap "nothing was written" witness. */
const listing = dir => {
  const out = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { out.push(`${r}/`); walk(join(d, e.name), r); } else out.push(`${r} ${fs.lstatSync(join(d, e.name)).size}`); } };
  walk(dir, ''); return out.sort();
};
/** Every string value in a JSON document. */
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out); return out; };

const HARVESTER_DIR = 'oats-okf--knowledge-harvester'; // packageSoulAgentName('oats.okf', 'knowledge-harvester')
const SPAWN_LINE = 'oats spawn oats.okf/knowledge-harvester --task-file <proposal> --relation unrelated';

test(`5.0.0 real OATS ${KERNEL}: legacy-key cleanup, a source spawn, its checkpoint proposal spawning a top-level harvester, the harvester's source records, removed surfaces, and the source retired`, { skip: !cli }, async t => {
  const base = real(fs.mkdtempSync(join(tmpdir(), 'okf5-real-kernel-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  assert.doesNotMatch(base, /harvest/, 'the cleanup reader looks for the word harvest in oats-local.yaml; the fixture path must not carry it');

  // ---- an isolated machine: node and git only, harnesses that refuse to run ----
  const bin = join(base, 'bin'), asked = join(base, 'model-start-attempted');
  fs.mkdirSync(bin); fs.mkdirSync(join(base, 'user'));
  fs.symlinkSync(process.execPath, join(bin, 'node'));
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
  for (const name of ['pi', 'claude', 'codex']) { write(join(bin, name), `#!/bin/sh\necho ${name} >> '${asked}'\necho NO_MODELS_IN_FIXTURE >&2\nexit 98\n`); fs.chmodSync(join(bin, name), 0o755); }
  const env = { HOME: join(base, 'user'), PATH: `${bin}:/usr/bin:/bin`, OATS_HOME_DIR: join(base, 'host'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C.UTF-8' };
  const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' }).trim();
  const repo = (dir, bare) => {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-qm', 'fixture']);
    execFileSync('git', ['clone', '-q', '--bare', dir, bare], { env }); return git(dir, ['rev-parse', 'HEAD']);
  };

  // ---- the package under test, pinned by commit; a workspace with one source soul ----
  fs.cpSync(join(root, 'oats-package'), join(base, 'pkg/oats-package'), { recursive: true, verbatimSymlinks: true });
  const pkg = repo(join(base, 'pkg'), join(base, 'pkg.git'));
  const ws = join(base, 'ws'), soul = join(ws, 'souls/source');
  write(join(ws, 'oats-workspace.yaml'), `schemaVersion: 2\nname: okf5-real-kernel\nmembers:\n  - file://${base}/ws.git\npackages:\n  oats.okf: git:file://${base}/pkg.git@${pkg}\ndefaults:\n  capabilities:\n    oats.core: off\n  knowledge: { oats.okf: { from: package } }\n  messaging: none\n  tasks: none\n`);
  write(join(ws, 'oats-membership.yaml'), `schemaVersion: 2\nworkspace: file://${base}/ws.git\n`);
  write(join(soul, 'soul.yaml'), 'schemaVersion: 2\nname: source\ndescription: Domain expert fixture.\nwork: directory\n');
  write(join(soul, 'AGENTS.md'), '# Source\nNo model or production operations in this fixture.\n');
  write(join(soul, 'okf.json'), JSON.stringify({ version: 1, owner: 'source-owner', owns: ['project/expert'], reads: ['project/peer'] }));
  repo(ws, join(base, 'ws.git'));

  // ---- the deployment: one Git knowledge base, and a 4.x harvest key left in its host settings ----
  const dep = join(base, 'deployment'), bindingsFile = join(base, 'bindings.json'), kbRemote = join(base, 'knowledge.git');
  const bindingsDoc = { version: 1, stateDir: join(base, 'state'), bases: { project: { id: 'kb-1', kind: 'git', repository: kbRemote, root: 'knowledge', acceptedBranch: 'main', pr: { repository: 'fixture/knowledge' } } } };
  write(bindingsFile, JSON.stringify(bindingsDoc));
  write(join(base, 'nodes.json'), JSON.stringify({ expert: { path: 'expert', owner: 'source-owner' }, peer: { path: 'peer', owner: 'peer-owner' } }));
  const localYaml = join(dep, 'oats-local.yaml');
  write(localYaml, `schemaVersion: 2\nworkspace: file://${base}/ws.git\nsettings:\n  oats.okf:\n    bindings-file: ${bindingsFile}\n    harvest: off\n`);

  /** The real kernel: from the deployment (operator), or from an instance home as that
   *  instance's session runs it (OATS_INSTANCE/OATS_INSTANCE_HOME/OATS_HOME, cwd = home). */
  const run = (args, { cwd = dep, as } = {}) => {
    const e = as ? { ...env, OATS_INSTANCE: as.instance, OATS_INSTANCE_HOME: as.home, OATS_HOME: as.home } : env;
    const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: e, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    let out = null; try { out = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
    return { status: r.status, out, text: `oats ${args.join(' ')}\nstatus ${r.status}\n${r.stdout}\n${r.stderr}` };
  };
  const ok = (args, opts) => { const r = run(args, opts); assert.equal(r.status, 0, r.text); assert.ok(r.out && r.out.ok !== false, r.text); return r.out; };
  const refused = (args, code, opts) => { const r = run(args, opts); assert.notEqual(r.status, 0, r.text); assert.equal(r.out?.ok, false, r.text); assert.equal(r.out.error.code, code, r.text); return r.out.error; };
  const harvesterHomes = () => { const d = join(dep, 'agents', HARVESTER_DIR, 'instances'); return fs.existsSync(d) ? fs.readdirSync(d).filter(n => !n.startsWith('.')) : []; };

  // The kernel this file qualifies, exactly (bin/oats.mjs versionCmd: top-level `version`).
  const version = run(['version']);
  assert.equal(version.status, 0, version.text);
  assert.equal(version.out?.version, KERNEL, 'this test qualifies the released 0.44.0 kernel, not another one');
  ok(['sync']);

  const state = {};

  await t.test('a) a 4.x host key refuses every okf command with its origin and fix; setup --remove-legacy-settings plans, removes it, and okf works again', () => {
    const e = refused(['okf', 'inspect', '--soul', 'source'], 'E_REMOVED');
    assert.match(e.message, /settings\.oats\.okf\.harvest from host \(oats-local\.yaml#\/settings\/oats\.okf\) was removed in oats\.okf 5\.0/, 'the kernel forwards the host origin (OATS_SETTINGS_ORIGINS) and the provider names it');
    assert.ok(e.message.includes('oats okf setup --remove-legacy-settings --soul <soul> --json'), e.message);
    assert.doesNotMatch(e.message, /\boff\b/, 'the refusal names the key, never its value');

    const before = fs.readFileSync(localYaml);
    const plan = ok(['okf', 'setup', '--remove-legacy-settings', '--soul', 'source', '--plan']).result;
    assert.deepEqual(plan, { file: join(dep, 'oats-local.yaml'), removed: ['settings.oats.okf.harvest'], plan: true, written: false });
    assert.deepEqual(fs.readFileSync(localYaml), before, '--plan writes nothing');

    const applied = ok(['okf', 'setup', '--remove-legacy-settings', '--soul', 'source']).result;
    assert.deepEqual(applied, { file: join(dep, 'oats-local.yaml'), removed: ['settings.oats.okf.harvest'], written: true });
    const after = fs.readFileSync(localYaml, 'utf8');
    assert.doesNotMatch(after, /harvest/);
    assert.ok(after.includes(`    bindings-file: ${bindingsFile}\n`), 'only the legacy line is removed');
    assert.deepEqual(ok(['okf', 'setup', '--remove-legacy-settings', '--soul', 'source']).result, { file: join(dep, 'oats-local.yaml'), removed: [], written: false }, 'idempotent');

    // okf commands run again: init stages the base, it is published as the accepted Git base, and bases reads it.
    const staged = ok(['okf', 'init', '--base', 'project', '--nodes', join(base, 'nodes.json'), '--output', join(base, 'stage'), '--soul', 'source']).result;
    assert.equal(staged.status, 'staged', JSON.stringify(staged));
    const kbWork = join(base, 'kb-work');
    fs.mkdirSync(kbWork); fs.cpSync(join(base, 'stage'), join(kbWork, 'knowledge'), { recursive: true });
    repo(kbWork, kbRemote); git(kbRemote, ['config', 'uploadpack.allowFilter', 'true']);
    const bases = ok(['okf', 'bases', '--soul', 'source']).result.bases;
    assert.equal(bases.length, 1, JSON.stringify(bases));
    assert.equal(bases[0].alias, 'project'); assert.equal(bases[0].kind, 'git');
    assert.deepEqual(bases[0].validated, { ok: true }, JSON.stringify(bases[0]));
    assert.deepEqual(bases[0].owns, ['expert']); assert.deepEqual(bases[0].reads, ['peer']);
  });

  await t.test('b) a source spawned from the package checkpoints: its proposal spawns oats.okf/knowledge-harvester top-level (relation unrelated), with OKF vs none composition', () => {
    // The working source: directory work, the real oats.okf spawn hook (required) seeds instance knowledge.
    const spawned = ok(['spawn', 'source', '--name', 'src', '--no-launch']).result;
    assert.equal(spawned.launched, false);
    const src = spawned.home;
    assert.equal(real(src), real(join(dep, 'agents/source/instances/src')));
    for (const p of ['STATE.md', 'log.md']) assert.ok(fs.statSync(join(src, p)).isFile(), `${p} seeded by the spawn hook`);
    assert.ok(fs.statSync(join(src, 'notes')).isDirectory());
    const srcRecord = json(join(src, 'instance.json'));
    assert.deepEqual(srcRecord.capabilityMeta?.['oats.okf'], { memory: 'okf-v2', knowledge: 'proposal' });
    assert.ok(fs.readFileSync(join(src, 'TASK.md'), 'utf8').includes(SPAWN_LINE), 'the spawn brief (TASK.md) names the exact harvester spawn');
    const srcAgents = fs.readFileSync(join(src, 'AGENTS.md'), 'utf8');
    assert.ok(srcAgents.includes('## Knowledge: OKF') && srcAgents.includes('oats spawn oats.okf/knowledge-harvester --task-file <proposal>'), 'the composed okf inject names the spawn');
    const srcSkills = srcRecord.skills.map(s => s.name);
    for (const s of ['okf-consultation', 'okf-instance-knowledge', 'knowledge-theory']) {
      assert.ok(srcSkills.includes(s), `source composes ${s}: ${srcSkills}`);
      assert.ok(fs.existsSync(join(src, '.agents/skills', s, 'SKILL.md')), `${s} materialized`);
    }
    assert.ok(!srcSkills.includes('knowledge-harvest'), 'a working source is not a harvester');

    // The checkpoint, as okf-instance-knowledge says: a backing note and a self-contained proposal in the home.
    write(join(src, 'notes/decision.md'), '---\ntype: Decision\ntitle: Retry budget is per request\ndescription: The retry budget is counted per request, not per connection.\ngenerality: soul\n---\n\nPer-connection budgets let one slow request starve the others.\n');
    const proposal = `# OKF proposal: Retry budget is per request\n\nSource: instance src, home ${src}, soul source\n\n## What\nThe retry budget is counted per request, not per connection.\n\n## Why\nA per-connection budget let one slow request starve the others.\n\n## Evidence\nObserved in the fixture load test.\n\n## Backing notes\n- notes/decision.md\n`;
    write(join(src, 'proposals/2026-10-07-retry-budget.md'), proposal);
    const srcBefore = fs.readFileSync(join(src, 'instance.json'));
    const as = { instance: 'src', home: src };

    // Why the procedure never passes --relative-to: 0.44 refuses it with unrelated (bin/oats.mjs), nothing spawned.
    const bad = refused(['spawn', 'oats.okf/knowledge-harvester', '--task-file', 'proposals/2026-10-07-retry-budget.md', '--relation', 'unrelated', '--relative-to', 'src', '--no-launch'], 'E_BAD_ARGS', { cwd: src, as });
    assert.match(bad.message, /--relation unrelated takes no --relative-to/);
    assert.deepEqual(harvesterHomes(), []);

    // The real spawn, from the source home, exactly as the skill writes it (the task file relative to the home).
    const h = ok(['spawn', 'oats.okf/knowledge-harvester', '--task-file', 'proposals/2026-10-07-retry-budget.md', '--relation', 'unrelated', '--no-launch'], { cwd: src, as }).result;
    assert.equal(h.launched, false);
    assert.deepEqual(harvesterHomes(), [h.instance]);
    const hHome = join(dep, 'agents', HARVESTER_DIR, 'instances', h.instance);
    assert.equal(real(h.home), real(hHome), 'the harvester lives in the deployment, under the package soul\'s agent dir');
    assert.ok(fs.readFileSync(join(hHome, 'TASK.md'), 'utf8').includes(proposal.trim()), 'TASK.md carries the proposal (the kernel copies --task-file)');

    // Top-level: "unrelated" is normalized away before recording (lib/core.mjs), so no lineage field is written.
    const hRecord = json(join(hHome, 'instance.json'));
    for (const k of ['parentInstance', 'siblingInstance', 'relation', 'relativeTo']) assert.equal(hRecord[k], undefined, `${k}: ${JSON.stringify(hRecord[k])}`);
    assert.equal(hRecord.spawnOrigin, 'operator', 'not an instance-origin (child) spawn: ambient OATS_INSTANCE is not parentage');
    assert.ok(!strings(hRecord).some(v => v === 'src' || v.includes(src)), 'nothing in the harvester record names the source');
    assert.deepEqual(fs.readFileSync(join(src, 'instance.json')), srcBefore, 'the source record gained no child or lineage');

    // Composition: oats.okf-harvest only, knowledge: none (no oats.okf, its hook, skills or instance knowledge).
    const hCaps = hRecord.capabilities.map(c => c.id);
    assert.ok(hCaps.includes('oats.okf-harvest') && !hCaps.includes('oats.okf'), hCaps.join(','));
    assert.equal(hRecord.capabilityMeta?.['oats.okf'], undefined);
    const hSkills = hRecord.skills.map(s => s.name);
    for (const s of ['knowledge-harvest', 'knowledge-theory', 'okf-authoring']) {
      assert.ok(hSkills.includes(s), `harvester composes ${s}: ${hSkills}`);
      assert.ok(fs.existsSync(join(hHome, '.agents/skills', s, 'SKILL.md')), `${s} materialized`);
    }
    for (const s of ['okf-consultation', 'okf-instance-knowledge']) assert.ok(!hSkills.includes(s), `harvester must not compose ${s}`);
    for (const p of ['STATE.md', 'log.md', 'notes']) assert.equal(fs.existsSync(join(hHome, p)), false, `${p}: the kernel seeds no instance knowledge; only the oats.okf hook does`);
    const hAgents = fs.readFileSync(join(hHome, 'AGENTS.md'), 'utf8');
    assert.ok(hAgents.includes('## Knowledge harvester (oats.okf-harvest)') && !hAgents.includes('## Knowledge: OKF'));
    assert.equal(fs.existsSync(asked), false, 'no harness was asked to start');
    Object.assign(state, { src, hHome, harvester: h.instance });
  });

  await t.test('c) from the harvester home, the records the knowledge-harvest skill reads exist, agree, and yield a valid v2 provenance block', () => {
    const { hHome, harvester } = state;
    assert.ok(hHome, 'needs (b)');
    // The proposal, as the harvester has it: its TASK.md. Its Source line is a pointer, not authority.
    const task = fs.readFileSync(join(hHome, 'TASK.md'), 'utf8');
    const [, claimed, claimedHome, claimedSoul] = /^Source: instance (\S+), home (\S+), soul (\S+)$/m.exec(task) ?? [];
    assert.ok(claimed, task);
    const named = [...task.matchAll(/^- (notes\/\S+\.md)\b/gm)].map(m => m[1]);
    assert.deepEqual(named, ['notes/decision.md']);

    // Step 2.1: D is the directory holding the harvester's agents/ root; exactly one record of that instance.
    const D = dirname(dirname(dirname(dirname(hHome))));
    assert.equal(real(D), real(dep));
    const records = fs.readdirSync(join(D, 'agents')).filter(a => !a.startsWith('.')).map(a => join(D, 'agents', a, 'instances', claimed, 'instance.json')).filter(f => fs.existsSync(f));
    assert.equal(records.length, 1, records.join('\n'));
    const record = json(records[0]);
    assert.equal(record.instance, claimed);
    assert.equal(real(record.home), real(dirname(records[0])), 'the record is its own home\'s');
    assert.equal(real(record.home), real(claimedHome), 'and the proposal\'s home');

    // Step 2.2: the soul, from the record's soulDir (a per-commit copy outside the home).
    assert.ok(isAbsolute(record.soulDir) && !real(record.soulDir).startsWith(real(record.home) + sep), record.soulDir);
    assert.match(fs.readFileSync(join(record.soulDir, 'soul.yaml'), 'utf8'), new RegExp(`^name: ${claimedSoul}$`, 'm'));
    const okf = json(join(record.soulDir, 'okf.json'));
    assert.equal(okf.owner, 'source-owner'); assert.deepEqual(okf.owns, ['project/expert']); assert.deepEqual(okf.reads, ['project/peer']);

    // Step 2.3: the bindings. 0.44 records the soul's merged provider payloads as instance.json
    // `providers` (lib/materialize.mjs, carried by lib/core.mjs spawn); `decision` (with
    // effective.providers) is written only for a decision-bound spawn (--expect-decision), never by
    // the plain spawn the skill tells agents to run. The capability row's settings agree.
    assert.equal(record.decision, undefined, 'a plain spawn records no decision: the harvester must read providers["oats.okf"]');
    const provider = record.providers?.['oats.okf'];
    assert.ok(provider, JSON.stringify(Object.keys(record.providers ?? {})));
    assert.equal(provider['bindings-file'], bindingsFile);
    assert.equal(record.capabilities.find(c => c.id === 'oats.okf')?.settings?.['bindings-file'], bindingsFile);
    const bindings = json(provider['bindings-file']);
    const kb = bindings.bases.project;
    assert.deepEqual(kb, bindingsDoc.bases.project);

    // Step 3: only the named notes, each a regular in-home file, hashed.
    const notesRoot = real(join(record.home, 'notes')) + sep;
    const evidence = named.map(n => {
      assert.ok(/^notes\/[A-Za-z0-9._/-]+\.md$/.test(n) && n.split('/').every(s => s && s !== '.' && s !== '..'), n);
      const file = join(record.home, n), st = fs.lstatSync(file);
      assert.ok(st.isFile() && !st.isSymbolicLink() && real(file).startsWith(notesRoot), n);
      return { note: n, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    });

    // Step 4: clone the accepted Git base into the harvester's work; owned = okf-base.json owner AND okf.json owns.
    const clone = join(hHome, 'work/project');
    git(hHome, ['clone', '-q', '--branch', kb.acceptedBranch, kb.repository, clone]);
    const meta = json(join(clone, kb.root, 'okf-base.json'));
    const ownedNodes = Object.entries(meta.nodes).filter(([node, spec]) => spec.owner === okf.owner && okf.owns.includes(`project/${node}`)).map(([node]) => `project/${node}`);
    assert.deepEqual(ownedNodes, ['project/expert']);

    // Step 8: the v2 block, from records only; the maintainer's parser accepts it.
    const block = {
      version: 2,
      source: { soul: claimedSoul, owner: okf.owner, instance: record.instance, ownedNodes, readNodes: okf.reads, bases: [{ alias: 'project', id: kb.id, kind: kb.kind, root: kb.root, repository: kb.repository }] },
      evidence,
      tasks: { provider: record.capabilities.find(c => c.layer === 'tasks')?.id ?? null, refs: [] },
      harvester: { instance: harvester, alias: null },
    };
    const body = `okf-harvest: retry budget is per request\n\nPromoted: project/expert (decision).\n\n\`\`\`okf-harvest\n${JSON.stringify(block, null, 2)}\n\`\`\`\n`;
    assert.ok(!body.includes(record.home), 'no source home path in the PR body');
    const parsed = parseProvenance(body);
    assert.equal(parsed.valid, true, parsed.problems.join('; '));
    assert.deepEqual(parsed.value, block);
  });

  await t.test('d) the removed 4.x surfaces refuse E_REMOVED on the real kernel and create nothing', () => {
    const { src, hHome } = state;
    assert.ok(src && hHome, 'needs (b)');
    const harvestersBefore = harvesterHomes();
    const e1 = refused(['okf', 'harvest'], 'E_REMOVED', { cwd: src, as: { instance: 'src', home: src } });
    assert.match(e1.message, /oats okf harvest was removed in oats\.okf 5\.0/);
    assert.deepEqual(harvesterHomes(), harvestersBefore, 'the old checkpoint spawns nothing');

    const judgment = join(base, 'judgment.json'), before = listing(hHome);
    const e2 = refused(['okf-harvest', 'complete', '--source', 'x', '--run', 'y', '--judgment', judgment], 'E_REMOVED', { cwd: hHome, as: { instance: state.harvester, home: hHome } });
    assert.match(e2.message, /oats okf-harvest complete was removed in oats\.okf 5\.0/);
    assert.equal(fs.existsSync(judgment), false);
    assert.deepEqual(listing(hHome), before, 'a legacy 4.x TASK\'s complete writes nothing in the harvester home');
  });

  await t.test('e) the source retires; its record is gone, so a harvester following the skill stops; the harvester outlives it', () => {
    const { src, hHome } = state;
    assert.ok(src && hHome, 'needs (b)');
    const hBefore = fs.readFileSync(join(hHome, 'instance.json'));
    const r = run(['retire', 'src']);
    assert.equal(r.status, 0, r.text);
    assert.equal(r.out?.retired, 'src', r.text); assert.equal(r.out.removedDir, true, r.text);
    assert.equal(r.out.relinked, undefined, 'no instance pointed at the source: nothing to relink');
    assert.equal(fs.existsSync(src), false);
    // Step 2.1 of the skill, again: no record (a kernel recovery copy under instances/.oats-retirement/ is not one).
    const D = dirname(dirname(dirname(dirname(hHome))));
    const records = fs.readdirSync(join(D, 'agents')).filter(a => !a.startsWith('.')).map(a => join(D, 'agents', a, 'instances', 'src', 'instance.json')).filter(f => fs.existsSync(f));
    assert.deepEqual(records, [], 'source authority cannot be established: the harvester STOPS and reports');
    assert.ok(fs.existsSync(join(hHome, 'TASK.md')), 'the harvester home is kept');
    assert.deepEqual(fs.readFileSync(join(hHome, 'instance.json')), hBefore, 'retiring the source does not touch the harvester record');
    assert.equal(fs.existsSync(asked), false, 'no harness was ever asked to start a model');
  });
});
