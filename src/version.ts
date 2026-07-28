import { HttpClient } from '@actions/http-client'
import { Result, TaggedError } from 'better-result'
import { lt, maxSatisfying, validRange } from 'semver'
import * as z from 'zod'

import { MIN_VERSION, OWNER, REPO } from './constants.js'

export interface ResolvedVersion {
	tag: string // 'v0.43.114' — used in URL paths
	semver: string // '0.43.114' — used in asset filenames, cache keys, outputs
}

export class InvalidVersionError extends TaggedError('InvalidVersionError')<{
	input: string
	message: string
}>() {
	constructor(args: { input: string }) {
		super({
			...args,
			message:
				`Invalid version "${args.input}". Expected an exact version like "0.43.114", ` +
				'a semver range like "0.43.x", or "latest".',
		})
	}
}

export class VersionTooOldError extends TaggedError('VersionTooOldError')<{
	semver: string
	message: string
}>() {
	constructor(args: { semver: string }) {
		super({
			...args,
			message:
				`Version ${args.semver} predates the ${OWNER}/${REPO} repository (oldest ` +
				`available: ${MIN_VERSION}). Older CLI builds were published from the ` +
				'legacy Infisical/infisical monorepo and are not supported by this action.',
		})
	}
}

class ResolveLatestError extends TaggedError('ResolveLatestError')<{
	message: string
}>() {}

class HttpRequestError extends TaggedError('HttpRequestError')<{
	url: string
	message: string
	cause: unknown
}>() {
	constructor(args: { url: string; cause: unknown }) {
		super({
			...args,
			message: args.cause instanceof Error ? args.cause.message : String(args.cause),
		})
	}
}

class GitHubApiError extends TaggedError('GitHubApiError')<{
	status: number
	message: string
}>() {
	constructor(args: { status: number }) {
		const rateLimited = args.status === 403 || args.status === 429
		super({
			...args,
			message:
				`Failed to list ${OWNER}/${REPO} releases from the GitHub API ` +
				`(HTTP ${args.status}).` +
				(rateLimited
					? ' This is likely API rate limiting; pass a "github-token" or pin ' +
						'an exact version via the "version" input.'
					: ' Pin an exact version via the "version" input to work around this.'),
		})
	}
}

class ReleasesParseError extends TaggedError('ReleasesParseError')<{
	message: string
	cause: unknown
}>() {
	constructor(args: { cause: unknown }) {
		super({
			...args,
			message:
				'Failed to parse the GitHub releases API response: ' +
				(args.cause instanceof z.ZodError
					? z.prettifyError(args.cause)
					: args.cause instanceof Error
						? args.cause.message
						: String(args.cause)),
		})
	}
}

class NoMatchingReleaseError extends TaggedError('NoMatchingReleaseError')<{
	range: string
	message: string
}>() {
	constructor(args: { range: string }) {
		super({
			...args,
			message:
				`No Infisical CLI release satisfies the version range "${args.range}". ` +
				`See https://github.com/${OWNER}/${REPO}/releases for available versions.`,
		})
	}
}

export type VersionError =
	| InvalidVersionError
	| VersionTooOldError
	| ResolveLatestError
	| HttpRequestError
	| GitHubApiError
	| ReleasesParseError
	| NoMatchingReleaseError

// Stricter than semver: rejects ranges, prereleases, and build metadata,
// because the version is interpolated into release-tag URLs.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

// Only the fields this action reads; unknown keys are dropped. Requiring an
// array here is the point — an error payload or a shape change fails in the
// Result error channel instead of throwing a TypeError while iterating.
const ReleasesSchema = z.array(
	z.object({
		tag_name: z.string().optional(),
		draft: z.boolean().optional(),
		prerelease: z.boolean().optional(),
	})
)

export function normalizeVersion(
	input: string
): Result<ResolvedVersion, InvalidVersionError | VersionTooOldError> {
	const trimmed = input.trim()
	if (!VERSION_RE.test(trimmed)) {
		return Result.err(new InvalidVersionError({ input }))
	}
	const semver = trimmed.replace(/^v/, '')
	if (lt(semver, MIN_VERSION)) {
		return Result.err(new VersionTooOldError({ semver }))
	}
	return Result.ok({ tag: `v${semver}`, semver })
}

