import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { v2Deployment } from '../../oats-main/test/helpers/v2-deployment.mjs';
import { validateBindings } from '../oats-package/capabilities/oats-okf/lib/config.mjs';
import { initBase } from '../oats-package/capabilities/oats-okf/lib/migration.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] || join(repo, 'test/fixtures/kernel-readiness-check-oats-okf.json');
const record = `${out}.record`;
const cap = join(repo, 'oats-package/capabilities/oats-okf');
const kernelOid = readFileSync(new URL('../../oats-main/.git/refs/heads/main', import.meta.url), 'utf8').trim();

const fx = v2Deployment({
  souls: { kb: { soul: { capabilities: { 'oats.okf': { from: 'here' } } } } },
  capabilityDirs: { 'oats-okf': cap },
  files: { 'souls/kb/okf.json': { json: { version: 1, owner: 'kb-owner', reads: [], owns: ['reh/kb'] } } },
});
try {
  const host = join(fx.base, 'okf-host'), base = join(host, 'base'), state = join(host, 'state'), bindingsFile = join(host, 'bindings.json');
  mkdirSync(host, { recursive: true });
  writeFileSync(bindingsFile, JSON.stringify({ version: 1, stateDir: state, bases: { reh: { id: 'reh', kind: 'directory', path: base } } }, null, 2));
  const bindings = validateBindings(JSON.parse(readFileSync(bindingsFile, 'utf8')), bindingsFile);
  const nodes = join(host, 'nodes.json');
  writeFileSync(nodes, JSON.stringify({ kb: { path: 'kb', owner: 'kb-owner' } }));
  initBase(bindings, 'reh', nodes, undefined, { confirm: true });
  writeFileSync(join(fx.dep, 'oats-local.yaml'), YAML.stringify({ schemaVersion: 2, workspace: fx.ref, settings: { 'oats.okf': { 'bindings-file': bindingsFile, 'state-dir': state, harvest: 'off', 'harvest-runtime': 'pi' } } }, { lineWidth: 0 }));

  const spawned = await fx.spawn('kb', { instance: 'kb-fixture' });
  const home = spawned.home;
  const real = join(home, '.oats/modules/oats.okf/bin/oats-okf-binding.mjs');
  const orig = join(home, '.oats/modules/oats.okf/bin/oats-okf-binding-real.mjs');
  renameSync(real, orig);
  writeFileSync(real, `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';\nimport { dirname } from 'node:path';\nimport { spawnSync } from 'node:child_process';\nconst stdin = readFileSync(0);\nmkdirSync(dirname(${JSON.stringify(record)}), { recursive: true });\nwriteFileSync(${JSON.stringify(record)}, stdin);\nconst r = spawnSync(process.execPath, [${JSON.stringify(orig)}, ...process.argv.slice(2)], { input: stdin, env: process.env, cwd: process.cwd(), encoding: null });\nif (r.stdout) process.stdout.write(r.stdout);\nif (r.stderr) process.stderr.write(r.stderr);\nprocess.exit(r.status ?? 1);\n`);
  chmodSync(real, 0o755);
  const r = fx.cli(['readiness', '--home', home, '--json']);
  if (r.status !== 0) throw new Error(`readiness failed ${r.status}\nSTDOUT=${r.stdout}\nSTDERR=${r.stderr}`);
  let stdin;
  try { stdin = readFileSync(record, 'utf8'); }
  catch { throw new Error(`wrapper did not record stdin\nSTDOUT=${r.stdout}\nSTDERR=${r.stderr}`); }
  const doc = { provenance: { capturedBy: 'scripts/capture-readiness-fixture.mjs', command: 'oats readiness --home <spawned kb-fixture home> --json', kernel: 'awebai/oats', kernelOid }, stdin: JSON.parse(stdin) };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(out);
} finally { fx.cleanup(); }
