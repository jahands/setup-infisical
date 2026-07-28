import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import * as tc from '@actions/tool-cache'

import { getDownloadUrl } from './platform.js'

import type { Target } from './platform.js'

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

async function sha256(filePath: string): Promise<string> {
	const hash = createHash('sha256')
	await pipeline(createReadStream(filePath), hash)
	return hash.digest('hex')
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
): Promise<void> {
	// A user-provided checksum (reviewed in the workflow diff) takes
	// precedence over the checksum files published with the release.
	if (providedChecksum) {
		const actual = await sha256(archivePath)
		if (actual !== providedChecksum) {
			throw new Error(
				`SHA-256 mismatch for ${assetName}: the "checksum" input expected ` +
					`${providedChecksum}, got ${actual}. The download may be ` +
					'corrupted or tampered with, or the input may be for a different ' +
					'version or platform.'
			)
		}
		return
	}
	const tried: string[] = []
	for (const candidate of checksumCandidates(semver, target)) {
		tried.push(candidate)
		let checksumPath: string
		try {
			checksumPath = await tc.downloadTool(getDownloadUrl(tag, candidate), undefined, authorization)
		} catch (error) {
			if (error instanceof tc.HTTPError && error.httpStatusCode === 404) {
				continue
			}
			throw error
		}
		const entries = parseChecksumFile(await readFile(checksumPath, 'utf8'))
		const expected = entries.get(assetName)
		if (!expected) {
			continue
		}
		const actual = await sha256(archivePath)
		if (actual !== expected) {
			throw new Error(
				`SHA-256 mismatch for ${assetName}: expected ${expected}, got ` +
					`${actual}. The download may be corrupted or tampered with.`
			)
		}
		return
	}
	throw new Error(
		`No SHA-256 entry for ${assetName} found in the release checksum files ` +
			`(tried: ${tried.join(', ')}) for ${tag}.`
	)
}