export async function resolveLatest(): Promise<Result<ResolvedVersion, VersionError>> {
	return Result.gen(async function* () {
		const url = `https://github.com/${OWNER}/${REPO}/releases/latest`
		const client = new HttpClient('setup-infisical', [], {
			allowRedirects: false,
		})
		const response = yield* Result.await(
			Result.tryPromise({
				try: () => client.get(url),
				catch: (cause) => new HttpRequestError({ url, cause }),
			})
		)
		const status = response.message.statusCode ?? 0
		const location = response.message.headers.location
		yield* Result.await(
			Result.tryPromise({
				try: () => response.readBody(),
				catch: (cause) => new HttpRequestError({ url, cause }),
			})
		)
		if (status < 300 || status >= 400 || !location) {
			return Result.err(
				new ResolveLatestError({
					message:
						'Failed to resolve the latest Infisical CLI version: expected a ' +
						`redirect from ${url} but got HTTP ${status}. Pin an exact version ` +
						'via the "version" input to work around this.',
				})
			)
		}
		const match = /\/releases\/tag\/(v\d+\.\d+\.\d+)$/.exec(location)
		if (!match || !match[1]) {
			return Result.err(
				new ResolveLatestError({
					message:
						'Failed to resolve the latest Infisical CLI version: could not parse ' +
						`a version tag from the redirect location "${location}". Pin an exact ` +
						'version via the "version" input to work around this.',
				})
			)
		}
		return normalizeVersion(match[1])
	})
}

// Fetch the stable release versions (bare semvers, newest first) from the
// GitHub API. Drafts, prereleases, and tags that are not exact x.y.z are
// skipped. Paginated at 100 per page with a safety cap well above the
// repository's release count.
async function listReleaseVersions(
	authorization: string | undefined
): Promise<Result<string[], HttpRequestError | GitHubApiError | ReleasesParseError>> {
	return Result.gen(async function* () {
		const client = new HttpClient('setup-infisical')
		const headers: Record<string, string> = {
			accept: 'application/vnd.github+json',
			...(authorization ? { authorization } : {}),
		}
		const versions: string[] = []
		const perPage = 100
		const maxPages = 10
		for (let page = 1; page <= maxPages; page++) {
			const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=${perPage}&page=${page}`
			const response = yield* Result.await(
				Result.tryPromise({
					try: () => client.get(url, headers),
					catch: (cause) => new HttpRequestError({ url, cause }),
				})
			)
			const status = response.message.statusCode ?? 0
			const body = yield* Result.await(
				Result.tryPromise({
					try: () => response.readBody(),
					catch: (cause) => new HttpRequestError({ url, cause }),
				})
			)
			if (status !== 200) {
				return Result.err(new GitHubApiError({ status }))
			}
			const releases = yield* Result.try({
				try: () => ReleasesSchema.parse(JSON.parse(body)),
				catch: (cause) => new ReleasesParseError({ cause }),
			})
			for (const release of releases) {
				if (release.draft || release.prerelease || !release.tag_name) continue
				const match = VERSION_RE.exec(release.tag_name)
				if (match) {
					versions.push(release.tag_name.replace(/^v/, ''))
				}
			}
			if (releases.length < perPage) break
		}
		return Result.ok(versions)
	})
}

export async function resolveRange(
	range: string,
	authorization: string | undefined
): Promise<Result<ResolvedVersion, VersionError>> {
	return Result.gen(async function* () {
		const versions = yield* Result.await(listReleaseVersions(authorization))
		const picked = maxSatisfying(versions, range)
		if (!picked) {
			return Result.err(new NoMatchingReleaseError({ range }))
		}
		return normalizeVersion(picked)
	})
}

export async function resolveVersion(
	input: string,
	authorization?: string
): Promise<Result<ResolvedVersion, VersionError>> {
	const trimmed = input.trim()
	if (trimmed.toLowerCase() === 'latest') {
		return await resolveLatest()
	}
	// Exact versions resolve without any network calls.
	if (VERSION_RE.test(trimmed)) {
		return normalizeVersion(trimmed)
	}
	if (validRange(trimmed)) {
		return await resolveRange(trimmed, authorization)
	}
	return Result.err(new InvalidVersionError({ input }))
}
