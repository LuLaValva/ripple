/** @import * as AST from 'estree' */

/**
 * Orchestrator for the Marko target. Given a TSRX `Program`, partition the
 * top-level declarations into:
 *
 *   - The **primary component**: first `export`ed `component`, falling back
 *     to the last `component` declaration (matching Marko's convention of
 *     one component per file and the informal tsrx default).
 *   - **Additional components**: each becomes a sibling `tags/Name.marko`.
 *   - **Module-scope statements** (imports, exports, type aliases,
 *     functions): forwarded into the emitted Marko file via source slicing,
 *     which matches Marko's support for top-level `import`, `export`, and
 *     `static` blocks (see language.md#statements).
 */

import {
	annotateComponentWithHash,
	create_compile_error,
	isStyleElement,
	prepareStylesheetForRender,
	renderStylesheets,
} from '@tsrx/core';
import { analyze_inlinable_methods } from './analyze.js';
import { emit_component } from './codegen.js';
import { rewrite_reserved } from './rename.js';

/**
 * @typedef {{
 *   filename: string,
 *   code: string,
 *   map: any,
 * }} MarkoFile
 */

/**
 * @typedef {{
 *   ast: AST.Program,
 *   code: string,
 *   map: any,
 *   files: MarkoFile[],
 * }} TransformResult
 */

/**
 * @param {AST.Program} ast
 * @param {string} source
 * @param {string} [filename]
 * @returns {TransformResult}
 */
export function transform(ast, source, filename) {
	const components = [];
	/** @type {any[]} */
	const module_scope = [];

	for (const node of ast.body) {
		if (is_component_declaration(node)) {
			components.push({ node, exported: false });
			continue;
		}
		if (
			node.type === 'ExportNamedDeclaration' &&
			node.declaration &&
			is_component_declaration(node.declaration)
		) {
			components.push({ node: node.declaration, exported: true, export_node: node });
			continue;
		}
		if (
			node.type === 'ExportDefaultDeclaration' &&
			is_component_declaration(node.declaration)
		) {
			components.push({
				node: /** @type {any} */ (node.declaration),
				exported: true,
				export_node: node,
			});
			continue;
		}
		module_scope.push(node);
	}

	if (components.length === 0) {
		throw new Error(
			`@tsrx/marko: no \`component\` declaration found${filename ? ` in ${filename}` : ''}. A Marko template must define at least one component.`,
		);
	}

	// Primary = last declared component. Matches the convention in
	// hand-written TSRX examples where helper components come first and the
	// root (`App`, `Page`, etc.) sits at the bottom of the file. Export
	// status is intentionally ignored — users often export every component
	// (especially under TS isolated-modules), so "first exported" would be
	// surprising. If the user wants a different primary they can reorder
	// declarations or pass the intended filename explicitly.
	const primary_index = components.length - 1;

	const primary = components[primary_index];
	const extras = components.filter((_, i) => i !== primary_index);

	// Scoped CSS: apply the scope-hash class to every element in each
	// component that has a `<style>` block, then strip the `<style>`
	// element from the body so the codegen doesn't treat it as markup.
	const primary_css = lift_stylesheet(primary.node);
	for (const extra of extras) lift_stylesheet(extra.node);

	const module_preamble = emit_module_preamble(module_scope, source, extras);

	// Per-component rename pass: bindings named `input`, `$signal`,
	// `$global` collide with Marko's reserved identifiers. `rewrite_reserved`
	// returns a `MagicString` whose `.slice(start, end)` yields the
	// rewritten text at the original positions, so the downstream codegen
	// can keep slicing by AST position without knowing about renames.
	const primary_body = emit_component(
		primary.node,
		rewrite_reserved(primary.node, source),
		analyze_inlinable_methods(primary.node),
	);
	const primary_style_block = primary_css ? render_marko_style_block(primary_css) : '';
	const primary_code = [module_preamble, primary_body, primary_style_block]
		.filter(Boolean)
		.join('\n');

	const primary_filename = marko_filename_for(primary.node, filename);

	/** @type {MarkoFile[]} */
	const files = [
		{
			filename: primary_filename,
			code: primary_code,
			map: null,
		},
	];

	for (const extra of extras) {
		const name = component_name(extra.node);
		const extra_body = emit_component(
			extra.node,
			rewrite_reserved(extra.node, source),
			analyze_inlinable_methods(extra.node),
		);
		const extra_css = extra.node._extracted_css;
		const extra_style = extra_css ? render_marko_style_block(extra_css) : '';
		const code = [extra_body, extra_style].filter(Boolean).join('\n');
		files.push({
			filename: sibling_path(primary_filename, name),
			code,
			map: null,
		});
	}

	return {
		ast,
		code: primary_code,
		map: null,
		files,
	};
}

