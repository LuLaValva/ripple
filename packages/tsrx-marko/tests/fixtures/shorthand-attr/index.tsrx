component Form() {
	let value = '';
	let disabled = false;

	// Plain shorthand on non-function values → `name=name`.
	<Input {value} {disabled} />

	// Mix shorthand with normal attrs.
	<Input {value} placeholder="Type here" />

	// Function-typed shorthand whose binding is used once still folds
	// into the inline-method form (the inline-method pass wins over the
	// `name=name` shorthand expansion).
	const onChange = (e: InputEvent) => { value = (e.target as HTMLInputElement).value; };
	<Input {value} {onChange} />
}
