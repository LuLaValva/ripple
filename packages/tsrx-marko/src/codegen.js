/** @import * as AST from 'estree' */

/**
 * Emit Marko Tags API template text from a TSRX `Component` AST.
 *
 * The emitter is deliberately simple: it walks the component's body and
 * produces indented Marko source. JS expressions are stringified by slicing
 * the original source using their `start`/`end` positions — this preserves
 * user formatting and TypeScript annotations without needing a JS printer.
 *
 * Synthetic expressions created during transform (e.g. `!cond` for an
 * early-return) carry a `synthetic_text` property populated by the
 * transform layer.
 */

import { create_compile_error } from '@tsrx/core';

/**
 * `source` is a sliceable reference to the component's source text —
 * either the raw string or a `MagicString` produced by the rename pass.
 * Both respond to `.slice(start, end)` with (possibly rewritten) text at
 * the given original positions, so callers never need to care which one
 * they've got.
 *
 * @typedef {{ slice(start: number, end: number): string }} Sliceable
 */

/**
 * @typedef {{
 *   inlined_attr_refs: Map<AST.Identifier, any>,
 *   skipped_decls: Set<any>,
 * }} InlineAnalysis
 */

/**
 * @typedef {{
 *   source: Sliceable,
 *   ref_counter: { n: number },
 *   inlined_attr_refs: Map<AST.Identifier, any>,
 *   skipped_decls: Set<any>,
 *   warn?: (msg: string) => void,
 * }} EmitContext
 */

/**
 * Emit Marko source for one component declaration.
 *
 * @param {any} component - TSRX `Component` AST node
 * @param {Sliceable} source - rewritten (post-rename) source text
 * @param {InlineAnalysis} [analysis] - inlinable-method analysis from `analyze.js`
 * @returns {string}
 */
export function emit_component(component, source, analysis) {
	/** @type {EmitContext} */
	const ctx = {
		source,
		ref_counter: { n: 0 },
		inlined_attr_refs: analysis ? analysis.inlined_attr_refs : new Map(),
		skipped_decls: analysis ? analysis.skipped_decls : new Set(),
	};
	/** @type {string[]} */
	const lines = [];

	const input_type = extract_input_type(component, source);
	if (input_type !== null) {
		lines.push(
			input_type.kind === 'interface'
				? `export interface Input ${input_type.text}`
				: `export type Input = ${input_type.text};`,
		);
		lines.push('');
	}

	const input_binding = extract_input_binding(component, source);
	if (input_binding !== null) {
		lines.push(input_binding);
		lines.push('');
	}

	for (const stmt of component.body || []) {
		emit_statement(stmt, lines, 0, ctx);
	}

	// Trim trailing blank lines, ensure single trailing newline.
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	lines.push('');
	return lines.join('\n');
}

/**
 * Re-bind the component's first param against Marko's built-in `input`
 * object so user-written references keep working without a full
 * scope-aware identifier rewrite.
 *
 * - `({ name, count }: T)` → `<const/{ name, count } = input>`
 * - `(props: T)` → `<const/props = input>`
 * - `(_: T)` / no param → omitted
 * - `(input: T)` → omitted (the rename pass leaves the literal `input`
 *   param in place; body references resolve directly to Marko's implicit
 *   `input`, so an alias binding would be redundant)
 *
 * The `<const/...=input>` tag variable pattern is standard Marko — tag
 * variables accept destructure patterns (see language.md#tag-variables).
 * This is far simpler than walking the component body to rewrite every
 * reference, and it composes with nested scopes naturally: shadowing
 * `const name = ...` inside a `<for>` body wins because tag variables
 * obey JS lexical scoping.
 *
 * @param {any} component
 * @param {Sliceable} source
 * @returns {string | null}
 */
function extract_input_binding(component, source) {
	const params = component.params || [];
	if (params.length === 0) return null;

	const first = params[0];
	if (!first) return null;

	// Strip the param's type annotation when slicing so we don't duplicate
	// the type that already went into `export type Input`.
	const end =
		first.typeAnnotation && typeof first.typeAnnotation.start === 'number'
			? first.typeAnnotation.start
			: first.end;
	const start = first.start;
	if (typeof start !== 'number' || typeof end !== 'number') return null;

	const pattern_text = source.slice(start, end).trim();
	if (!pattern_text) return null;

	// Identifier with a throwaway name (`_`) adds no value — skip the alias.
	if (first.type === 'Identifier' && pattern_text === '_') return null;

	// `component App(input: ...)` — the rename pass leaves this sole
	// binding as `input` so body references resolve directly to Marko's
	// implicit input object; a synthesized `<const/input = input>` alias
	// would be both redundant and a duplicate-declaration error.
	if (first.type === 'Identifier' && pattern_text === 'input') return null;

	return `<const/${pattern_text} = input>`;
}

