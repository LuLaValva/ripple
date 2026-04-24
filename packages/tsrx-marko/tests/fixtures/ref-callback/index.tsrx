component AutoFocus() {
	// Inline arrow callback ref — receives the DOM node.
	<input {ref (node) => node.focus()} type="text" />

	// Function expression form.
	<div {ref function (el) { el.scrollIntoView(); }}>{'hi'}</div>

	// Mixed with a tag variable elsewhere on the same component.
	let probe;
	<button {ref probe} onClick={() => probe.click()}>{'go'}</button>

	// Two callback refs on different elements get distinct temp names.
	<section {ref (s) => s.dataset.ready = 'true'}>{'sec'}</section>
}
