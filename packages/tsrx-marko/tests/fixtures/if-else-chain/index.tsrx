component App({ n }: { n: number }) {
	if (n > 0) {
		<p>{'pos'}</p>
	} else if (n < 0) {
		<p>{'neg'}</p>
	} else {
		<p>{'zero'}</p>
	}
}