/**
 * Derive Marko's `export Input` declaration from the first component
 * parameter's type annotation. Returns `null` if no annotation is
 * present.
 *
 * Prefers `export interface Input { ... }` when the annotation is a bare
 * object type literal (`{ ... }`), since the interface form composes
 * with `declare module` augmentation downstream and reads more naturally
 * to TS users. Bails to `export type Input = ...;` for anything else
 * (type references, unions, intersections, mapped types, function types,
 * etc.) where the alias form is required or strictly clearer.
 *
 * @param {any} component
 * @param {Sliceable} source
 * @returns {{ kind: 'type' | 'interface', text: string } | null}
 */
function extract_input_type(component, source) {
	const params = component.params || [];
	if (params.length === 0) return null;

	const first = params[0];
	const annotation = first && first.typeAnnotation;
	if (!annotation) return null;

	// `typeAnnotation` is a TSTypeAnnotation wrapper; the actual type is in
	// `annotation.typeAnnotation`. Slice the original source between the
	// colon-separator end and the annotation end to get the typed form.
	const inner = annotation.typeAnnotation;
	if (!inner || typeof inner.start !== 'number' || typeof inner.end !== 'number') {
		return null;
	}
	const text = source.slice(inner.start, inner.end).trim();
	const kind = inner.type === 'TSTypeLiteral' ? 'interface' : 'type';
	return { kind, text };
}

// =====================================================================
// Statement emission
// =====================================================================

