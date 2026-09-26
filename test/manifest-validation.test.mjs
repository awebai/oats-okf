import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

// Copy only the enumerated release payload, never the stale unexported copies.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "oats-manifest-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["scripts", "schemas", "oats-package"]) mkdirSync(join(dir, name));
  copyFileSync(join(ROOT, "scripts/validate-manifests.mjs"), join(dir, "scripts/validate-manifests.mjs"));
  for (const name of ["oats-package", "capability-manifest"]) {
    copyFileSync(join(ROOT, `schemas/${name}.schema.json`), join(dir, `schemas/${name}.schema.json`));
  }
  const payload = join(dir, "oats-package");
  const packageManifest = readJson(join(ROOT, "oats-package/oats-package.json"));
  assert.equal(packageManifest.capabilities.length, 1);
  const capabilityDir = packageManifest.capabilities[0];
  const capabilityRoot = join(payload, capabilityDir);
  cpSync(join(ROOT, "oats-package", capabilityDir), capabilityRoot, { recursive: true, verbatimSymlinks: true });
  const manifest = readJson(join(capabilityRoot, "oats.json"));
  return {
    dir, payload, capabilityRoot, packageManifest, manifest,
    run(mutateFiles = () => {}) {
      writeJson(join(payload, "oats-package.json"), packageManifest);
      writeJson(join(capabilityRoot, "oats.json"), manifest);
      // Mutate after writing manifests so a symlink fixture is never followed
      // (and its external invalid JSON overwritten) by test setup itself.
      mutateFiles();
      return spawnSync(process.execPath, [join(dir, "scripts/validate-manifests.mjs")], {
        cwd: dir, encoding: "utf8", timeout: 10000,
      });
    },
  };
}

function rejected(f, message, mutateFiles) {
  const result = f.run(mutateFiles);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Manifest validation failed:/);
  assert.match(result.stderr, message);
  assert.doesNotMatch(result.stderr, /TypeError|RangeError|at safeResource/);
  return result;
}

test("validator accepts the actual exported release with no unenumerated payload", (t) => {
  const result = fixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 capability manifest/);
});

test('2.1.6 manifest declares the 0.26 floor and no soul-scaffold hook',t=>{
  const f=fixture(t);
  assert.equal(f.manifest.compatibility.oats, '>=0.26.0');
  assert.equal(f.packageManifest.compatibility.oats, '>=0.26.0');
  assert.equal(Object.hasOwn(f.manifest.hooks,'soul-scaffold'), false);
});

test('binding reason declarations accept omission and the bounded literal vocabulary',t=>{
  const f=fixture(t);
  assert.equal(f.run().status,0);
  delete f.manifest.binding.reasons;assert.equal(f.run().status,0,'old declarations remain valid');
  f.manifest.binding.reasons=['x'.repeat(200)];assert.equal(f.run().status,0);
  f.manifest.binding.reasons=Array.from({length:64},(_,i)=>`fixed reason ${i}`);assert.equal(f.run().status,0);
});

test('binding reason declarations reject invalid types, duplicates, bounds, controls and interpolation',t=>{
  const f=fixture(t);
  for(const reasons of [null,{},[],[7],[''],['same','same'],['x'.repeat(201)],Array.from({length:65},(_,i)=>`fixed reason ${i}`),['reason'+String.fromCharCode(10)+'line'],['reason'+String.fromCharCode(9)+'value'],['non-ASCII-é'],['setting ${suppliedValue}'],['reason {value}']]){
    f.manifest.binding.reasons=reasons;rejected(f,/binding\.reasons/);
  }
});

