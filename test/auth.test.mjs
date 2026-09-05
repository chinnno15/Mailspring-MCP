import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
	TOKEN_MODE, isAuthorized, loadOrCreateToken, parseBearer, secretsMatch, tokenPath,
} from '../lib/auth.js';

const tmpdirs = [];
const tmp = () =>
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-mcp-auth-'));
	tmpdirs.push(dir);
	return dir;
};
after(() => tmpdirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

describe('parseBearer', () =>
{
	it('extracts the token', () => assert.equal(parseBearer('Bearer abc123'), 'abc123'));
	it('is case-insensitive on the scheme', () => assert.equal(parseBearer('bearer abc123'), 'abc123'));
	it('tolerates extra whitespace', () => assert.equal(parseBearer('Bearer   abc123  '), 'abc123'));
	it('rejects a missing header', () => assert.equal(parseBearer(undefined), null));
	it('rejects a bare token with no scheme', () => assert.equal(parseBearer('abc123'), null));
	it('rejects a different scheme', () => assert.equal(parseBearer('Basic abc123'), null));
	it('rejects an empty token', () => assert.equal(parseBearer('Bearer '), null));
	it('rejects an array header', () => assert.equal(parseBearer(['Bearer a', 'Bearer b']), null));
});

describe('secretsMatch', () =>
{
	it('matches identical secrets', () => assert.equal(secretsMatch('s3cret', 's3cret'), true));
	it('rejects different secrets', () => assert.equal(secretsMatch('s3cret', 's3cres'), false));
	it('rejects differing lengths without throwing', () =>
	{
		assert.equal(secretsMatch('short', 'a-much-longer-secret'), false);
	});
	it('rejects a prefix of the real secret', () => assert.equal(secretsMatch('s3c', 's3cret'), false));
});

describe('isAuthorized', () =>
{
	const token = 'a'.repeat(64);

	it('accepts the correct token', () => assert.equal(isAuthorized(`Bearer ${token}`, token), true));
	it('rejects a wrong token', () => assert.equal(isAuthorized(`Bearer ${'b'.repeat(64)}`, token), false));
	it('rejects a missing header', () => assert.equal(isAuthorized(undefined, token), false));
	it('rejects an empty configured token, so a broken load cannot open the door', () =>
	{
		assert.equal(isAuthorized('Bearer anything', ''), false);
	});
});

describe('loadOrCreateToken', () =>
{
	it('generates a token on first run', () =>
	{
		const dir = tmp();
		const token = loadOrCreateToken(dir);

		assert.match(token, /^[0-9a-f]{64}$/, 'expected 32 random bytes as hex');
		assert.ok(fs.existsSync(tokenPath(dir)));
	});

	it('writes the token file owner-only', () =>
	{
		const dir = tmp();
		loadOrCreateToken(dir);
		assert.equal(fs.statSync(tokenPath(dir)).mode & 0o777, TOKEN_MODE);
	});

	it('returns the same token on subsequent runs', () =>
	{
		const dir = tmp();
		assert.equal(loadOrCreateToken(dir), loadOrCreateToken(dir));
	});

	it('tightens permissions on an existing world-readable token', () =>
	{
		const dir = tmp();
		loadOrCreateToken(dir);
		fs.chmodSync(tokenPath(dir), 0o644);

		loadOrCreateToken(dir);
		assert.equal(fs.statSync(tokenPath(dir)).mode & 0o777, TOKEN_MODE);
	});

	it('regenerates when the file is empty rather than accepting a blank token', () =>
	{
		const dir = tmp();
		fs.writeFileSync(tokenPath(dir), '   \n');

		assert.match(loadOrCreateToken(dir), /^[0-9a-f]{64}$/);
	});

	it('creates the config directory if it does not exist', () =>
	{
		const dir = path.join(tmp(), 'nested', 'config');
		assert.match(loadOrCreateToken(dir), /^[0-9a-f]{64}$/);
	});

	it('issues different tokens to different installs', () =>
	{
		assert.notEqual(loadOrCreateToken(tmp()), loadOrCreateToken(tmp()));
	});
});
