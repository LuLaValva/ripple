# @tsrx/marko

Compiles `.tsrx` source to [Marko Tags API](https://markojs.com/docs/reference/language.md) template text. Output is plain Marko source; a downstream pass through [`@marko/compiler`](https://markojs.com/docs/guide/marko-5-interop.md) (for example via a Marko bundler plugin) produces the final JS.

Unlike the other `@tsrx/*` targets — which emit TSX for a downstream JSX transform — Marko has no JSX transform, so this package emits Marko source directly.

## Installation

```bash
pnpm add @tsrx/marko
```

## Usage

```js
import { compile } from '@tsrx/marko';

const { code, files, css } = compile(source, 'App.tsrx');
```

`compile` returns:

- `code` — Marko template text for the primary component (the first `export`ed `component`, falling back to the first `component` declaration).
- `files` — array of sibling `.marko` files when the source declares additional `component`s. Each additional component is emitted at `tags/Name.marko` so Marko's relative tag discovery resolves `<Name/>` references without explicit imports. `files[0]` always corresponds to the primary component.
- `css` — scoped CSS from the primary component's `<style>` block, or `null`.

## TSRX → Marko mapping (MVP)

| TSRX | Marko |
| --- | --- |
| `component App(props: T) { ... }` | `export type Input = T` + template body |
| `<div class="x">{expr}</div>` | `<div class="x">${expr}</div>` |
| `{text expr}` | `${expr}` |
| `{html expr}` | `$!{expr}` |
| `attr={expr}` | `attr=expr` (wrapped in `(...)` if expr contains an unenclosed `>`) |
| `onClick={fn}` | `onClick=fn` |
| `{ref el}` on native tag | `<tag/el ...>` (tag variable) |
| `{ref x}` on composite tag | `<Tag ref=x/>` (passes through as a prop) |
| `{...rest}` | `<tag ...rest>` |
| `if / else if / else` | `<if=...>`, `<else if=...>`, `<else>` |
| `for (const x of xs; index i)` | `<for\|x, i\| of=xs>` |
| `for (const x of xs; key x.id)` | `<for\|x\| of=xs by=(x) => x.id>` |
| `switch (d) { case a: ...; default: ...; }` | chained `<if=d===a>` / `<else>` |
| `try { ... } pending { ... } catch (err) { ... }` | `<try>` with `@catch` / `@placeholder` attribute tags |
| `<style>...</style>` | `<style>...</style>` (passed through as CSS-modules-friendly; scoped hash is applied by the existing `@tsrx/core` pipeline) |

## Not yet supported (MVP)

- `<tsx>...</tsx>` expression-form JSX — reserved for a follow-up that lowers it to Marko's `<define/>`.
- `&[...]` / `&{...}` lazy destructuring — surfaces a clear "not yet supported" error.
- `#server { ... }` blocks — pass through; full SSR semantics are deferred.

## License

MIT © Dominic Gannaway
