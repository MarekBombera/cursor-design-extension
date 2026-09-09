import { createHash } from 'node:crypto';

export const HASH_PREFIX = 'sha256:' as const;

export const hashHtml = (html: string): string =>
	`${HASH_PREFIX}${createHash('sha256').update(html, 'utf8').digest('hex')}`;
