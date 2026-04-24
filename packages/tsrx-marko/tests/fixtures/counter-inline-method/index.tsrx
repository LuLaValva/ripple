export component Counter() {
	let count = 0;

	const increment = () => {
		if (count >= 10) {
			count = 0;
		} else {
			count += 1;
		}
	};

	<button onClick={increment}>
		{`Count: ${count}`}
	</button>

	if (count > 5) {
		<strong>{'Big Number!'}</strong>
		const reset = () => { count = 0; };
		<button onClick={reset}>{'Reset'}</button>
	}
}
