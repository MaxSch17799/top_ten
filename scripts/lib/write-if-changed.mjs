import { readFile, writeFile } from 'node:fs/promises';

/** Preserve unchanged generated files so sync does not trigger needless rebuilds. */
export async function writeIfChanged(file, content, encoding = 'utf8') {
  const next = Buffer.from(content, encoding);
  try {
    if ((await readFile(file)).equals(next)) return false;
  } catch (error) {
    // A missing output is normal on a clean checkout. Other errors must stay visible.
    if (error.code !== 'ENOENT') throw error;
  }
  // Callers own output-directory creation, just as with fs.writeFile.
  await writeFile(file, next);
  return true;
}