test("canonical referenced helper/input definitions remain closed", (t) => {
  for (const mutate of [
    m => { m.helperInjection = null; },
    m => { m.helperInjection = {version:1,mode:'omit',path:'injects/okf.md'}; },
    m => { m.helperInjection = {version:2,mode:'omit'}; },
    m => { m.helperInjection = {version:1,mode:'omit',constructor:'not-a-declared-field'}; },
    m => { m.helperInjection = {version:1,mode:'file',path:'../other.md'}; },
    m => { m.hooks.spawn.inputs = {sourceReceipt:{version:2}}; },
    m => { m.hooks.spawn.inputs = {sourceReceipt:{version:1,extra:true}}; },
    m => { m.hooks.retire.inputs = {unknown:{version:1}}; },
    m => { m.hooks.retire.inputs = {constructor:{version:1}}; },
    m => { m.hooks.retire.required = true; },
    m => { m.hooks.retire = {command:'bin/oats-okf.mjs retire',inputs:null}; },
  ]) {
    const f=fixture(t);mutate(f.manifest);rejected(f,/must match exactly one schema alternative/);
  }
});

test('validator checks helper-only file existence and same-capability containment',t=>{
  const f=fixture(t);f.manifest.helperInjection={version:1,mode:'file',path:'injects/okf.md'};
  assert.equal(f.run().status,0);
  f.manifest.helperInjection.path='missing.md';rejected(f,/helper injection path cannot be resolved/);
  f.manifest.helperInjection.path='skills';rejected(f,/helper injection path must be a file/);
  const shared=join(f.payload,'shared.md');writeFileSync(shared,'Different capability ownership\n');
  symlinkSync(shared,join(f.capabilityRoot,'other-owner.md'));
  f.manifest.helperInjection.path='other-owner.md';rejected(f,/inside its owning capability/);
});

for (const ref of ['https://example.invalid/schema.json', '#/$defs/missing', '#/$defs/HelperInjection']) {
  test(`validator refuses unsupported schema reference ${ref}`, t => {
    const f=fixture(t),file=join(f.dir,'schemas/capability-manifest.schema.json'),schema=readJson(file);
    schema.$defs.HelperInjection={$ref:ref};writeJson(file,schema);
    rejected(f,/schema reference/);
  });
}

test("validator rejects a missing capability enumeration", (t) => {
  const f = fixture(t);
  delete f.packageManifest.capabilities;
  rejected(f, /must enumerate exactly one capability directory \(found 0\)/);
});

test("validator rejects extra capability enumerations", (t) => {
  const f = fixture(t);
  f.packageManifest.capabilities.push("extra-capability");
  rejected(f, /must enumerate exactly one capability directory \(found 2\)/);
});

for (const candidate of [null, 42, "", "../scripts", "/tmp", "C:\\outside", "..\\scripts"]) {
  test(`validator rejects unsafe capability enumeration ${JSON.stringify(candidate)}`, (t) => {
    const f = fixture(t);
    f.packageManifest.capabilities = [candidate];
    rejected(f, /capability directory must be/);
  });
}

for (const [name, mutate] of [
  ["skill", (m, path) => { m.skills = [path]; }],
  ["agent", (m, path) => { m.agents = [path]; }],
  ["injection", (m, path) => { m.inject = path; }],
  ["command", (m, path) => { m.commands.harvest = `${path} harvest`; }],
  ["object hook", (m, path) => { m.hooks.spawn = { command: `${path} spawn`, required: true }; }],
]) {
  test(`validator rejects an exported ${name} symlink outside the package`, (t) => {
    const f = fixture(t);
    // A lexical-prefix sibling is not inside oats-package.
    const outside = join(f.dir, "oats-package-neighbor");
    mkdirSync(outside);
    writeFileSync(join(outside, "outside.mjs"), "// repository-only bytes\n");
    symlinkSync(join(outside, "outside.mjs"), join(f.capabilityRoot, "escape"));
    mutate(f.manifest, "escape");
    rejected(f, /escapes the package root after symlink resolution/);
  });
}

for (const subtree of ["skills", "agents/memory-harvest", "lib"]) {
  test(`validator checks nested resources under exported ${subtree}`, (t) => {
    const f = fixture(t);
    symlinkSync(join(f.dir, "scripts"), join(f.capabilityRoot, subtree, "outside"));
    rejected(f, /outside: .*escapes the package root/);
  });
}