/**
 * @param {any} stmt
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_statement(stmt, lines, indent, ctx) {
	if (!stmt) return;

	switch (stmt.type) {
		case 'Element':
			emit_element(stmt, lines, indent, ctx);
			return;
		case 'TSRXExpression':
		case 'Text': {
			const text = format_text_expression(stmt.expression, ctx);
			// At the component-body root we're in Marko's concise mode (no
			// enclosing HTML-mode tag), so a bare line like `Hello` would be
			// parsed as a tag named "Hello" and `${count}` as a scriptlet.
			// Concise text content needs the `--` prefix to disambiguate.
			// Inside an element's HTML body (indent > 0 under a `<div>` etc.)
			// children are already in HTML mode, so plain text/placeholders
			// emit fine.
			push_line(lines, indent, indent === 0 ? `-- ${text}` : text);
			return;
		}
		case 'Html': {
			const html = `$!{${slice(ctx.source, stmt.expression)}}`;
			push_line(lines, indent, indent === 0 ? `-- ${html}` : html);
			return;
		}
		case 'IfStatement':
			emit_if(stmt, lines, indent, ctx);
			return;
		case 'ForOfStatement':
			emit_for_of(stmt, lines, indent, ctx);
			return;
		case 'SwitchStatement':
			emit_switch(stmt, lines, indent, ctx);
			return;
		case 'TryStatement':
			emit_try(stmt, lines, indent, ctx);
			return;
		case 'ReturnStatement':
			// Bare `return;` — handled structurally in transform by lifting
			// remaining JSX into `<if=!cond>`. At emit time, stray returns
			// become empty lines. Non-empty returns are a compile error.
			if (stmt.argument) {
				throw create_compile_error(
					stmt,
					'`return <expr>;` is not supported in a Marko component body. Use a bare `return;` or restructure the template.',
				);
			}
			return;
		case 'EmptyStatement':
			return;
		case 'BlockStatement':
			for (const s of stmt.body) emit_statement(s, lines, indent, ctx);
			return;
		case 'VariableDeclaration':
			// `analyze_inlinable_methods` flags declarations whose binding
			// is folded into a `name() { ... }` attribute downstream — the
			// `<const/...>` line would be unreachable code.
			if (ctx.skipped_decls.has(stmt)) return;
			emit_variable_declaration(stmt, lines, indent, ctx);
			return;
		case 'Tsx':
		case 'TsxCompat':
			throw create_compile_error(
				stmt,
				'The `<tsx>...</tsx>` escape-hatch (and fragment shorthand `<>...</>`) is not yet supported by the Marko target. Wrap the markup in a concrete element or move it into a sibling component.',
			);
		default:
			// Any remaining statement (ExpressionStatement, Declarations of
			// function/class, etc.) is passed through as a Marko module-level
			// statement via source slicing. This matches Marko's ability to
			// accept `import`, `export`, and `static` at the top level, and
			// it keeps behavior predictable for unfamiliar nodes rather than
			// silently dropping them.
			push_line(lines, indent, slice(ctx.source, stmt));
	}
}

/**
 * Lower a `VariableDeclaration` in component body to Marko tag variables.
 *
 * - `const x = expr;` → `<const/x=expr>` (reactive derivation)
 * - `let x = expr;` / `var x = expr;` → `<let/x=expr>` (mutable state)
 *
 * Multi-declarator forms are rejected — the Tags API models each binding as
 * a separate tag, so `const [a, b] = expr` or `const a = 1, b = 2` would
 * need user-level splitting to preserve intent.
 *
 * @param {any} decl
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_variable_declaration(decl, lines, indent, ctx) {
	if (decl.declarations.length !== 1) {
		throw create_compile_error(
			decl,
			'Multi-declarator `const`/`let` is not supported in a Marko component body. Split into separate declarations.',
		);
	}
	const d = decl.declarations[0];
	if (d.id.type !== 'Identifier') {
		// Lazy `&[...]` / `&{...}` destructure patterns are flagged by the
		// parser with `lazy: true` on the ArrayPattern / ObjectPattern.
		if (d.id.lazy === true) {
			throw create_compile_error(
				decl,
				'`&[...]` / `&{...}` lazy destructuring is not yet supported by the Marko target.',
			);
		}

		// Plain destructuring — emit as a single Marko tag variable using
		// source slicing so the binding survives intact. Marko accepts
		// destructure patterns in tag variables (see language.md#tag-variables).
		const pattern_text = slice(ctx.source, d.id);
		const init_text = d.init ? slice(ctx.source, d.init) : 'undefined';
		const tag_name = decl.kind === 'const' ? 'const' : 'let';
		push_line(
			lines,
			indent,
			`<${tag_name}/${pattern_text}=${wrap_if_needed(init_text)}>`,
		);
		return;
	}

	const name = d.id.name;
	const init = d.init ? slice(ctx.source, d.init) : 'undefined';
	const tag = decl.kind === 'const' ? 'const' : 'let';
	push_line(lines, indent, `<${tag}/${name}=${wrap_if_needed(init)}>`);
}

// =====================================================================
// Elements
// =====================================================================

/**
 * @param {any} element
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_element(element, lines, indent, ctx) {
	if (!element.id) {
		throw create_compile_error(
			element,
			'Fragment elements are not supported on the Marko target. Use a concrete tag or wrap children in a parent element.',
		);
	}

	const tag_name = element.id.name;

	/** @type {string[]} */
	const attr_parts = [];
	/** @type {string | null} */
	let tag_var = null;
	/**
	 * Mount-time `<script>` lines to push *after* the element. Used by
	 * callback refs (`{ref (node) => ...}`), which become a tag variable
	 * plus a `<script>` block invoking the user's callback.
	 *
	 * @type {string[]}
	 */
	const trailing_scripts = [];

	for (const attr of element.attributes || []) {
		if (!attr) continue;

		if (attr.type === 'RefAttribute') {
			// Marko tag variables (`<tag/name>`) work uniformly for native
			// and custom tags — native tags expose the DOM node, custom
			// tags expose whatever the component `return`s. tsrx's `{ref x}`
			// maps onto the same concept, so we emit the tag-variable form
			// on both sides.
			if (tag_var !== null) {
				throw create_compile_error(
					attr,
					'Multiple `ref` attributes on a single tag are not supported on the Marko target. Marko allows one tag variable per tag.',
				);
			}

			if (attr.argument.type === 'Identifier') {
				tag_var = attr.argument.name;
				continue;
			}

			// Callback ref like `{ref (node) => node.focus()}` or
			// `{ref handlerFn}`-as-call-expression: Marko has no built-in
			// callback-ref API, so we synthesize one.
			//
			//   1. Bind the element to a fresh tag variable
			//      (`_marko_ref$<N>`). The `_marko_` prefix + `$` infix
			//      keeps it unlikely to clash with user identifiers (the
			//      reserved-name rename pass uses the same `$N` namespace
			//      but with bare `input`/`$signal`/`$global` bases).
			//   2. Push a `<script>` block invoking the user's callback
			//      with that tag variable. Marko runs `<script>` blocks
			//      on mount and re-runs them when their dependencies
			//      change (the tag variable's identity is stable, so it
			//      effectively runs once per element instance).
			//
			// Tag variables in Marko's Tags API are reactive getters: in
			// template/attribute position Marko unwraps them implicitly,
			// but inside a `<script>` block we're in raw JS and must call
			// the getter to read the underlying value (the DOM node for
			// native tags, the component return for custom tags).
			//
			// The callback expression is wrapped in parens so any callable
			// form works — arrow, function expression, or a name that
			// resolves to a function.
			ctx.ref_counter.n++;
			const temp = `_marko_ref$${ctx.ref_counter.n}`;
			const callback = slice(ctx.source, attr.argument);
			tag_var = temp;
			trailing_scripts.push(`<script>(${callback})(${temp}())</script>`);
			continue;
		}

		if (attr.type === 'SpreadAttribute') {
			const raw = slice(ctx.source, attr.argument);
			attr_parts.push(`...${wrap_if_needed(raw)}`);
			continue;
		}

		if (attr.type === 'Attribute') {
			attr_parts.push(format_attribute(attr, ctx));
			continue;
		}
	}

	// Opening tag
	let header = `<${tag_name}`;
	if (tag_var !== null) header += `/${tag_var}`;
	if (attr_parts.length > 0) header += ' ' + attr_parts.join(' ');

	const children = element.children || [];
	const has_children = children.length > 0 && !element.selfClosing;

	if (!has_children) {
		// Marko requires self-closing for void elements; `<tag/>` is safe for
		// any element with no content (see language.md: "All tags can be
		// self closed when there is no content").
		push_line(lines, indent, `${header}/>`);
		for (const s of trailing_scripts) push_line(lines, indent, s);
		return;
	}

	header += '>';

	// All-inline children (text/expression/html) collapse onto a single
	// line so no synthetic whitespace is introduced between them. This
	// matters for cases like `<p>{'Hello, '}{name}{'!'}</p>` where the
	// space before `name` and the punctuation after must not become a
	// newline+indent pair (which Marko's HTML mode would render as a
	// space *and* eat the original spacing).
	if (children.every(is_simple_inline)) {
		const inline = children.map((c) => emit_inline_child(c, ctx)).join('');
		push_line(lines, indent, `${header}${inline}</${tag_name}>`);
		for (const s of trailing_scripts) push_line(lines, indent, s);
		return;
	}

	push_line(lines, indent, header);
	for (const child of children) emit_statement(child, lines, indent + 1, ctx);
	push_line(lines, indent, `</${tag_name}>`);
	for (const s of trailing_scripts) push_line(lines, indent, s);
}

