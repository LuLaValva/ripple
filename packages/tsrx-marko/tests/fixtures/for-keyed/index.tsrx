component App({ items }: { items: { id: string }[] }) {
	for (const item of items; key item.id) {
		<li>{text item.id}</li>
	}
}
