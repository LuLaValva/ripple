import type { Program } from 'estree';
import type { ParseOptions } from '@tsrx/core/types';

export interface MarkoFile {
	filename: string;
	code: string;
	map: unknown;
}

export interface CompileResult {
	code: string;
	map: unknown;
	files: MarkoFile[];
}

export function parse(source: string, filename?: string, options?: ParseOptions): Program;

export function compile(source: string, filename?: string): CompileResult;

export function compile_to_volar_mappings(
	source: string,
	filename?: string,
	options?: ParseOptions,
): {
	code: string;
	mappings: unknown[];
	errors: unknown[];
};
