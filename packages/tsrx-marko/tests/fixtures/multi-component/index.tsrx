component Child({ label }: { label: string }) {
	<span>{text label}</span>
}

component App({ items }: { items: string[] }) {
	for (const item of items; index i) {
		<Child label={item} />
	}
}
