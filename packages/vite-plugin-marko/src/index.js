/** @import { Plugin } from 'vite' */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as path_resolve } from 'node:path';
import { compile } from '@tsrx/marko';

const DEFAULT_TSRX_PATTERN = /\.tsrx$/;
const VIRTUAL_MARKO_SUFFIX = '.marko';

/**
 * Vite plugin that compiles `.tsrx` files to Marko Tags API source via
 * `@tsrx/marko`. It does not invoke Marko's own compiler — instead it
 * rewrites module ids so the upstream `@marko/vite` plugin handles the
 * `.marko` → JS stage.
 *
 * Marko resolves custom tags (`<Child/>`) via filesystem lookup relative
 * to the primary template, so this plugin only supports **single-component
 * `.tsrx` files** today. If a source file declares more than one
 * `component`, the plugin throws with a pointer to splitting the file.
 * The `@tsrx/marko` compiler itself can emit multi-file output; a future
 * iteration of this plugin can wire those siblings to disk.
 *
 * @param {import('../types/index.d.ts').TsrxMarkoOptions} [options]
 * @returns {Plugin}
 */
export function tsrxMarko(options = {}) {
	/** @type {string} */
	let root_dir = process.cwd();

	const include_pattern = options.include ?? DEFAULT_TSRX_PATTERN;

	/**
	 * @param {string} path
	 * @returns {boolean}
	 */
	const is_tsrx_source = (path) => {
		include_pattern.lastIndex = 0;
		return include_pattern.test(path);
	};

	/**
	 * @param {string} id
	 * @returns {boolean}
	 */
	const is_virtual_primary = (id) => {
		if (!id.endsWith(VIRTUAL_MARKO_SUFFIX)) return false;
		return is_tsrx_source(id.slice(0, -VIRTUAL_MARKO_SUFFIX.length));
	};

	/**
	 * @param {string} id
	 * @returns {string}
	 */
	const to_real_tsrx_path = (id) => {
		const stripped = id.slice(0, -VIRTUAL_MARKO_SUFFIX.length);
		if (isAbsolute(stripped) && existsSync(stripped)) return stripped;
		const re_anchored = path_resolve(root_dir, stripped.replace(/^\/+/, ''));
		if (existsSync(re_anchored)) return re_anchored;
		return stripped;
	};

	return {
		name: '@tsrx/vite-plugin-marko',
		enforce: 'pre',

		configResolved(config) {
			root_dir = config.root;
		},

		async resolveId(source, importer, opts) {
			if (is_virtual_primary(source)) return source;

			if (is_tsrx_source(source)) {
				const resolved = await this.resolve(source, importer, {
					...opts,
					skipSelf: true,
				});
				if (resolved && !is_virtual_primary(resolved.id)) {
					return { ...resolved, id: resolved.id + VIRTUAL_MARKO_SUFFIX };
				}
				if (resolved) return resolved;
				return source + VIRTUAL_MARKO_SUFFIX;
			}
			return null;
		},

		async load(id) {
			if (!is_virtual_primary(id)) return null;

			const real_path = to_real_tsrx_path(id.split('?')[0]);
			const source = await readFile(real_path, 'utf-8');
			const { files } = compile(source, real_path);

			if (files.length > 1) {
				const extra = files
					.slice(1)
					.map((f) => ` - ${f.filename}`)
					.join('\n');
				throw new Error(
					`[@tsrx/vite-plugin-marko] ${real_path} declares more than one \`component\`. ` +
						`Marko resolves custom tags via the filesystem, so each component must live ` +
						`in its own \`.tsrx\` file (e.g. \`tags/Child.tsrx\`). ` +
						`Extra components in this file:\n${extra}`,
				);
			}

			return files[0].code;
		},

		handleHotUpdate(ctx) {
			if (!is_tsrx_source(ctx.file)) return;
			const virtual_id = ctx.file + VIRTUAL_MARKO_SUFFIX;
			const mod = ctx.server.moduleGraph.getModuleById(virtual_id);
			if (mod) return [mod, ...ctx.modules];
			return ctx.modules;
		},
	};
}

export default tsrxMarko;
