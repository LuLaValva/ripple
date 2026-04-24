import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';

/**
 * Error cases don't fit the fixture-output format (there's no Marko to
 * snapshot), so they live here as focused `toThrow` assertions.
 */

describe('@tsrx/marko errors', () => {
	it('rejects <tsx>...</tsx>', () => {
		expect(() =>
			compile(`component App() { <tsx><h1>a</h1></tsx> }`, 'App.tsrx'),
		).toThrow(/not yet supported/);
	});

	it('rejects the <>...</> fragment shorthand', () => {
		expect(() =>
			compile(`component App() { <>{'x'}</> }`, 'App.tsrx'),
		).toThrow(/not yet supported/);
	});

	it('rejects &[...] lazy destructuring', () => {
		expect(() =>
			compile(
				`component App() {
					let &[c, s] = createSignal(0);
					<div>{text c}</div>
				}`,
				'App.tsrx',
			),
		).toThrow(/lazy destructuring is not yet supported/);
	});

	it('rejects &{...} lazy destructuring', () => {
		expect(() =>
			compile(
				`component App() {
					let &{ value } = createSignal({ value: 0 });
					<div>{text value}</div>
				}`,
				'App.tsrx',
			),
		).toThrow(/lazy destructuring is not yet supported/);
	});

	it('rejects try/finally blocks', () => {
		expect(() =>
			compile(
				`component App() {
					try {
						<div>{'a'}</div>
					} catch (e) {
						<div>{'b'}</div>
					} finally {
						<div>{'c'}</div>
					}
				}`,
				'App.tsrx',
			),
		).toThrow(/finally/);
	});

	it('rejects multiple `ref` attributes on a single tag', () => {
		expect(() =>
			compile(
				`component App() {
					let a;
					<input {ref a} {ref (n) => n.focus()} />
				}`,
				'App.tsrx',
			),
		).toThrow(/Multiple `ref` attributes/);
	});

	it('throws when the file has no component declaration', () => {
		expect(() => compile(`export const x = 1;`, 'App.tsrx')).toThrow(
			/no `component` declaration/,
		);
	});
});
