export component Edges() {
	let count = 0;

	// Arrow with expression body — gets wrapped in `{ return ...; }` when inlined.
	const label = () => `n=${count}`;

	// Used twice → not inlined; emits a normal `<const/>` declaration.
	const reset = () => { count = 0; };

	// Function expression also inlines.
	const onPointer = function (e: PointerEvent) {
		console.log(e.type, count);
	};

	<button onClick={reset}>{'reset a'}</button>
	<button onClick={reset}>{'reset b'}</button>
	<div onPointerDown={onPointer} title={label}>
		{`raw template: ${count}`}
	</div>
}
