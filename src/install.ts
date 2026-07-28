import * as fs from 'node:fs'
import * as path from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'

import { verifyChecksum } from './checksum.js'
import { CACHE_KEY_PREFIX, TOOL_NAME } from './constants.js'
import { getAssetName, getDownloadUrl } from './platform.js'

import type { Target } from './platform.js'
import type { ResolvedVersion } from './version.js'

export interface InstallResult {
	toolPath: string // directory containing the binary
	cacheHit: boolean // true if the archive was not downloaded
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
): Promise<InstallResult> {
	const { tag, semver } = version

	// 1. Runner tool cache (within-job repeats, pre-baked self-hosted images).
	// Validate that the entry actually contains the binary: tc.find only checks
	// for the directory and its .complete marker, and a stale or foreign entry
	// would otherwise surface later as a bare ENOENT from chmod.
	const foundPath = tc.find(TOOL_NAME, semver, target.arch)
	if (foundPath) {
		if (fs.existsSync(path.join(foundPath, target.binaryName))) {
			core.info(`Found Infisical CLI ${semver} in the runner tool cache`)
			return { toolPath: foundPath, cacheHit: true }
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
		let restoredKey: string | undefined
		try {
			restoredKey = await cache.restoreCache([archiveDir], cacheKey)
		} catch (error) {
			core.warning(
				`Failed to restore ${cacheKey} from the GitHub Actions cache: ` +
					`${error instanceof Error ? error.message : String(error)}`
			)
		}
		if (restoredKey) {
			if (fs.existsSync(cachedArchivePath)) {
				try {
					await verifyChecksum(
						cachedArchivePath,
						assetName,
						tag,
						semver,
						target,
						authorization,
						providedChecksum
					)
					archivePath = cachedArchivePath
					cacheHit = true
					core.info(
						`Restored Infisical CLI ${semver} archive from the GitHub ` +
							`Actions cache (key: ${cacheKey})`
					)
				} catch (error) {
					fs.rmSync(cachedArchivePath, { force: true })
					core.warning(
						`Restored archive for ${cacheKey} failed checksum verification ` +
							`(${error instanceof Error ? error.message : String(error)}); ` +
							'falling back to download'
					)
				}
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
		try {
			archivePath = await tc.downloadTool(
				url,
				cacheAvailable ? cachedArchivePath : undefined,
				authorization
			)
		} catch (error) {
			if (error instanceof tc.HTTPError && error.httpStatusCode === 404) {
				throw new Error(
					`Infisical CLI ${tag} has no asset ${assetName}. The version may ` +
						'not exist, or the release may have been published without ' +
						'binaries. See https://github.com/Infisical/cli/releases',
					{ cause: error }
				)
			}
			throw error
		}
		await verifyChecksum(
			archivePath,
			assetName,
			tag,
			semver,
			target,
			authorization,
			providedChecksum
		)
	}

	// 4. Extract, then register only the binary in the runner tool cache (the
	// archives are flat and also carry completions/manpages we do not want).
	const extractDir =
		target.archiveType === 'zip'
			? await tc.extractZip(archivePath)
			: await tc.extractTar(archivePath)
	const extractedBinary = path.join(extractDir, target.binaryName)
	if (!fs.existsSync(extractedBinary)) {
		throw new Error(`Archive ${assetName} did not contain ${target.binaryName}`)
	}
	const toolPath = await tc.cacheFile(
		extractedBinary,
		target.binaryName,
		TOOL_NAME,
		semver,
		target.arch
	)

	// 5. Persist the verified archive to the Actions cache for later jobs.
	if (cacheAvailable && archiveDir && !cacheHit) {
		try {
			await cache.saveCache([archiveDir], cacheKey)
		} catch (error) {
			if (error instanceof cache.ReserveCacheError) {
				// Another job is saving the same key concurrently; benign.
				core.info(`Cache ${cacheKey} is already being saved by another job`)
			} else {
				core.warning(
					`Failed to save ${cacheKey} to the GitHub Actions cache: ` +
						`${error instanceof Error ? error.message : String(error)}`
				)
			}
		}
	}
	return { toolPath, cacheHit }
}
