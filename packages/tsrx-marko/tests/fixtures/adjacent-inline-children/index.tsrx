component Greet({ name }: { name: string }) {
	// Adjacent string + expression + string children must collapse to a
	// single line so the surrounding spaces and punctuation survive.
	<p>{'Hello, '}{name}{'!'}</p>

	// Mixed Text/TSRXExpression/Html still collapses.
	<span>{'before '}{html '<em>middle</em>'}{' after'}</span>

	// Element children still get the multi-line layout (we only collapse
	// when *every* child is inline).
	<div>
		{'pre '}
		<strong>{'bold'}</strong>
		{' post'}
	</div>
}
