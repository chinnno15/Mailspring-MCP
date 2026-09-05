import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const TOKEN_FILENAME = 'mailspring-mcp-token';
export const TOKEN_MODE = 0o600;

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * The values are hashed first so that a length difference — which
 * timingSafeEqual rejects outright by throwing — does not itself become an
 * observable signal.
 */
export function secretsMatch(a: string, b: string): boolean
{
	const left = crypto.createHash('sha256').update(a, 'utf8').digest();
	const right = crypto.createHash('sha256').update(b, 'utf8').digest();
	return crypto.timingSafeEqual(left, right);
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | string[] | undefined): string | null
{
	if (typeof header !== 'string') return null;

	const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
	return match ? match[1] : null;
}

export function isAuthorized(header: string | string[] | undefined, token: string): boolean
{
	const presented = parseBearer(header);
	if (!presented || !token) return false;

	return secretsMatch(presented, token);
}

export function tokenPath(configDir: string): string
{
	return path.join(configDir, TOKEN_FILENAME);
}

/**
 * Read the shared token, generating one on first run.
 *
 * The file is owner-read/write only; if it already exists with looser
 * permissions they are tightened rather than trusted.
 */
export function loadOrCreateToken(configDir: string): string
{
	const file = tokenPath(configDir);

	if (fs.existsSync(file))
	{
		const existing = fs.readFileSync(file, 'utf8').trim();
		if (existing)
		{
			if ((fs.statSync(file).mode & 0o777) !== TOKEN_MODE) fs.chmodSync(file, TOKEN_MODE);
			return existing;
		}
	}

	const token = crypto.randomBytes(32).toString('hex');
	fs.mkdirSync(configDir, { recursive: true });
	fs.writeFileSync(file, `${token}\n`, { mode: TOKEN_MODE });
	fs.chmodSync(file, TOKEN_MODE);

	return token;
}