test("validator rejects an escaping capability directory before reading its manifest", (t) => {
  const f = fixture(t);
  const outside = join(f.dir, "repo-only");
  mkdirSync(outside);
  writeFileSync(join(outside, "oats.json"), "not JSON: must not be read");
  symlinkSync(outside, join(f.payload, "escape"));
  f.packageManifest.capabilities = ["escape"];
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /escapes the package root/);
  assert.doesNotMatch(result.stderr, /invalid JSON/);
});

test("validator checks the capability manifest itself before reading it", (t) => {
  const f = fixture(t);
  // run() rewrites the canonical manifest, so export a second directory whose
  // manifest aliases repository-only bytes instead.
  const alias = join(f.payload, "alias");
  mkdirSync(alias);
  const outside = join(f.dir, "outside.json");
  writeFileSync(outside, "not JSON: must not be read");
  symlinkSync(outside, join(alias, "oats.json"));
  f.packageManifest.capabilities = ["alias"];
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capability manifest escapes the package root/);
  assert.doesNotMatch(result.stderr, /invalid JSON/);
});

for (const dangling of [false, true]) {
  test(`validator checks ${dangling ? "dangling" : "escaping"} root manifest symlinks before reading JSON`, (t) => {
    const f = fixture(t);
    const outside = join(f.dir, "outside.json");
    const invalid = "not JSON: external package manifest must not be read";
    if (!dangling) writeFileSync(outside, invalid);
    const result = rejected(f, dangling ? /package manifest cannot be resolved: ENOENT/ : /package manifest escapes the package root/, () => {
      rmSync(join(f.payload, "oats-package.json"));
      symlinkSync(outside, join(f.payload, "oats-package.json"));
    });
    assert.doesNotMatch(result.stderr, /invalid JSON/);
    if (!dangling) assert.equal(readFileSync(outside, "utf8"), invalid);
  });
}

test("validator rejects a non-regular root manifest before reading JSON", (t) => {
  const f = fixture(t);
  const result = rejected(f, /package manifest must be a file/, () => {
    rmSync(join(f.payload, "oats-package.json"));
    mkdirSync(join(f.payload, "oats-package.json"));
  });
  assert.doesNotMatch(result.stderr, /invalid JSON/);
});

