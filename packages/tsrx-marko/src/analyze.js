/** @import * as AST from 'estree' */

/**
 * Find `const` bindings anywhere in the component that hold a function
 * expression referenced exactly once, where the single reference is the
 * bare value of an attribute (`<button onClick={fn}>`).
 *
 * Such bindings are inlined as Marko's method-attribute shorthand:
 *
 *   const inc = () => { count += 1; };
 *   <button onClick={inc}>...</button>
 *
 * becomes
 *
 *   <button onClick() { count += 1; }>...</button>
 *
 * which removes the indirection without changing semantics. Marko's
 * `name() { ... }` attribute form binds a method directly on the tag, so
 * the rendered DOM event listener (or component method) is identical to
 * the explicit-binding case. Inlining a function value preserves
 * lexical-scope semantics for any free variables (Marko methods compile
 * down to closures over the surrounding tag variables).
 *
 * The pass runs across **every scope** in the component — nested control
 * flow (`if`/`for`/`switch` bodies, `try`/`catch` blocks) and nested
 * function expressions all participate, because the codegen's
 * `skipped_decls` short-circuit applies wherever a `VariableDeclaration`
 * is emitted.
 *
 * Restrictions (any failure leaves the binding as-is, emitting a normal
 * `<const/...>` declaration):
 *
 *   - Must be `const` (mutability semantics differ for `let`).
 *   - Init must be an `ArrowFunctionExpression` or `FunctionExpression`.
 *   - Exactly one reference, and it must be the entire `value` of an
 *     `Attribute` node (so we don't break composite expressions like
 *     `onClick={() => inc()}` or function-call arguments).
 *   - The declaring `VariableDeclaration` must hold a single declarator
 *     (skipping it would otherwise drop sibling bindings).
 *
 * @param {any} component - TSRX `Component` AST node.
 * @returns {{
 *   inlined_attr_refs: Map<AST.Identifier, any>,
 *   skipped_decls: Set<any>,
 * }}
 */
import { createScopes, ScopeRoot } from '@tsrx/core';
import is_reference from 'is-reference';
import { walk } from 'zimmerframe';

export function analyze_inlinable_methods(component) {
	/** @type {Map<AST.Identifier, any>} */
	const inlined_attr_refs = new Map();
	/** @type {Set<any>} */
	const skipped_decls = new Set();

	const root = new ScopeRoot();
	const { scopes } = createScopes(component, root, null, {});

	// Index every declarator id → enclosing VariableDeclaration across
	// the entire component (not just the body root). The codegen's
	// `skipped_decls` check fires anywhere a `VariableDeclaration` is
	// emitted, so a `const reset = …` inside an `<if>` block can be
	// inlined just like a top-level one.
	/** @type {Map<any, any>} */
	const decl_of_id = new Map();
	walk(/** @type {AST.Node} */ (component), null, {
		VariableDeclaration(node, { next }) {
			for (const d of node.declarations) {
				if (d.id && d.id.type === 'Identifier') decl_of_id.set(d.id, node);
			}
			next();
		},
	});

	for (const [, scope] of scopes) {
		for (const [, binding] of scope.declarations) {
			if (binding.declaration_kind !== 'const') continue;

			const init = binding.initial;
			if (
				!init ||
				(init.type !== 'ArrowFunctionExpression' &&
					init.type !== 'FunctionExpression')
			) {
				continue;
			}

			// `binding.references` from `createScopes` can contain
			// duplicates (some Identifier nodes are reachable via
			// multiple walker paths in the TSRX AST) and may include the
			// declaring id. Dedupe by node identity and filter to
			// genuine reference uses via `is-reference` so the "exactly
			// one" rule reflects real usage.
			const refs = unique_real_refs(binding.references, binding.node);
			if (refs.length !== 1) continue;

			const ref = refs[0];
			const parent = ref.path[ref.path.length - 1];
			// Must be the entire value of an Attribute, not nested
			// inside a containing expression. `parent.value !== ref.node`
			// catches cases like `<button onClick={() => inc()}>` where
			// `inc` is buried in an arrow body.
			if (!parent || parent.type !== 'Attribute' || parent.value !== ref.node) {
				continue;
			}

			const decl = decl_of_id.get(binding.node);
			if (!decl || decl.declarations.length !== 1) continue;

			inlined_attr_refs.set(ref.node, init);
			skipped_decls.add(decl);
		}
	}

	return { inlined_attr_refs, skipped_decls };
}

/**
 * @param {{ node: any, path: any[] }[]} refs
 * @param {any} declaring_id - the binding's declaring Identifier (skipped).
 * @returns {{ node: any, path: any[] }[]}
 */
function unique_real_refs(refs, declaring_id) {
	/** @type {Map<any, { node: any, path: any[] }>} */
	const seen = new Map();
	for (const ref of refs) {
		if (ref.node === declaring_id) continue;
		const parent = ref.path[ref.path.length - 1];
		if (!parent || !is_reference(ref.node, parent)) continue;
		if (!seen.has(ref.node)) seen.set(ref.node, ref);
	}
	return [...seen.values()];
}
