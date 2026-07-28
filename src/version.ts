import { HttpClient } from '@actions/http-client'
import { lt } from 'semver'

import { MIN_VERSION, OWNER, REPO } from './constants.js'

export interface ResolvedVersion {
	tag: string // 'v0.43.114' — used in URL paths
	semver: string // '0.43.114' — used in asset filenames, cache keys, outputs
}

// Stricter than semver: rejects ranges, prereleases, and build metadata,
// because the version is interpolated into release-tag URLs.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

export function normalizeVersion(input: string): ResolvedVersion {
	const trimmed = input.trim()
	if (!VERSION_RE.test(trimmed)) {
		throw new Error(
			`Invalid version "${input}". Expected an exact version like "0.43.114" ` +
				'(optionally prefixed with "v") or "latest".'
		)
	}
	const semver = trimmed.replace(/^v/, '')
	if (lt(semver, MIN_VERSION)) {
		throw new Error(
			`Version ${semver} predates the ${OWNER}/${REPO} repository (oldest ` +
				`available: ${MIN_VERSION}). Older CLI builds were published from the ` +
				'legacy Infisical/infisical monorepo and are not supported by this action.'
		)
	}
	return { tag: `v${semver}`, semver }
}

export async function resolveLatest(): Promise<ResolvedVersion> {
	const url = `https://github.com/${OWNER}/${REPO}/releases/latest`
	const client = new HttpClient('infisical-cli-action', [], {
		allowRedirects: false,
	})
	const response = await client.get(url)
	const status = response.message.statusCode ?? 0
	const location = response.message.headers.location
	await response.readBody()
	if (status < 300 || status >= 400 || !location) {
		throw new Error(
			'Failed to resolve the latest Infisical CLI version: expected a ' +
				`redirect from ${url} but got HTTP ${status}. Pin an exact version ` +
				'via the "version" input to work around this.'
		)
	}
	const match = /\/releases\/tag\/(v\d+\.\d+\.\d+)$/.exec(location)
	if (!match || !match[1]) {
		throw new Error(
			'Failed to resolve the latest Infisical CLI version: could not parse ' +
				`a version tag from the redirect location "${location}". Pin an exact ` +
				'version via the "version" input to work around this.'
		)
	}
	return normalizeVersion(match[1])
}

export async function resolveVersion(input: string): Promise<ResolvedVersion> {
	if (input.trim().toLowerCase() === 'latest') {
		return resolveLatest()
	}
	return normalizeVersion(input)
}
