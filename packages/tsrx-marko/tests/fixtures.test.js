import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';

/**
 * Each fixture lives at `fixtures/<name>/` and contains:
 *
 *   - `index.tsrx` — the TSRX source to compile
 *   - `__snapshots__/<file>.marko` — the expected output for each emitted
 *     file. The relative layout under `__snapshots__/` mirrors the real
 *     emit layout exactly, so a multi-component file produces both
 *     `__snapshots__/index.marko` and `__snapshots__/tags/Child.marko`.
 *
 * Run `pnpm vitest run --project tsrx-marko -u` to (re)generate snapshots.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures_root = join(here, 'fixtures');

const fixtures = readdirSync(fixtures_root)
	.filter((name) => statSync(join(fixtures_root, name)).isDirectory())
	.sort();

describe('@tsrx/marko fixtures', () => {
	for (const name of fixtures) {
		it(name, async () => {
			const dir = join(fixtures_root, name);
			const source = readFileSync(join(dir, 'index.tsrx'), 'utf8');
			const { files } = compile(source, 'index.tsrx');

			for (const file of files) {
				await expect(file.code).toMatchFileSnapshot(
					join(dir, '__snapshots__', file.filename),
				);
			}
		});
	}
});
