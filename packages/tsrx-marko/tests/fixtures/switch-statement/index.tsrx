component App({ n }: { n: number }) {
	switch (n) {
		case 0: <p>{'zero'}</p>; break;
		case 1: <p>{'one'}</p>; break;
		default: <p>{'many'}</p>;
	}
}
