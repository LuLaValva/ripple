component App() {
	try {
		<AsyncThing />
	} pending {
		<div>{'loading'}</div>
	} catch (err) {
		<pre>{text String(err)}</pre>
	}
}