/**
 * @param {any} child
 * @returns {boolean}
 */
function is_simple_inline(child) {
	if (!child) return false;
	return child.type === 'TSRXExpression' || child.type === 'Text' || child.type === 'Html';
}

/**
 * @param {any} child
 * @param {EmitContext} ctx
 * @returns {string}
 */
function emit_inline_child(child, ctx) {
	if (child.type === 'Html') return `$!{${slice(ctx.source, child.expression)}}`;
	return format_text_expression(child.expression, ctx);
}

/**
 * Render an expression in Marko text/placeholder context. Tries, in order:
 *
 *   1. Bare string literal (`{'hi'}` → `hi`).
 *   2. Template literal flattened into a Marko text run with embedded
 *      placeholders (`{`Count: ${n}`}` → `Count: ${n}`). This avoids the
 *      ugly double-wrap (`${`Count: ${n}`}`) that an opaque `${...}`
 *      fallback would produce, and it lets Marko's text grammar tokenize
 *      the static parts directly.
 *   3. Generic `${ <expr> }` placeholder fallback.
 *
 * @param {any} expr
 * @param {EmitContext} ctx
 * @returns {string}
 */
function format_text_expression(expr, ctx) {
	const literal = try_inline_string_literal(expr);
	if (literal !== null) return literal;

	const flat = try_inline_template_literal(expr, ctx);
	if (flat !== null) return flat;

	return `\${${slice(ctx.source, expr)}}`;
}

