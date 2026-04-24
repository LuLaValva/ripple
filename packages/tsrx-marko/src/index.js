/** @import * as AST from 'estree' */
/** @import { ParseOptions } from '@tsrx/core/types' */

import { parseModule } from '@tsrx/core';
import { transform } from './transform.js';

/**
 * Parse tsrx-marko source to an ESTree+TSRX AST.
 * @param {string} source
 * @param {string} [filename]
 * @param {ParseOptions} [options]
 * @returns {AST.Program}
 */
export function parse(source, filename, options) {
	return parseModule(source, filename, options);
}

/**
 * Compile a `.tsrx` source module to Marko Tags API template text.
 *
 * When the source declares multiple `component`s, the primary component
 * becomes the root of `code` and each additional component is emitted as a
 * sibling file under `tags/Name.marko` (returned via `files`). Downstream
 * tooling that can emit multiple virtual files should prefer `files`;
 * single-file consumers can read `code` alone.
 *
 * Scoped CSS lives inside the emitted `.marko` source as a `<style>`
 * block; `@marko/compiler` is responsible for hoisting it into a separate
 * stylesheet asset. We deliberately do **not** return the raw CSS as a
 * separate field — emitting both would have the upstream Marko build
 * extract the same styles twice.
 *
 * @param {string} source
 * @param {string} [filename]
 * @returns {{
 *   code: string,
 *   map: any,
 *   files: { filename: string, code: string, map: any }[],
 * }}
 */
export function compile(source, filename) {
	const ast = parseModule(source, filename);
	const { ast: _ast, ...result } = transform(ast, source, filename);
	return result;
}

/**
 * Stub for Volar mapping support. Marko has a different editor-tooling
 * story (`@marko/language-server`) so we don't synthesize virtual-TS
 * mappings here. Returns an empty mappings result shaped like the other
 * targets' so integrations that opt into Volar at least don't crash.
 *
 * @param {string} source
 * @param {string} [filename]
 * @param {ParseOptions} [options]
 * @returns {{ code: string, mappings: any[], errors: any[] }}
 */
export function compile_to_volar_mappings(source, filename, options) {
	void options;
	const ast = parseModule(source, filename);
	const transformed = transform(ast, source, filename);
	return {
		code: transformed.code,
		mappings: [],
		errors: [],
	};
}
