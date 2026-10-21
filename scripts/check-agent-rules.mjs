// Agent adapter layout check, run by `pnpm verify`.
// Claude Code reads only `.claude/rules/*.md` (scoped by `paths:`) and skips a symlink whose target
// is not `.md`. Cursor reads `.cursor/rules/*.mdc` (scoped by `globs:`) and follows symlinks.
// So the real file is `.claude/rules/<name>.md` and `.cursor/rules/<name>.mdc` links to it.
// Skills and agents are authored once under `.cursor` and linked into `.claude` and `.agents`.
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';

const CLAUDE_RULES = '.claude/rules';
const CURSOR_RULES = '.cursor/rules';
const ADAPTER_LINKS = {
	'.claude/skills': '../.cursor/skills',
	'.claude/agents': '../.cursor/agents',
	'.agents/skills': '../.cursor/skills',
};

const problems = [];

const readLinkTarget = (path) => readlink(path).catch(() => null);

const readFrontmatter = (source) => /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? '';

// Splits on commas outside `{...}` so `**/*.{ts,tsx}` stays one pattern.
const splitGlobs = (globs) => {
	const patterns = [];
	let depth = 0;
	let current = '';
	for (const character of globs) {
		depth += character === '{' ? 1 : character === '}' ? -1 : 0;
		if (character === ',' && depth === 0) {
			patterns.push(current);
			current = '';
			continue;
		}
		current += character;
	}
	patterns.push(current);
	return patterns.map(unquote).filter((pattern) => pattern.length > 0);
};

const unquote = (value) =>
	value
		.trim()
		.replace(/^["']|["']$/g, '')
		.trim();

const readGlobs = (frontmatter) => splitGlobs(/^globs:[ \t]*(.*)$/m.exec(frontmatter)?.[1] ?? '');

const readPaths = (frontmatter) => {
	const block = /^paths:[ \t]*\n((?:[ \t]+-[^\n]*\n?)*)/m.exec(frontmatter)?.[1] ?? '';
	return [...block.matchAll(/^[ \t]+-[ \t]+(.+)$/gm)].map((match) => unquote(match[1]));
};

const checkRule = async (fileName) => {
	const ruleName = fileName.replace(/\.md$/, '');
	const rulePath = `${CLAUDE_RULES}/${fileName}`;
	const expectedTarget = `../../${rulePath}`;
	if ((await readLinkTarget(`${CURSOR_RULES}/${ruleName}.mdc`)) !== expectedTarget) {
		problems.push(`${CURSOR_RULES}/${ruleName}.mdc must be a symlink to ${expectedTarget}`);
	}
	const frontmatter = readFrontmatter(await readFile(rulePath, 'utf8'));
	const globs = readGlobs(frontmatter);
	const alwaysApply = /^alwaysApply:\s*true\s*$/m.test(frontmatter);
	if (alwaysApply === globs.length > 0) {
		problems.push(`${rulePath}: use either alwaysApply: true or globs:, not both or neither`);
	}
	if (globs.join('|') !== readPaths(frontmatter).join('|')) {
		problems.push(
			`${rulePath}: paths: (Claude Code) must list the same patterns as globs: (Cursor)`,
		);
	}
};

const checkRules = async () => {
	if (!(await lstat(CLAUDE_RULES)).isDirectory()) {
		problems.push(`${CLAUDE_RULES} must be a real directory, not a symlink`);
		return;
	}
	const ruleFiles = (await readdir(CLAUDE_RULES)).filter((name) => name.endsWith('.md'));
	await Promise.all(ruleFiles.map(checkRule));
	const expectedLinks = new Set(ruleFiles.map((name) => name.replace(/\.md$/, '.mdc')));
	for (const name of await readdir(CURSOR_RULES)) {
		if (!expectedLinks.has(name)) {
			problems.push(
				`${CURSOR_RULES}/${name}: author rules in ${CLAUDE_RULES}/<name>.md and symlink here`,
			);
		}
	}
};

const checkAdapterLinks = async () => {
	for (const [path, target] of Object.entries(ADAPTER_LINKS)) {
		if ((await readLinkTarget(path)) !== target) {
			problems.push(`${path} must be a symlink to ${target}`);
		}
	}
};

await checkRules();
await checkAdapterLinks();
if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`agent rules: ${problem}`);
	}
	process.exit(1);
}
