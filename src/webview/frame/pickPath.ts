// Parent/child stepping over a pick path. Index 0 is the clicked element, the last entry is the
// current pick. Generic and DOM-free; the runtime builds a new path on every click.

type StepToParentArgs<T> = {
	path: readonly T[];
	// null for a node that left the document.
	parentOf: (element: T) => T | null;
	// html or body: stepping stops there.
	isRoot: (element: T) => boolean;
};

export const stepToParent = <T>({ path, parentOf, isRoot }: StepToParentArgs<T>): readonly T[] => {
	const current = path.at(-1);
	if (current === undefined || isRoot(current)) {
		return path;
	}
	const parent = parentOf(current);
	return parent === null ? path : [...path, parent];
};

export const stepToChild = <T>(path: readonly T[]): readonly T[] =>
	path.length > 1 ? path.slice(0, -1) : path;
