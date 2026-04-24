component InlineFns() {
	let count = 0;

	// Arrow with block body.
	<button onClick={() => { count += 1; }}>{'+'}</button>

	// Arrow with expression body — wrapped in `{ return ... }`.
	<button title={() => `n=${count}`}>{'?'}</button>

	// Function expression with typed param.
	<input onInput={function (e: InputEvent) { console.log(e); }} />

	// Zero-arg arrow and a non-function value still go through the
	// regular `attr=expr` path.
	<button onClick={() => count = 0} disabled={count === 0}>{'reset'}</button>
}