/**
 * Collapse `{'literal text'}` and `{text 'literal'}` down to the raw text,
 * so `<p>{'hi'}</p>` emits as `<p>hi</p>` instead of `<p>${'hi'}</p>`.
 *
 * Returns `null` (i.e. "use `${...}` fallback") whenever the string contains
 * characters that would be misinterpreted by Marko's template lexer:
 *
 *   - `<` / `>` / `&` — HTML entity-land; entering that as literal text would
 *     break element boundaries or introduce accidental markup.
 *   - `$` — Marko interpolation prefix; `$` followed by `{` or `!` is
 *     special, so avoiding `$` entirely keeps the behavior predictable.
 *   - `{` / `}` / backtick / backslash — reserved characters in Marko's
 *     body grammar.
 *   - `\n` / `\r` — would silently reflow the template layout.
 *
 * For the handful of strings that contain anything on that list, falling
 * back to `${'...'}` preserves the original semantics exactly.
 *
 * @param {any} expr
 * @returns {string | null}
 */
function try_inline_string_literal(expr) {
	if (!expr || expr.type !== 'Literal' || typeof expr.value !== 'string') {
		return null;
	}
	const value = expr.value;
	if (/[<>&$`{}\\\r\n]/.test(value) || /[\x00-\x1F]/.test(value)) return null;
	return value;
}

/**
 * Flatten a tagged-free template literal into a Marko text run with native
 * `${...}` placeholders embedded.
 *
 *   `Count: ${count}` → `Count: ${count}`
 *
 * Each static `quasi` segment must be safe to drop into Marko text mode
 * (same conservative reject-set as `try_inline_string_literal`). Each
 * embedded expression is preserved verbatim by source slicing, so any TS
 * annotations or formatting the user wrote survive.
 *
 * Returns `null` when the template can't be safely flattened — the caller
 * falls back to the opaque `${ <template-literal> }` form, which is always
 * correct (just less readable).
 *
 * @param {any} expr
 * @param {EmitContext} ctx
 * @returns {string | null}
 */
function try_inline_template_literal(expr, ctx) {
	if (!expr || expr.type !== 'TemplateLiteral') return null;

	let out = '';
	for (let i = 0; i < expr.quasis.length; i++) {
		const quasi = expr.quasis[i];
		const cooked = quasi.value && typeof quasi.value.cooked === 'string'
			? quasi.value.cooked
			: null;
		if (cooked === null) return null;
		// Same reject-set as `try_inline_string_literal`: any of these
		// would alter Marko's text grammar (entity/markup boundaries,
		// placeholder/scriptlet prefixes, escape characters, layout-
		// breaking newlines).
		if (/[<>&$`{}\\\r\n]/.test(cooked) || /[\x00-\x1F]/.test(cooked)) {
			return null;
		}
		out += cooked;

		if (i < expr.expressions.length) {
			out += `\${${slice(ctx.source, expr.expressions[i])}}`;
		}
	}
	return out;
}

/**
 * @param {any} attr
 * @param {EmitContext} ctx
 * @returns {string}
 */
