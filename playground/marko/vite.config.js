import { defineConfig } from 'vite';
import tsrxMarko from '@tsrx/vite-plugin-marko';
import marko from '@marko/vite';

export default defineConfig({
	plugins: [tsrxMarko(), marko({ linked: false })],
});
