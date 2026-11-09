import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const name = resolve(folder, entry.name);
    return entry.isDirectory() ? files(name) : /\.(?:[cm]?[jt]sx?)$/.test(name) ? [name] : [];
  });
}

test('browser and shared modules cannot import backend implementations or private generated banks', () => {
  const forbidden: string[] = [];
  for (const name of [...files(resolve(root, 'frontend/src')), ...files(resolve(root, 'shared'))]) {
    const ast = ts.createSourceFile(name, readFileSync(name, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = (specifier: string) => {
      const target = specifier.startsWith('.') ? resolve(dirname(name), specifier) : specifier;
      if (target.startsWith(resolve(root, 'backend-do') + sep) || /(?:backend-do|generated\/(?:soundsFishyBanks|justOneTranslations))/.test(specifier)) forbidden.push(`${relative(root, name)} → ${specifier}`);
    };
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(forbidden, []);
});

test('both Wrangler entry points retain identical bindings, migrations, resources and defaults', () => {
  // Conservative text comparison for these small configs. Preserve section/array order;
  // allow field order, whitespace, trailing commas and the expected relative main path.
  const normalize = (name: string) => {
    const source = readFileSync(resolve(root, name), 'utf8');
    const main = source.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
    assert.ok(main, `${name}: main entry`);
    const blocks: string[][] = [[]];
    for (const raw of source.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || /^main\s*=/.test(line)) continue;
      if (/^\[/.test(line)) blocks.push([line]);
      else blocks.at(-1)!.push(line.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '').replace(/,$/, ''));
    }
    return { main: resolve(dirname(resolve(root, name)), main), blocks: blocks.map(([first, ...rest], i) => i === 0 ? [first, ...rest].sort() : [first, ...rest.sort()]) };
  };
  assert.deepEqual(normalize('wrangler.toml'), normalize('backend-do/wrangler.toml'));
});