function format_attribute(attr, ctx) {
	const name = attr.name.name;
	const value = attr.value;

	if (value == null) {
		// Boolean-style attribute: `<input disabled/>` → `disabled`.
		return name;
	}

	// Inline single-use function consts: when the analyzer marks this
	// reference, the corresponding `<const/>` was already skipped, so we
	// emit Marko's method shorthand here to keep the body intact.
	if (value.type === 'Identifier') {
		const fn = ctx.inlined_attr_refs.get(value);
		if (fn) return format_method_attribute(name, fn, ctx);
	}

	// Inline function expression literally written in the attribute —
	// `onClick={() => increment()}` reads better as the equivalent
	// `onClick() { increment(); }` shorthand. Marko compiles both forms
	// identically, so this is a pure formatting win.
	if (
		value.type === 'ArrowFunctionExpression' ||
		value.type === 'FunctionExpression'
	) {
		return format_method_attribute(name, value, ctx);
	}

	// Shorthand attribute (`{value}`): the parser collapses `name` and
	// `value` to the same Identifier with a zero-width source range, so
	// slicing the expression text yields an empty string. Emit the
	// explicit `name=name` form, which Marko accepts and which preserves
	// the binding lookup at the original identifier name. (This branch
	// is below the inline-method branch so a `{onClickFn}` shorthand
	// pointing at a single-use function const still folds into the
	// `onClick() { ... }` method form.)
	if (attr.shorthand === true) {
		return `${name}=${name}`;
	}

	if (value.type === 'Literal' && typeof value.value === 'string') {
		// Preserve the raw quoted string form. The parser stores the raw form
		// (including the surrounding quotes) on `raw`.
		return `${name}=${value.raw ?? JSON.stringify(value.value)}`;
	}

	const raw = slice(ctx.source, value);
	return `${name}=${wrap_if_needed(raw)}`;
}

/**
 * Format a function expression as a Marko method attribute (`name() { ... }`).
 *
 *   `() => { foo(); }` → `onClick() { foo(); }`
 *   `function (e) { foo(e); }` → `onClick(e) { foo(e); }`
 *   `() => count + 1` → `onClick() { return count + 1; }`
 *
 * Params and body are taken verbatim by source-slicing. For an arrow with
 * an expression body we synthesize a `return` so the lifted method still
 * produces the same value.
 *
 * @param {string} name
 * @param {any} fn - ArrowFunctionExpression or FunctionExpression
 * @param {EmitContext} ctx
 * @returns {string}
 */
function format_method_attribute(name, fn, ctx) {
	const params =
		fn.params.length === 0
			? ''
			: fn.params.map((/** @type {any} */ p) => slice(ctx.source, p)).join(', ');

	const body =
		fn.body.type === 'BlockStatement'
			? slice(ctx.source, fn.body)
			: `{ return ${slice(ctx.source, fn.body)}; }`;

	return `${name}(${params}) ${body}`;
}

// =====================================================================
// Control flow
// =====================================================================

/**
 * Lower an if/else chain to Marko's `<if>/<else if>/<else>` core tags.
 *
 * @param {any} node
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_if(node, lines, indent, ctx) {
	/** @type {{ test: any | null, body: any[] }[]} */
	const branches = [];
	/** @type {any} */
	let current = node;
	while (current && current.type === 'IfStatement') {
		const body =
			current.consequent.type === 'BlockStatement'
				? current.consequent.body
				: [current.consequent];
		branches.push({ test: current.test, body });
		if (current.alternate && current.alternate.type === 'IfStatement') {
			current = current.alternate;
			continue;
		}
		if (current.alternate) {
			const alt_body =
				current.alternate.type === 'BlockStatement'
					? current.alternate.body
					: [current.alternate];
			branches.push({ test: null, body: alt_body });
		}
		break;
	}

	for (let i = 0; i < branches.length; i++) {
		const branch = branches[i];
		const test_text = branch.test
			? wrap_if_needed(slice(ctx.source, branch.test))
			: null;

		let header;
		if (i === 0) {
			header = `<if=${test_text}>`;
		} else if (branch.test !== null) {
			header = `<else if=${test_text}>`;
		} else {
			header = `<else>`;
		}

		push_line(lines, indent, header);
		for (const stmt of branch.body) emit_statement(stmt, lines, indent + 1, ctx);
		if (i === 0) push_line(lines, indent, `</if>`);
		else if (branch.test !== null) push_line(lines, indent, `</else>`);
		else push_line(lines, indent, `</else>`);
	}
}

