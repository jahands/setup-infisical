import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import * as tc from '@actions/tool-cache'
import { Result, TaggedError } from 'better-result'

import { getDownloadUrl } from './platform.js'

import type { Target } from './platform.js'

class ChecksumMismatchError extends TaggedError('ChecksumMismatchError')<{
	assetName: string
	expected: string
	actual: string
	message: string
}>() {
	constructor(args: {
		assetName: string
		expected: string
		actual: string
		source: 'input' | 'release'
	}) {
		const { source, ...props } = args
		super({
			...props,
			message:
				source === 'input'
					? `SHA-256 mismatch for ${args.assetName}: the "checksum" input expected ` +
						`${args.expected}, got ${args.actual}. The download may be ` +
						'corrupted or tampered with, or the input may be for a different ' +
						'version or platform.'
					: `SHA-256 mismatch for ${args.assetName}: expected ${args.expected}, got ` +
						`${args.actual}. The download may be corrupted or tampered with.`,
		})
	}
}

class ChecksumEntryNotFoundError extends TaggedError('ChecksumEntryNotFoundError')<{
	assetName: string
	tag: string
	tried: string[]
	message: string
}>() {
	constructor(args: { assetName: string; tag: string; tried: string[] }) {
		super({
			...args,
			message:
				`No SHA-256 entry for ${args.assetName} found in the release checksum files ` +
				`(tried: ${args.tried.join(', ')}) for ${args.tag}.`,
		})
	}
}

class ChecksumDownloadError extends TaggedError('ChecksumDownloadError')<{
	candidate: string
	message: string
	cause: unknown
}>() {
	constructor(args: { candidate: string; cause: unknown }) {
		super({
			...args,
			message: args.cause instanceof Error ? args.cause.message : String(args.cause),
		})
	}
}

class ChecksumReadError extends TaggedError('ChecksumReadError')<{
	path: string
	message: string
	cause: unknown
}>() {
	constructor(args: { path: string; cause: unknown }) {
		super({
			...args,
			message: args.cause instanceof Error ? args.cause.message : String(args.cause),
		})
	}
}

export type ChecksumError =
	ChecksumMismatchError | ChecksumEntryNotFoundError | ChecksumDownloadError | ChecksumReadError

// Parse `<64-hex><whitespace><filename>` lines. Split on a whitespace run,
// tolerate an optional '*' binary-mode prefix on the filename, lowercase hex.
export function parseChecksumFile(contents: string): Map<string, string> {
	const entries = new Map<string, string>()
	for (const line of contents.split('\n')) {
		const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/.exec(line)
		if (match && match[1] && match[2]) {
			entries.set(match[2], match[1].toLowerCase())
		}
	}
	return entries
}

function sha256(filePath: string): Promise<Result<string, ChecksumReadError>> {
	return Result.tryPromise({
		try: async () => {
			const hash = createHash('sha256')
			await pipeline(createReadStream(filePath), hash)
			return hash.digest('hex')
		},
		catch: (cause) => new ChecksumReadError({ path: filePath, cause }),
	})
}

function checksumCandidates(semver: string, target: Target): string[] {
	const candidates: string[] = []
	// The three files partition the assets, and the partition moved mid-0.43:
	// darwin hashes live in checksums-darwin.txt on v0.43.80 and v0.43.83+, but
	// in checksums.txt before that (and on v0.43.81/82).
	if (target.platform === 'darwin') {
		candidates.push('checksums-darwin.txt')
	}
	candidates.push('checksums.txt')
	// As published today this file only hashes cli_<ver>_windows_amd64.tar.gz,
	// which this action never downloads; it is retained purely as a defensive
	// fallback in case upstream repartitions the checksum files again.
	candidates.push(`cli_${semver}_checksums.txt`)
	return candidates
}

export async function verifyChecksum(
	archivePath: string,
	assetName: string,
	tag: string,
	semver: string,
	target: Target,
	authorization: string | undefined,
	providedChecksum?: string
): Promise<Result<void, ChecksumError>> {
	return Result.gen(async function* () {
		// A user-provided checksum (reviewed in the workflow diff) takes
		// precedence over the checksum files published with the release.
		if (providedChecksum) {
			const actual = yield* Result.await(sha256(archivePath))
			if (actual !== providedChecksum) {
				return Result.err(
					new ChecksumMismatchError({
						assetName,
						expected: providedChecksum,
						actual,
						source: 'input',
					})
				)
			}
			return Result.ok()
		}
		const tried: string[] = []
		for (const candidate of checksumCandidates(semver, target)) {
			tried.push(candidate)
			const downloaded = await Result.tryPromise({
				try: () => tc.downloadTool(getDownloadUrl(tag, candidate), undefined, authorization),
				catch: (cause) => new ChecksumDownloadError({ candidate, cause }),
			})
			if (downloaded.isErr()) {
				const { cause } = downloaded.error
				if (cause instanceof tc.HTTPError && cause.httpStatusCode === 404) {
					continue
				}
				return downloaded
			}
			const contents = yield* Result.await(
				Result.tryPromise({
					try: () => readFile(downloaded.value, 'utf8'),
					catch: (cause) => new ChecksumReadError({ path: downloaded.value, cause }),
				})
			)
			const expected = parseChecksumFile(contents).get(assetName)
			if (!expected) {
				continue
			}
			const actual = yield* Result.await(sha256(archivePath))
			if (actual !== expected) {
				return Result.err(
					new ChecksumMismatchError({ assetName, expected, actual, source: 'release' })
				)
			}
			return Result.ok()
		}
		return Result.err(new ChecksumEntryNotFoundError({ assetName, tag, tried }))
	})
}
