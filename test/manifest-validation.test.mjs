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
  cpSync(join(ROOT, "oats-package", capabilityDir), capabilityRoot, { recursive: true });
  const manifest = readJson(join(capabilityRoot, "oats.json"));
  return {
    dir, payload, capabilityRoot, packageManifest, manifest,
    run() {
      writeJson(join(payload, "oats-package.json"), packageManifest);
      writeJson(join(capabilityRoot, "oats.json"), manifest);
      return spawnSync(process.execPath, [join(dir, "scripts/validate-manifests.mjs")], {
        cwd: dir, encoding: "utf8", timeout: 10000,
      });
    },
  };
}

function rejected(f, message) {
  const result = f.run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Manifest validation failed:/);
  assert.match(result.stderr, message);
  assert.doesNotMatch(result.stderr, /TypeError|RangeError|at safeResource/);
}

test("validator accepts the actual exported release with no unenumerated payload", (t) => {
  const result = fixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 capability manifest/);
});

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

for (const [name, mutate, message] of [
  ["missing resource", (f) => { f.manifest.inject = "missing.md"; }, /cannot be resolved: ENOENT/],
  ["traversal", (f) => { f.manifest.skills = ["../../scripts"]; }, /must be package-relative/],
  ["non-file command", (f) => { f.manifest.commands.harvest = "skills harvest"; }, /command entrypoint must be a file/],
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