/**
 * Lower a `for (const x of xs; index i; key k)` to Marko's `<for>` core tag.
 *
 * @param {any} node
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_for_of(node, lines, indent, ctx) {
	if (node.await) {
		throw create_compile_error(
			node,
			'`for await` is not supported on the Marko target.',
		);
	}

	const left = node.left;
	if (left.type !== 'VariableDeclaration' || left.declarations.length !== 1) {
		throw create_compile_error(node, 'Unsupported `for ... of` binding form.');
	}
	const binding = left.declarations[0].id;
	if (binding.type !== 'Identifier') {
		throw create_compile_error(
			node,
			'Destructured `for (const x of ...)` bindings are not yet supported on the Marko target.',
		);
	}

	const item_name = binding.name;
	const index_name = node.index && node.index.name ? node.index.name : null;
	const params = index_name ? `|${item_name}, ${index_name}|` : `|${item_name}|`;
	const of_text = wrap_if_needed(slice(ctx.source, node.right));

	let by_text = '';
	if (node.key) {
		// Marko's `by=` attribute has a string shortcut: `by="prop"` is
		// equivalent to `by=(item) => item.prop`. Detect the common case of
		// `key <loop_var>.<ident>` and emit the string form — it reads more
		// naturally and avoids re-stating the loop variable.
		const shortcut = try_simple_by_shortcut(node.key, item_name);
		if (shortcut !== null) {
			by_text = ` by="${shortcut}"`;
		} else {
			const key_src = slice(ctx.source, node.key);
			by_text = ` by=(${item_name}) => ${wrap_if_needed(key_src)}`;
		}
	}

	push_line(lines, indent, `<for${params} of=${of_text}${by_text}>`);
	const body = node.body.type === 'BlockStatement' ? node.body.body : [node.body];
	for (const stmt of body) emit_statement(stmt, lines, indent + 1, ctx);
	push_line(lines, indent, `</for>`);
}

/**
 * Detect `key <loop_var>.<ident>` so we can emit Marko's shorthand
 * `by="ident"` form instead of spelling out the arrow function.
 *
 * @param {any} key_node
 * @param {string} item_name
 * @returns {string | null}
 */
function try_simple_by_shortcut(key_node, item_name) {
	if (
		key_node &&
		key_node.type === 'MemberExpression' &&
		!key_node.computed &&
		!key_node.optional &&
		key_node.object.type === 'Identifier' &&
		key_node.object.name === item_name &&
		key_node.property.type === 'Identifier'
	) {
		return key_node.property.name;
	}
	return null;
}

/**
 * Lower a `switch (d)` statement to a chain of `<if>/<else if>/<else>`
 * using `===` comparisons. Marko has no `<switch>` core tag, so this is
 * the idiomatic equivalent.
 *
 * @param {any} node
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_switch(node, lines, indent, ctx) {
	const discriminant = slice(ctx.source, node.discriminant);

	/** @type {{ test: string | null, body: any[] }[]} */
	const branches = [];

	for (const switch_case of node.cases) {
		const body = [];
		for (const child of switch_case.consequent || []) {
			if (child.type === 'BreakStatement') break;
			body.push(child);
		}
		if (switch_case.test === null) {
			branches.push({ test: null, body });
		} else {
			const case_text = slice(ctx.source, switch_case.test);
			branches.push({
				test: `${wrap_if_needed(discriminant)} === ${wrap_if_needed(case_text)}`,
				body,
			});
		}
	}

	for (let i = 0; i < branches.length; i++) {
		const branch = branches[i];
		let header;
		if (i === 0 && branch.test !== null) {
			header = `<if=${wrap_if_needed(branch.test)}>`;
		} else if (branch.test !== null) {
			header = `<else if=${wrap_if_needed(branch.test)}>`;
		} else {
			header = `<else>`;
		}
		push_line(lines, indent, header);
		for (const stmt of branch.body) emit_statement(stmt, lines, indent + 1, ctx);
		if (i === 0 && branch.test !== null) push_line(lines, indent, `</if>`);
		else if (branch.test !== null) push_line(lines, indent, `</else>`);
		else push_line(lines, indent, `</else>`);
	}
}

/**
 * Lower `try { ... } pending { ... } catch (err) { ... }` to Marko's
 * `<try>` core tag with `@catch` / `@placeholder` attribute tags.
 *
 * @param {any} node
 * @param {string[]} lines
 * @param {number} indent
 * @param {EmitContext} ctx
 */