/**
 * Extract and normalize the `<style>` block from a component:
 *
 *   1. Annotate all elements in the component with the scope hash class so
 *      `.foo { ... }` selectors generated by `@tsrx/core` target only
 *      instances inside this component.
 *   2. Remove the `<style>` element from the body (it was already lifted
 *      into `component.css` by the parser — keeping it in `body` would
 *      cause the codegen to re-emit it as generic markup with mangled
 *      children).
 *   3. Render the CSS AST back to text for emission.
 *
 * @param {any} component
 * @returns {{ rendered: string, hash: string } | null}
 */
function lift_stylesheet(component) {
	if (!component.css) return null;

	annotateComponentWithHash(component, component.css.hash, 'class');

	component.body = (component.body || []).filter(
		(/** @type {any} */ child) => !isStyleElement(child),
	);

	const rendered = renderStylesheets([prepareStylesheetForRender(component.css)]);
	const result = { rendered, hash: component.css.hash };
	component._extracted_css = result;
	return result;
}

/**
 * Wrap rendered CSS in a Marko `<style>` block.
 *
 * Marko's `<style>` native-tag variant treats its children as raw CSS (see
 * native-tag.md#text-content). The rendered stylesheet from `@tsrx/core`
 * preserves the original `.tsrx` source's surrounding whitespace — useful
 * for source maps, but visually noisy in the emitted template. We
 * trim the overall block and dedent uniformly based on the first non-empty
 * line, then re-indent by two spaces so the `<style>` body reads as a
 * normal indented CSS block.
 *
 * @param {{ rendered: string, hash: string }} css
 * @returns {string}
 */
function render_marko_style_block(css) {
	const trimmed = css.rendered.replace(/^\s*\n/, '').replace(/\s+$/, '');
	if (!trimmed) return `<style></style>\n`;

	const lines = trimmed.split('\n');
	let min_indent = Infinity;
	for (const line of lines) {
		if (!line.trim()) continue;
		const match = line.match(/^[ \t]*/);
		min_indent = Math.min(min_indent, match ? match[0].length : 0);
	}
	const dedented = lines
		.map((line) => (line.length >= min_indent ? line.slice(min_indent) : line))
		.map((line) => (line ? `  ${line}` : ''))
		.join('\n');
	return `<style>\n${dedented}\n</style>\n`;
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function is_component_declaration(node) {
	return node && node.type === 'Component';
}

/**
 * Emit the module-scope preamble for the primary file. Import/export
 * statements and top-level declarations from the source are preserved
 * verbatim via source slicing. Siblings (each extra component) don't need
 * explicit imports — Marko's relative tag discovery at `tags/Name.marko`
 * resolves `<Name/>` references automatically.
 *
 * @param {any[]} module_scope
 * @param {string} source
 * @param {{ node: any }[]} extras
 * @returns {string}
 */
function emit_module_preamble(module_scope, source, extras) {
	void extras;
	if (module_scope.length === 0) return '';

	const parts = [];
	for (const node of module_scope) {
		if (typeof node.start === 'number' && typeof node.end === 'number') {
			parts.push(source.slice(node.start, node.end));
		}
	}
	return parts.join('\n');
}

/**
 * @param {any} component
 * @returns {string}
 */
function component_name(component) {
	if (component.id && component.id.name) return component.id.name;
	throw create_compile_error(
		component,
		'Anonymous `component` declarations are not supported on the Marko target.',
	);
}

/**
 * Derive the primary `.marko` filename from the input path. When `filename`
 * is missing or doesn't end with `.tsrx`, fall back to the component name.
 *
 * @param {any} component
 * @param {string} [filename]
 * @returns {string}
 */
function marko_filename_for(component, filename) {
	if (filename) {
		return filename.replace(/\.tsrx$/i, '.marko');
	}
	return `${component_name(component)}.marko`;
}

/**
 * @param {string} primary_filename
 * @param {string} name
 * @returns {string}
 */
function sibling_path(primary_filename, name) {
	const slash = primary_filename.lastIndexOf('/');
	const dir = slash === -1 ? '' : primary_filename.slice(0, slash + 1);
	return `${dir}tags/${name}.marko`;
}
