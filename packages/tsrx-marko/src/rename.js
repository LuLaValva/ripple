/** @import * as AST from 'estree' */

/**
 * Rename local bindings whose names collide with Marko's reserved template
 * identifiers. Marko's Tags API treats a handful of names specially:
 *
 *   - `input`    — the implicit template input object
 *   - `$signal`  — abort signal for async tags
 *   - `$global`  — cross-tree global state
 *
 * Declaring a tag variable (`<let/input = ...>`) or loop binding with one
 * of these names causes a "Duplicate declaration" compile error from
 * `@marko/compiler`. Since `.tsrx` source is authored without knowledge of
 * Marko's reserved vocabulary, this module does a scope-aware rename pass:
 *
 *   1. Build a scope tree rooted at the component using the same
 *      `createScopes` machinery tsrx uses elsewhere.
 *   2. For every binding whose identifier name is reserved, pick a unique
 *      `name$N` alias that doesn't collide with any other declared or
 *      referenced name in the component (or the global conflict set).
 *   3. Use `MagicString` to rewrite the declaring identifier and every
 *      reference to the new alias. Shorthand object-pattern properties
 *      (`{ input }`) are expanded to explicit form (`{ input: input$1 }`)
 *      so the local rename doesn't also rename the source property key.
 *
 * The returned `MagicString` serves as a drop-in replacement for the raw
 * `source` string in downstream codegen — both respond to `.slice(start,
 * end)` with (rewritten) text at the given **original** positions.
 *
 * The first-param-named-`input` case gets a short-circuit: if the
 * component's first parameter is literally `function App(input: T)`, we
 * leave that single identifier alone and let body references resolve to
 * Marko's implicit `input`. This keeps the common typed-param idiom
 * emitting clean output without the synthesized alias binding. Any
 * *other* use of `input` (destructured field, body declaration, nested
 * scope) still goes through the rename.
 */

import { createScopes, ScopeRoot } from '@tsrx/core';
import is_reference from 'is-reference';
import MagicString from 'magic-string';
import { walk } from 'zimmerframe';

/** Names Marko's Tags API reserves for its own use. */
const RESERVED = new Set(['input', '$signal', '$global']);

/**
 * Rewrite a component so that every local binding whose name collides with
 * a Marko reserved identifier gets a unique `name$N` alias. Returns a
 * `MagicString` whose `.slice(start, end)` produces the rewritten source
 * at the given **original** source positions.
 *
 * @param {any} component - TSRX `Component` AST node (positions refer into `source`).
 * @param {string} source - original source text this component was parsed from.
 * @returns {MagicString}
 */
export function rewrite_reserved(component, source) {
	const ms = new MagicString(source);

	// Build scope tree. `createScopes(component, ...)` enters the
	// Component handler which creates a child scope seeded with the
	// component's params, then walks the body creating nested scopes for
	// `for`, blocks, arrow functions, etc. After the walk, every binding
	// is reachable from some scope in `scopes`.
	const root = new ScopeRoot();
	const { scopes } = createScopes(component, root, null, {});

	// Index each Identifier by its parent so we can detect shorthand
	// object-pattern properties during rewrite. zimmerframe's walker
	// exposes the current `path`, which ends with the immediate parent of
	// the node being visited.
	/** @type {Map<AST.Identifier, any>} */
	const parent_of = new Map();
	walk(/** @type {AST.Node} */ (component), null, {
		Identifier(node, { path }) {
			parent_of.set(node, path[path.length - 1]);
		},
	});

	// The first-param-named-`input` short-circuit: don't rename the
	// param itself. We still need to rename other reserved-name bindings
	// (including nested uses of `input` in inner scopes, which have
	// their own binding records), so we identify the specific Identifier
	// node to skip.
	const first_param_input =
		component.params &&
		component.params[0] &&
		component.params[0].type === 'Identifier' &&
		component.params[0].name === 'input'
			? component.params[0]
			: null;

	for (const [, scope] of scopes) {
		for (const [name, binding] of scope.declarations) {
			if (!RESERVED.has(name)) continue;

			// Skip the component's own `input` parameter — body
			// references to it can safely resolve to Marko's implicit
			// `input`, and emitting `<const/input = input>` is a no-op
			// we'd rather not pollute the output with.
			if (name === 'input' && binding.node === first_param_input) continue;

			const alias = unique_alias(name, root, binding.scope);
			rewrite_binding(ms, binding, alias, parent_of);
		}
	}

	return ms;
}

/**
 * Pick an alias of the form `<name>$<N>` that doesn't collide with any
 * declaration or reference known to the scope tree, and register it as
 * reserved so subsequent picks don't reuse it.
 *
 * @param {string} base - the original reserved name being aliased.
 * @param {import('@tsrx/core').ScopeRoot} root - scope root carrying the conflict set.
 * @param {import('@tsrx/core').Scope} scope - the declaring scope.
 * @returns {string}
 */
function unique_alias(base, root, scope) {
	let n = 1;
	let candidate = `${base}$${n}`;
	while (
		root.conflicts.has(candidate) ||
		scope.declarations.has(candidate) ||
		RESERVED.has(candidate)
	) {
		n++;
		candidate = `${base}$${n}`;
	}
	root.conflicts.add(candidate);
	return candidate;
}

/**
 * Apply the rename to the declaring identifier plus every recorded
 * reference. Shorthand object-pattern properties become explicit so the
 * source property key stays the original reserved name (`input`) while
 * only the local value binding takes the alias (`input: input$1`).
 *
 * @param {MagicString} ms
 * @param {import('@tsrx/core').Binding} binding
 * @param {string} alias
 * @param {Map<AST.Identifier, any>} parent_of
 */
function rewrite_binding(ms, binding, alias, parent_of) {
	rewrite_identifier(ms, binding.node, alias, parent_of);
	for (const ref of binding.references) {
		rewrite_identifier(ms, ref.node, alias, parent_of);
	}
}

/**
 * @param {MagicString} ms
 * @param {AST.Identifier} node
 * @param {string} alias
 * @param {Map<AST.Identifier, any>} parent_of
 */
function rewrite_identifier(ms, node, alias, parent_of) {
	if (typeof node.start !== 'number' || typeof node.end !== 'number') return;

	const parent = parent_of.get(node);
	if (
		parent &&
		parent.type === 'Property' &&
		parent.shorthand &&
		parent.key === node
	) {
		// Shorthand Property's `key` and `value` point at the same
		// Identifier instance in acorn; `parent.shorthand=true` means the
		// source text is the bare name. Overwriting its range with
		// `name: alias` expands the shorthand and aliases the local
		// binding at the same time, leaving the source property key
		// (`name`) intact for destructuring.
		ms.overwrite(node.start, node.end, `${node.name}: ${alias}`);
		return;
	}

	ms.overwrite(node.start, node.end, alias);
}