function emit_try(node, lines, indent, ctx) {
	if (node.finalizer) {
		throw create_compile_error(
			node.finalizer,
			'`finally` blocks are not supported inside a Marko component body.',
		);
	}

	push_line(lines, indent, `<try>`);
	const body = node.block.body || [];
	for (const stmt of body) emit_statement(stmt, lines, indent + 1, ctx);

	if (node.pending) {
		push_line(lines, indent + 1, `<@placeholder>`);
		for (const stmt of node.pending.body || [])
			emit_statement(stmt, lines, indent + 2, ctx);
		push_line(lines, indent + 1, `</@placeholder>`);
	}

	if (node.handler) {
		const param = node.handler.param;
		const err_name = param && param.type === 'Identifier' ? param.name : 'err';
		push_line(lines, indent + 1, `<@catch|${err_name}|>`);
		for (const stmt of node.handler.body.body || [])
			emit_statement(stmt, lines, indent + 2, ctx);
		push_line(lines, indent + 1, `</@catch>`);
	}

	push_line(lines, indent, `</try>`);
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Slice the original source by `start`/`end` on the node. Falls back to the
 * `synthetic_text` escape hatch for nodes constructed during transform.
 *
 * @param {Sliceable} source
 * @param {any} node
 * @returns {string}
 */
function slice(source, node) {
	if (node == null) return '';
	if (typeof node.synthetic_text === 'string') return node.synthetic_text;
	if (typeof node.start === 'number' && typeof node.end === 'number') {
		return source.slice(node.start, node.end).trim();
	}
	throw new Error(
		`@tsrx/marko: cannot slice node of type ${node.type ?? 'unknown'} — missing source positions.`,
	);
}

/**
 * Wrap a JS expression in parens if its textual form contains an unenclosed
 * `>` or `<` (binary comparisons, generics in type position, JSX, etc.).
 *
 * Marko's attribute grammar terminates on the first unbalanced `>`, so
 * `<if=n > 0>` would be misparsed as `<if=n >` followed by stray text.
 * `<` is technically fine for Marko's parser, but leaving it unwrapped
 * confuses every syntax highlighter I've seen (they treat it as the start
 * of a new tag), so we wrap it too for the sake of readable editor output.
 *
 * The scanner tracks depth for `()`, `[]`, `{}`, single/double/template
 * quotes, and line/block comments; anything inside those brackets is
 * ignored. A `>` or `<` at depth 0 triggers wrapping. If the expression is
 * already parenthesized at the top level, skip the extra wrap.
 *
 * @param {string} text
 * @returns {string}
 */
export function wrap_if_needed(text) {
	if (!needs_wrap(text)) return text;
	return `(${text})`;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function needs_wrap(text) {
	let depth = 0;
	let i = 0;
	let already_wrapped = false;

	// Detect top-level wrapping: if the whole expression is `(...)`.
	if (text.startsWith('(') && text.endsWith(')')) {
		let d = 0;
		let ok = true;
		for (let j = 0; j < text.length; j++) {
			const c = text[j];
			if (c === '(') d++;
			else if (c === ')') {
				d--;
				if (d === 0 && j < text.length - 1) {
					ok = false;
					break;
				}
			}
		}
		if (ok) already_wrapped = true;
	}
	if (already_wrapped) return false;

	while (i < text.length) {
		const c = text[i];
		const n = text[i + 1];

		// Comments.
		if (c === '/' && n === '/') {
			const nl = text.indexOf('\n', i + 2);
			i = nl === -1 ? text.length : nl + 1;
			continue;
		}
		if (c === '/' && n === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end === -1 ? text.length : end + 2;
			continue;
		}

		// Strings (single, double, template).
		if (c === "'" || c === '"') {
			i++;
			while (i < text.length && text[i] !== c) {
				if (text[i] === '\\') i += 2;
				else i++;
			}
			i++;
			continue;
		}
		if (c === '`') {
			i++;
			while (i < text.length && text[i] !== '`') {
				if (text[i] === '\\') {
					i += 2;
					continue;
				}
				if (text[i] === '$' && text[i + 1] === '{') {
					let td = 1;
					i += 2;
					while (i < text.length && td > 0) {
						if (text[i] === '{') td++;
						else if (text[i] === '}') td--;
						if (td === 0) {
							i++;
							break;
						}
						i++;
					}
					continue;
				}
				i++;
			}
			i++;
			continue;
		}

		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		else if ((c === '>' || c === '<') && depth === 0) return true;

		i++;
	}

	return false;
}

/**
 * @param {string[]} lines
 * @param {number} indent
 * @param {string} text
 */
function push_line(lines, indent, text) {
	const pad = '  '.repeat(indent);
	// Split multi-line text so each line is correctly indented.
	const parts = text.split('\n');
	for (const part of parts) lines.push(`${pad}${part}`);
}
