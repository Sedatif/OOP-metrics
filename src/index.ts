import * as ts from 'typescript';
import { analyze } from './analyzer';

let tsconfig = {};
const libraryPath = process.argv[2];

if (!libraryPath) {
	throw new Error('Expected library path argument is empty');
}

const program = ts.createProgram({
	rootNames: [libraryPath],
	options: tsconfig,
});

const metrics = analyze(program);
console.log(metrics);