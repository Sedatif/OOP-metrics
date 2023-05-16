import * as ts from 'typescript';
import * as path from 'path'; 

type AttributeDeclaration =
	| ts.PropertyDeclaration
	| ts.ParameterDeclaration
	| ts.GetAccessorDeclaration;

type MethodDeclaration = ts.MethodDeclaration

const IS_ATTR_DECL = [
	ts.isPropertyDeclaration,
	ts.isParameter,
	ts.isGetAccessorDeclaration,
];

const PRIVATE_MODIFIERS = [
	ts.SyntaxKind.PrivateKeyword,
	ts.SyntaxKind.PrivateIdentifier,
];

class MoodMetric {
	public divided: number = 0;
	public divider: number = 0;

	calculate(): number {
		return this.divided / this.divider;
	}
}

class ClassMetrics {
	className: string = '';
	classPath: string = '';
	parentClass: string = '';
	depthOfInheritance: number = 0;
	numberOfChildren: number = 0;
	methods: PropertyMetrics<MethodDeclaration> = new PropertyMetrics('methods');
	attributes: PropertyMetrics<AttributeDeclaration> = new PropertyMetrics('attributes');
}

class Analyzer {
	classes: ClassMetrics[] = [];

	constructor(public typeChecker: ts.TypeChecker) {}

	analyze(nodes: ts.Node[]) {
		const self = this;
		nodes.forEach(node => this.analyzeClass(self, node));
		let mif = new MoodMetric(),
			aif = new MoodMetric(),
			mhf = new MoodMetric(),
			ahf = new MoodMetric(),
			pof = new MoodMetric();
		for (const oneClass of this.classes) {
			const totalMethods = oneClass.methods.length();
			const totalAttrs = oneClass.attributes.length();
			mif.divided += oneClass.methods.inherited.length + oneClass.methods.own.length;
			mif.divider += totalMethods;
			aif.divided += oneClass.attributes.inherited.length + oneClass.attributes.own.length;
			aif.divider += totalAttrs;
			mhf.divided += oneClass.methods.privateCount;
			mhf.divider += totalMethods;
			ahf.divided += oneClass.attributes.privateCount;
			ahf.divider += totalAttrs;
			pof.divided += oneClass.methods.inherited.length + oneClass.methods.overridden.length;
			pof.divider += oneClass.methods.own.length * oneClass.numberOfChildren;
		}

		return {
			classes: this.classes,
			mif: mif.calculate(),
			aif: aif.calculate(),
			mhf: mhf.calculate(),
			ahf: ahf.calculate(),
			pof: pof.calculate(),
		};
	}

	analyzeClass(self: Analyzer, potentialClass: ts.Node) {
		if (ts.isClassLike(potentialClass)) {
			const classType = this.typeChecker.getTypeAtLocation(potentialClass);
			this.getClassMetrics(classType);
		}

		potentialClass.forEachChild((node) => this.analyzeClass(self, node));
	}

	getClassMetrics(classType: ts.Type): ClassMetrics {
		const className = this.typeChecker.typeToString(classType);
		const typeDecl = classType.symbol.declarations?.[0];
		const classPath = typeDecl == null ? '' : this.getAbsolutePosition(typeDecl);
		const isAlreadyAnalyzed = this.classes.find(oneClass => oneClass.className === className && oneClass.classPath === classPath);
		if (isAlreadyAnalyzed != undefined) {
			return isAlreadyAnalyzed;
		}
		const result: ClassMetrics = new ClassMetrics();
		result.className = className;
		result.classPath = classPath;
		const parentClass = this.getParentClassMetrics(classType);
		if (parentClass != null) {
			parentClass.numberOfChildren += 1;
			result.depthOfInheritance += 1 + parentClass.depthOfInheritance;
			result.parentClass = parentClass.className;
		}
		result.methods.analyze(parentClass, classType);
		result.attributes.analyze(parentClass, classType);
		this.classes.push(result)
		return result;
	}

