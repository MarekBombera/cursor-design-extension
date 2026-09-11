import { createHash } from 'node:crypto';

export const HASH_PREFIX = 'sha256:' as const;

const HASH_BODY_PATTERN = /^[a-fA-F0-9]{64}$/;

export const isArtboardHash = (value: string): boolean =>
	value.startsWith(HASH_PREFIX) && HASH_BODY_PATTERN.test(value.slice(HASH_PREFIX.length));

export const normalizeHash = (hash: string): string =>
	`${HASH_PREFIX}${hash.slice(HASH_PREFIX.length).toLowerCase()}`;

export const hashHtml = (html: string): string =>
	`${HASH_PREFIX}${createHash('sha256').update(html, 'utf8').digest('hex')}`;
