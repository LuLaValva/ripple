import type { BaseProps } from './shared';

// Intersection type is not a bare TSTypeLiteral, so it stays as `type`.
component App(props: BaseProps & { title: string }) {
	<h1>{text props.title}</h1>
}
