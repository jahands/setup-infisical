import { HttpClient } from '@actions/http-client'
import { lt, maxSatisfying, validRange } from 'semver'

import { MIN_VERSION, OWNER, REPO } from './constants.js'

export interface ResolvedVersion {
	tag: string // 'v0.43.114' — used in URL paths
	semver: string // '0.43.114' — used in asset filenames, cache keys, outputs
}

// Stricter than semver: rejects ranges, prereleases, and build metadata,
// because the version is interpolated into release-tag URLs.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

function invalidVersionError(input: string): Error {
	return new Error(
		`Invalid version "${input}". Expected an exact version like "0.43.114", ` +
			'a semver range like "0.43.x", or "latest".'
	)
}

export function normalizeVersion(input: string): ResolvedVersion {
	const trimmed = input.trim()
	if (!VERSION_RE.test(trimmed)) {
		throw invalidVersionError(input)
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

// Fetch the stable release versions (bare semvers, newest first) from the
// GitHub API. Drafts, prereleases, and tags that are not exact x.y.z are
// skipped. Paginated at 100 per page with a safety cap well above the
// repository's release count.
async function listReleaseVersions(authorization: string | undefined): Promise<string[]> {
	const client = new HttpClient('infisical-cli-action')
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		...(authorization ? { authorization } : {}),
	}
	const versions: string[] = []
	const perPage = 100
	const maxPages = 10
	for (let page = 1; page <= maxPages; page++) {
		const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=${perPage}&page=${page}`
		const response = await client.get(url, headers)
		const status = response.message.statusCode ?? 0
		const body = await response.readBody()
		if (status !== 200) {
			const rateLimited = status === 403 || status === 429
			throw new Error(
				`Failed to list ${OWNER}/${REPO} releases from the GitHub API ` +
					`(HTTP ${status}).` +
					(rateLimited
						? ' This is likely API rate limiting; pass a "github-token" or pin ' +
							'an exact version via the "version" input.'
						: ' Pin an exact version via the "version" input to work around this.')
			)
		}
		const releases = JSON.parse(body) as Array<{
			tag_name?: string
			draft?: boolean
			prerelease?: boolean
		}>
		for (const release of releases) {
			if (release.draft || release.prerelease || !release.tag_name) continue
			const match = VERSION_RE.exec(release.tag_name)
			if (match) {
				versions.push(release.tag_name.replace(/^v/, ''))
			}
		}
		if (releases.length < perPage) break
	}
	return versions
}

export async function resolveRange(
	range: string,
	authorization: string | undefined
): Promise<ResolvedVersion> {
	const versions = await listReleaseVersions(authorization)
	const picked = maxSatisfying(versions, range)
	if (!picked) {
		throw new Error(
			`No Infisical CLI release satisfies the version range "${range}". ` +
				`See https://github.com/${OWNER}/${REPO}/releases for available versions.`
		)
	}
	return normalizeVersion(picked)
}

export async function resolveVersion(
	input: string,
	authorization?: string
): Promise<ResolvedVersion> {
	const trimmed = input.trim()
	if (trimmed.toLowerCase() === 'latest') {
		return resolveLatest()
	}
	// Exact versions resolve without any network calls.
	if (VERSION_RE.test(trimmed)) {
		return normalizeVersion(trimmed)
	}
	if (validRange(trimmed)) {
		return resolveRange(trimmed, authorization)
	}
	throw invalidVersionError(input)
}
