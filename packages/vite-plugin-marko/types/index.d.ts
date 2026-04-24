import type { Plugin } from 'vite';

export interface TsrxMarkoOptions {
	/**
	 * Regular expression matched against file paths to decide which modules
	 * the plugin should compile as tsrx sources. Defaults to `/\.tsrx$/`.
	 */
	include?: RegExp;
}

export function tsrxMarko(options?: TsrxMarkoOptions): Plugin;
export default tsrxMarko;
