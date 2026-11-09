import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
export const CHECKPOINT = 'a68d476f57ec2ef8ed05ec32d7d5a3011c51ec59';
export const ROLLBACK = '3003ddb433fc420afd54f505005a90d832f78539';
const exports = new Map<string, string>();
const temporaryRoot = realpathSync(tmpdir());
process.once('exit', () => {
  for (const root of exports.values()) {
    // Delete only our own mkdtemp children after checking their absolute resolved targets.
    if (dirname(root) === temporaryRoot && basename(root).startsWith('game-night-history-') && !lstatSync(root).isSymbolicLink() && realpathSync(root) === root) {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

/** Read Git objects, never checkout/reset the user's tree. No dependencies are installed. */
export function historicalSource(commit: string): string {
  if (exports.has(commit)) return exports.get(commit)!;
  try { execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repo, stdio: 'pipe' }); }
  catch { throw new Error(`Compatibility baseline ${commit} is missing. Fetch full Git history (CI uses fetch-depth: 0).`); }
  const root = mkdtempSync(join(temporaryRoot, 'game-night-history-'));
  exports.set(commit, root);
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, '--', 'backend-do/src', 'shared'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  for (const name of names) {
    const target = resolve(root, name.trim());
    if (!target.startsWith(root + sep)) throw new Error('Unexpected Git path');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${commit}:${name.trim()}`], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }));
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  return root;
}

export function importHistorical(commit: string, relative: string): Promise<any> {
  return import(pathToFileURL(join(historicalSource(commit), relative)).href);
}

export function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../fixtures/rooms/${name}.json`, import.meta.url), 'utf8'));
}
