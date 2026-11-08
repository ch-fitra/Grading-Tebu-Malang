// Pure UI data regression checks; does not connect to cameras or databases.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const folder = await mkdtemp(path.join(tmpdir(), "malang-grade-tests-"));
const written = [];
try {
  for (const name of ["grade-guide", "grade-data"]) {
    const source = await readFile(new URL(`../apps/web/src/utils/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    });
    const file = path.join(folder, `${name}.mjs`);
    await writeFile(file, outputText.replace('"./grade-guide"', '"./grade-guide.mjs"'));
    written.push(file);
  }
  const { frameGradeDistribution, storedClassProbability } = await import(pathToFileURL(path.join(folder, "grade-data.mjs")));
  const grades = ["Akar Tanah", "MBS", "Daduk"];
  const scores = { "Akar Tanah": 11.3, MBS: 10, Daduk: 8 };
  const frames = Array.from({ length: 50 }, () => ({ grade: "Akar Tanah", classScores: scores }));
  assert.deepEqual(frameGradeDistribution(frames, grades), [
    { code: "Akar Tanah", count: 50, percent: 100 },
    { code: "MBS", count: 0, percent: 0 },
    { code: "Daduk", count: 0, percent: 0 }
  ]);
  const mixed = frameGradeDistribution([{ grade: "akar tanah" }, { grade: "MBS" }, { grade: "MBS" }, { grade: "Daduk" }], grades);
  assert.deepEqual(mixed.map(item => item.percent), [25, 50, 25]);
  assert.deepEqual(frameGradeDistribution(frames.slice(0, 10), grades).map(item => item.count), [10, 0, 0]);
  assert.ok(frameGradeDistribution([], grades).every(item => item.count === 0 && item.percent === 0));
  assert.equal(storedClassProbability(frames[0], "Akar Tanah"), 11.3);
  assert.equal(storedClassProbability(frames[0], "MBS"), 10);
  assert.equal(storedClassProbability({ classScores: { MBS: 0 } }, "MBS"), 0);
  assert.equal(storedClassProbability({}, "MBS"), undefined);
  assert.equal(storedClassProbability({ classScores: scores }, "Terbakar"), undefined);
  for (const value of [NaN, Infinity, -1, 101]) {
    assert.equal(storedClassProbability({ classScores: { MBS: value } }, "MBS"), undefined);
  }
  assert.deepEqual(scores, { "Akar Tanah": 11.3, MBS: 10, Daduk: 8 });
  console.log("PASS: frame counts, mixed/empty scopes, original probabilities, missing scores, and zero confidence");
} finally {
  for (const file of written) await unlink(file);
  await rmdir(folder);
}