test("validator accepts package-contained shared skills and required spawn hooks", (t) => {
  const f = fixture(t);
  const shared = join(f.payload, "shared-skills");
  cpSync(join(f.capabilityRoot, "skills"), shared, { recursive: true });
  symlinkSync(shared, join(f.capabilityRoot, "linked-skills"));
  f.manifest.skills = ["linked-skills"];
  f.manifest.hooks.spawn = { command: "bin/oats-okf.mjs spawn", required: true };
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

test("validator accepts leaf skills and does not impose OKF baseline names on other capabilities", (t) => {
  const f = fixture(t);
  f.packageManifest.package = f.manifest.capability = "example.notes";
  mkdirSync(join(f.capabilityRoot, "custom-skill"));
  writeFileSync(join(f.capabilityRoot, "custom-skill/SKILL.md"), "# Custom skill\n");
  f.manifest.skills = ["custom-skill"];
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  // No skills is valid generically. The OKF baseline, not manifest validation,
  // requires this release's okf + memory-harvest closure.
  f.manifest.skills = [];
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate, message] of [
  ["missing resource", (f) => { f.manifest.inject = "missing.md"; }, /cannot be resolved: ENOENT/],
  ["traversal", (f) => { f.manifest.skills = ["../../scripts"]; }, /must be package-relative/],
  ["non-file command", (f) => { f.manifest.commands.harvest = "skills harvest"; }, /command entrypoint must be a file/],
  ["non-directory skill", (f) => { f.manifest.skills = ["injects/okf.md"]; }, /skill path must be a directory/],
  ["empty declared skill tree", (f) => {
    rmSync(join(f.capabilityRoot, "skills"), { recursive: true });
    mkdirSync(join(f.capabilityRoot, "skills"));
  }, /skill tree contains no discoverable skill/],
  ["directory SKILL.md marker", (f) => {
    mkdirSync(join(f.capabilityRoot, "invalid-skill/SKILL.md"), { recursive: true });
    f.manifest.skills = ["invalid-skill"];
  }, /skill tree contains no discoverable skill/],
  ["grandchild-only skill tree", (f) => {
    mkdirSync(join(f.capabilityRoot, "nested/child/grandchild"), { recursive: true });
    writeFileSync(join(f.capabilityRoot, "nested/child/grandchild/SKILL.md"), "# Too deep\n");
    f.manifest.skills = ["nested"];
  }, /skill tree contains no discoverable skill/],
  ["symlink-child-only skill tree", (f) => {
    mkdirSync(join(f.capabilityRoot, "linked-children"));
    symlinkSync(join(f.capabilityRoot, "skills/okf"), join(f.capabilityRoot, "linked-children/okf"));
    f.manifest.skills = ["linked-children"];
  }, /skill tree contains no discoverable skill/],
  ["undeclared operation command", (f) => { f.manifest.operations.inspect.command = "not-declared"; }, /operations.inspect.command: must name one of the manifest's commands/],
  ["inherited operation command", (f) => { f.manifest.operations.inspect.command = "constructor"; }, /operations.inspect.command: must name one of the manifest's commands/],
  ["removed inspect command", (f) => { delete f.manifest.commands.inspect; }, /operations.inspect.command: must name one of the manifest's commands/],
  ["unowned binding command", (f) => { f.manifest.binding.bind = "missing-command"; }, /binding.bind: must name one of the manifest's commands/],
  ["binding on non-fundamental capability", (f) => { delete f.manifest.layer; }, /binding codecs require a fundamental capability layer/],
  ["malformed resources", (f) => { f.manifest.skills = {}; f.manifest.agents = 1; }, /must be array/],
  ["required retire hook", (f) => { f.manifest.hooks.retire = { command: "bin/oats-okf.mjs retire", required: true }; }, /must match exactly one schema alternative/],
  ["invalid requirement", (f) => { f.manifest.requires = [{ command: "git" }]; }, /must match exactly one schema alternative/],
  ["config escape", (f) => {
    symlinkSync(join(f.dir, "scripts/validate-manifests.mjs"), join(f.payload, "config.yaml"));
    f.packageManifest.configs = { default: { path: "config.yaml" } };
  }, /config profile escapes the package root/],
  ["dangling nested symlink", (f) => { symlinkSync("missing", join(f.capabilityRoot, "skills/dangling")); }, /cannot be resolved: ENOENT/],
  ["nested symlink cycle", (f) => { symlinkSync(".", join(f.capabilityRoot, "skills/cycle")); }, /directory symlink cycle/],
]) {
  test(`validator rejects ${name} with a validation diagnostic`, (t) => {
    const f = fixture(t);
    mutate(f);
    rejected(f, message);
  });
}

for (const manifest of [null, [], "not an object"]) {
  test(`validator reports a non-object exported manifest: ${JSON.stringify(manifest)}`, (t) => {
    const f = fixture(t);
    const alias = join(f.payload, "invalid-capability");
    mkdirSync(alias);
    writeJson(join(alias, "oats.json"), manifest);
    f.packageManifest.capabilities = ["invalid-capability"];
    rejected(f, /must be object/);
  });
}

// Exercise the real baseline assertions against mutated installed bytes. Keep
// nested runners to the baseline contract tests, never this mutation suite, and
// clear Node's inherited runner channel so stdout remains ordinary TAP.
function runBaseline(f) {
  mkdirSync(join(f.dir, "test"), { recursive: true });
  copyFileSync(join(ROOT, "test/oats-okf.test.mjs"), join(f.dir, "test/oats-okf.test.mjs"));
  mkdirSync(join(f.dir, "test/helpers"), { recursive: true });
  for (const helper of ["no-effects.mjs", "invocation-fixture.mjs"]) copyFileSync(join(ROOT, `test/helpers/${helper}`), join(f.dir, `test/helpers/${helper}`));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_TEST_|OATS_|GIT_)/.test(key)));
  return spawnSync(process.execPath, ["--test", "--test-name-pattern=^baseline ", "test/oats-okf.test.mjs"], {
    cwd: f.dir, env, encoding: "utf8", timeout: 20000,
  });
}

test("baseline mutation harness accepts the unmodified installed payload", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const result = runBaseline(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ok \d+ - baseline exports/);
  assert.match(result.stdout, /ok \d+ - baseline harvest operation/);
  assert.match(result.stdout, /ok \d+ - baseline inspect operation/);
});

for (const [name, mutate, validationStatus, diagnostic] of [
  ["deleted memory-harvest skill", (f) => {
    rmSync(join(f.capabilityRoot, "skills/memory-harvest"), { recursive: true });
  }, 0, /missing required baseline skill memory-harvest/],
  ["non-file memory-harvest SKILL.md", (f) => {
    const doc = join(f.capabilityRoot, "skills/memory-harvest/SKILL.md");
    rmSync(doc);
    mkdirSync(doc);
  }, 0, /missing required baseline skill memory-harvest/],
  ["empty skills declaration", (f) => { f.manifest.skills = []; }, 0, /missing required baseline skill okf/],
  ["undeclared memory-harvest skill", (f) => { f.manifest.skills = ["skills/okf"]; }, 0, /missing required baseline skill memory-harvest/],
  ["empty skills directory", (f) => {
    rmSync(join(f.capabilityRoot, "skills"), { recursive: true });
    mkdirSync(join(f.capabilityRoot, "skills"));
  }, 1, /skill tree contains no discoverable skill/],
  ["skills pointing to injection file", (f) => { f.manifest.skills = ["injects/okf.md"]; }, 1, /skill path must be a directory/],
  ["wrong-event harvest fixed argv", (f) => { f.manifest.commands.harvest = "bin/oats-okf.mjs retire"; }, 0, /not ok \d+ - baseline harvest operation/],
  ["wrong-event inspect fixed argv", (f) => { f.manifest.commands.inspect = "bin/oats-okf.mjs retire"; }, 0, /not ok \d+ - baseline inspect command/],
  ["removed inspect command", (f) => { delete f.manifest.commands.inspect; }, 1, /operations.inspect.command: must name one of the manifest's commands/],
  ["removed inspect command and operation", (f) => {
    delete f.manifest.commands.inspect;
    delete f.manifest.operations.inspect;
  }, 0, /missing command inspect/],
  ["undeclared operation command", (f) => { f.manifest.operations.harvest.command = "not-declared"; }, 1, /operations.harvest.command: must name one of the manifest's commands/],
  ["misrouted harvest operation", (f) => { f.manifest.operations.harvest.command = "inspect"; }, 0, /not ok \d+ - baseline harvest operation/],
  ["misrouted inspect operation", (f) => { f.manifest.operations.inspect.command = "harvest"; }, 0, /not ok \d+ - baseline inspect operation/],
]) {
  test(`release gate rejects mutation: ${name}`, (t) => {
    const f = fixture(t);
    mutate(f);
    const validation = f.run();
    assert.equal(validation.status, validationStatus, validation.stderr);
    if (validationStatus === 1) {
      assert.match(validation.stderr, diagnostic);
    } else {
      const result = runBaseline(f);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, diagnostic);
    }
  });
}

test("npm test does not recursively execute tests from nested checkouts", (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  copyFileSync(join(ROOT, "package.json"), join(f.dir, "package.json"));
  mkdirSync(join(f.dir, "test/checkout/test"), { recursive: true });
  writeFileSync(join(f.dir, "test/smoke.test.mjs"), 'import test from "node:test"; test("top-level fixture", () => {});\n');
  writeFileSync(join(f.dir, "test/checkout/test/unsafe.test.mjs"), 'throw new Error("nested checkout tests must not run");\n');
  // A nested Node test runner must not inherit its parent's IPC/test context.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_")));
  const result = spawnSync("npm", ["test"], { cwd: f.dir, env, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /top-level fixture/);
  assert.doesNotMatch(result.stdout + result.stderr, /nested checkout tests must not run/);
});
