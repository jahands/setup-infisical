import * as fs from 'node:fs'
import * as path from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { Result, TaggedError } from 'better-result'

import { verifyChecksum } from './checksum.js'
import { CACHE_KEY_PREFIX, TOOL_NAME } from './constants.js'
import { getAssetName, getDownloadUrl } from './platform.js'

import type { ChecksumError } from './checksum.js'
import type { Target } from './platform.js'
import type { ResolvedVersion } from './version.js'

export interface InstallResult {
	toolPath: string // directory containing the binary
	cacheHit: boolean // true if the archive was not downloaded
}

class AssetNotFoundError extends TaggedError('AssetNotFoundError')<{
	tag: string
	assetName: string
	message: string
	cause: unknown
}>() {
	constructor(args: { tag: string; assetName: string; cause: unknown }) {
		super({
			...args,
			message:
				`Infisical CLI ${args.tag} has no asset ${args.assetName}. The version may ` +
				'not exist, or the release may have been published without ' +
				'binaries. See https://github.com/Infisical/cli/releases',
		})
	}
}

class DownloadError extends TaggedError('DownloadError')<{
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

class ExtractError extends TaggedError('ExtractError')<{
	archivePath: string
	message: string
	cause: unknown
}>() {
	constructor(args: { archivePath: string; cause: unknown }) {
		super({
			...args,
			message: args.cause instanceof Error ? args.cause.message : String(args.cause),
		})
	}
}

class MissingBinaryError extends TaggedError('MissingBinaryError')<{
	assetName: string
	binaryName: string
	message: string
}>() {
	constructor(args: { assetName: string; binaryName: string }) {
		super({
			...args,
			message: `Archive ${args.assetName} did not contain ${args.binaryName}`,
		})
	}
}

class ToolCacheError extends TaggedError('ToolCacheError')<{
	message: string
	cause: unknown
}>() {
	constructor(args: { cause: unknown }) {
		super({
			...args,
			message: args.cause instanceof Error ? args.cause.message : String(args.cause),
		})
	}
}

export type InstallError =
	| AssetNotFoundError
	| DownloadError
	| ExtractError
	| MissingBinaryError
	| ToolCacheError
	| ChecksumError

// GitHub Actions cache failures never fail the install — the action degrades
// to downloading — so this error is consumed locally and stays private.
class ActionsCacheError extends TaggedError('ActionsCacheError')<{
	message: string
	cause: unknown
}>() {
	constructor(cause: unknown) {
		super({
			message: cause instanceof Error ? cause.message : String(cause),
			cause,
		})
	}
}

// Directory (under RUNNER_TEMP) where the release archive is staged for the
// GitHub Actions cache. RUNNER_TEMP keeps the path on the same drive and at
// the same workspace-relative location across hosted and container jobs,
// which @actions/cache requires to restore correctly. Returns undefined when
// RUNNER_TEMP is unset (e.g. some act/local setups); callers then skip the
// Actions cache layer.
function getArchiveCacheDir(semver: string, target: Target): string | undefined {
	const runnerTemp = process.env.RUNNER_TEMP
	if (!runnerTemp) return undefined
	return path.join(runnerTemp, `infisical-cli-archive-${semver}-${target.platform}-${target.arch}`)
}

export async function install(
	version: ResolvedVersion,
	target: Target,
	authorization: string | undefined,
	providedChecksum: string | undefined
): Promise<Result<InstallResult, InstallError>> {
	const { tag, semver } = version
	return Result.gen(async function* () {
		// 1. Runner tool cache (within-job repeats, pre-baked self-hosted images).
		// Validate that the entry actually contains the binary: tc.find only checks
		// for the directory and its .complete marker, and a stale or foreign entry
		// would otherwise surface later as a bare ENOENT from chmod.
		const foundPath = tc.find(TOOL_NAME, semver, target.arch)
		if (foundPath) {
			if (fs.existsSync(path.join(foundPath, target.binaryName))) {
				core.info(`Found Infisical CLI ${semver} in the runner tool cache`)
				return Result.ok({ toolPath: foundPath, cacheHit: true })
			}
			core.warning(
				`Runner tool cache entry for Infisical CLI ${semver} is missing ` +
					`${target.binaryName}; reinstalling`
			)
		}

		const assetName = getAssetName(semver, target)
		const archiveDir = getArchiveCacheDir(semver, target)
		const cachedArchivePath = archiveDir ? path.join(archiveDir, assetName) : undefined
		const cacheKey = `${CACHE_KEY_PREFIX}-${semver}-${target.platform}-${target.arch}`
		const cacheAvailable = archiveDir !== undefined && cache.isFeatureAvailable()
		if (!cacheAvailable) {
			core.info('GitHub Actions cache service is not available; skipping cache restore')
		}

		// 2. GitHub Actions cache (cross-job / cross-run persistence). The cache
		// stores the release *archive*, never the extracted binary, so a restored
		// entry goes through the same SHA-256 verification as a fresh download —
		// a poisoned or corrupted cache entry falls back to downloading.
		let archivePath: string | undefined
		let cacheHit = false
		if (cacheAvailable && archiveDir && cachedArchivePath) {
			const restoredKey = (
				await Result.tryPromise({
					try: () => cache.restoreCache([archiveDir], cacheKey),
					catch: (cause) => new ActionsCacheError(cause),
				})
			)
				.tapError((error) => {
					core.warning(
						`Failed to restore ${cacheKey} from the GitHub Actions cache: ${error.message}`
					)
				})
				.unwrapOr(undefined)
			if (restoredKey) {
				if (fs.existsSync(cachedArchivePath)) {
					const verified = await verifyChecksum(
						cachedArchivePath,
						assetName,
						tag,
						semver,
						target,
						authorization,
						providedChecksum
					)
					verified.tapBoth({
						ok: () => {
							archivePath = cachedArchivePath
							cacheHit = true
							core.info(
								`Restored Infisical CLI ${semver} archive from the GitHub ` +
									`Actions cache (key: ${cacheKey})`
							)
						},
						err: (error) => {
							fs.rmSync(cachedArchivePath, { force: true })
							core.warning(
								`Restored archive for ${cacheKey} failed checksum verification ` +
									`(${error.message}); falling back to download`
							)
						},
					})
				} else {
					core.warning(
						`GitHub Actions cache entry ${cacheKey} did not contain ` +
							`${assetName}; falling back to download`
					)
				}
			}
		}

		// 3. Download + verify.
		if (!archivePath) {
			const url = getDownloadUrl(tag, assetName)
			core.info(`Downloading ${url}`)
			archivePath = yield* Result.await(
				Result.tryPromise({
					try: () =>
						tc.downloadTool(url, cacheAvailable ? cachedArchivePath : undefined, authorization),
					catch: (cause) =>
						cause instanceof tc.HTTPError && cause.httpStatusCode === 404
							? new AssetNotFoundError({ tag, assetName, cause })
							: new DownloadError({ url, cause }),
				})
			)
			yield* Result.await(
				verifyChecksum(archivePath, assetName, tag, semver, target, authorization, providedChecksum)
			)
		}

		// 4. Extract, then register only the binary in the runner tool cache (the
		// archives are flat and also carry completions/manpages we do not want).
		const archiveToExtract = archivePath
		const extractDir = yield* Result.await(
			Result.tryPromise({
				try: () =>
					target.archiveType === 'zip'
						? tc.extractZip(archiveToExtract)
						: tc.extractTar(archiveToExtract),
				catch: (cause) => new ExtractError({ archivePath: archiveToExtract, cause }),
			})
		)
		const extractedBinary = path.join(extractDir, target.binaryName)
		if (!fs.existsSync(extractedBinary)) {
			return Result.err(new MissingBinaryError({ assetName, binaryName: target.binaryName }))
		}
		const toolPath = yield* Result.await(
			Result.tryPromise({
				try: () => tc.cacheFile(extractedBinary, target.binaryName, TOOL_NAME, semver, target.arch),
				catch: (cause) => new ToolCacheError({ cause }),
			})
		)

		// 5. Persist the verified archive to the Actions cache for later jobs.
		if (cacheAvailable && archiveDir && !cacheHit) {
			const saved = await Result.tryPromise({
				try: () => cache.saveCache([archiveDir], cacheKey),
				catch: (cause) => new ActionsCacheError(cause),
			})
			saved.tapError((error) => {
				if (error.cause instanceof cache.ReserveCacheError) {
					// Another job is saving the same key concurrently; benign.
					core.info(`Cache ${cacheKey} is already being saved by another job`)
				} else {
					core.warning(`Failed to save ${cacheKey} to the GitHub Actions cache: ${error.message}`)
				}
			})
		}
		return Result.ok({ toolPath, cacheHit })
	})
}
