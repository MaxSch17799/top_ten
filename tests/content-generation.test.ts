import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeIfChanged } from '../scripts/lib/write-if-changed.mjs';

async function fixture(run: (file: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'game-night-generator-'));
  const file = path.join(directory, 'output.txt');
  try { await run(file, directory); }
  finally {
    // Only the named output and the empty directory created by this test are removed.
    await rm(file, { force: true });
    await rmdir(directory);
  }
}

test('generation creates a missing output with identical Unicode bytes and line endings', async () => fixture(async file => {
  const content = 'Skyjo −2 · Grüße\r\nSecond line\n';
  assert.equal(await writeIfChanged(file, content), true);
  assert.deepEqual(await readFile(file), Buffer.from(content, 'utf8'));
}));

test('unchanged generation preserves timestamps instead of restarting development watchers', async () => fixture(async file => {
  await writeFile(file, 'unchanged\n');
  const fixed = new Date('2020-01-01T00:00:00Z'); await utimes(file, fixed, fixed);
  const before = await stat(file);
  assert.equal(await writeIfChanged(file, 'unchanged\n'), false);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(file, 'utf8'), 'unchanged\n');
}));

test('changed generation replaces content and accepts URL destinations used by pack generators', async () => fixture(async file => {
  await writeFile(file, 'old\n');
  assert.equal(await writeIfChanged(pathToFileURL(file), 'new\n', 'utf8'), true);
  assert.equal(await readFile(file, 'utf8'), 'new\n');
}));

test('generation propagates filesystem errors and leaves directory creation to its caller', async () => fixture(async (file, directory) => {
  await assert.rejects(writeIfChanged(path.join(directory, 'missing', 'output.txt'), 'x'), { code: 'ENOENT' });
  await assert.rejects(writeIfChanged(directory, 'x'));
  await assert.rejects(stat(file), { code: 'ENOENT' });
}));