	getParentClassMetrics<T>(classType: ts.Type): ClassMetrics | null {
		const baseTypes = classType.getBaseTypes();
		if (baseTypes == null || baseTypes.length === 0) {
			return null;
		}
		if (baseTypes.length > 1) {
			throw Error(`Unexpected base classes number ${baseTypes.length}`);
		}
		return this.getClassMetrics(baseTypes[0]);
	}

	getAbsolutePosition(node: ts.Node): string {
		const file = node.getSourceFile();
		const pos = file.getLineAndCharacterOfPosition(node.getStart());
		return `${file.fileName}:${pos.line + 1}:${pos.character + 1}`;
	}
}

class PropertyMetrics<T extends MethodDeclaration | AttributeDeclaration> {
	privateCount = 0;
	inherited: T[] = [];
	overridden: T[] = [];
	own: T[] = [];
	constructor(private readonly propType: 'methods' | 'attributes') {}
	allProps(): T[] {
		return [...this.inherited, ...this.overridden, ...this.own];
	}
	length(): number {
		return this.allProps().length + this.privateCount
	}
	analyze(parentClass: ClassMetrics | null, classType: ts.Type) {
		const parentProps = (parentClass?.[this.propType]?.allProps() ?? []) as T[];
		for (const prop of classType.getProperties()) {
			let propDecl = prop.declarations?.[0];
			if (propDecl == null || !this.isOfType(this.propType, propDecl)) {
				continue;
			}
			const decl = propDecl as T;
			if (this.isPrivate(decl)) {
				this.privateCount += 1;
			}
			const declName = decl.name.getText();
			const isInherited = parentProps.some(
				(prop) => prop.name.getText() === declName
			);
			if (!isInherited) {
				this.own.push(decl);
				continue;
			}
			const classDecl = classType.symbol.declarations![0];
			const arr = decl.parent === classDecl ? 'overridden' : 'inherited';
			this[arr].push(decl);
		}
	}
	isOfType(propType: 'methods' | 'attributes', propDecl: ts.Declaration): boolean {
		if (propType === 'methods') return ts.isMethodDeclaration(propDecl);
		return IS_ATTR_DECL.some((is) => is(propDecl));
	}
	isPrivate(decl: ts.Declaration): boolean {
		return !!decl.modifiers?.some((modifier) =>
			PRIVATE_MODIFIERS.includes(modifier.kind)
		);
	}
}

function formatMetrics(result: any): string {
	const formatedResult = {
		...result,
		classes: result.classes.map((oneClass: { className: any; numberOfChildren: any; depthOfInheritance: any; parentClass: string | number; }) => {
			const clearedClass: { [key: string]: string | number } = {
				className: oneClass.className,
				numberOfChildren: oneClass.numberOfChildren,
				depthOfInheritance: oneClass.depthOfInheritance
			};
			if (oneClass.parentClass) {
				clearedClass.parentClass = oneClass.parentClass;
			}
			return clearedClass;
		}),
		maxNumberOfChildren: result.classes.reduce((maxNumber: number, oneClass: { numberOfChildren: number; }) => oneClass.numberOfChildren > maxNumber ? oneClass.numberOfChildren : maxNumber, 0),
		maxDepthOfInheritance: result.classes.reduce((maxNumber: number, oneClass: { depthOfInheritance: number; }) => oneClass.depthOfInheritance > maxNumber ? oneClass.depthOfInheritance : maxNumber, 0),
	};
	return JSON.stringify(formatedResult, null, 4);
}

export function analyze(program: ts.Program) {
	const typeChecker = program.getTypeChecker();
	const files = program
		.getSourceFiles()
		.filter((file) => !path.parse(file.fileName).dir.includes('node_modules'));
	const analyzer = new Analyzer(typeChecker);
	const result = analyzer.analyze(files);
	return formatMetrics(result)
}