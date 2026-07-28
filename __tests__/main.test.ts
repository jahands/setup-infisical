import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as cache from '../__fixtures__/cache.js'
import * as core from '../__fixtures__/core.js'
import * as httpClient from '../__fixtures__/http-client.js'
import * as tc from '../__fixtures__/tool-cache.js'

import type { Target } from '../src/platform.js'

vi.mock('@actions/cache', () => import('../__fixtures__/cache.js'))
vi.mock('@actions/core', () => import('../__fixtures__/core.js'))
vi.mock('@actions/http-client', () => import('../__fixtures__/http-client.js'))
vi.mock('@actions/tool-cache', () => import('../__fixtures__/tool-cache.js'))

const { run } = await import('../src/main.js')
const { getTarget, getAssetName } = await import('../src/platform.js')

const SEMVER = '0.43.114'
const TAG = 'v0.43.114'
const target = getTarget() // host platform; tests derive expectations from it
const assetName = getAssetName(SEMVER, target)
const extractMock = target.archiveType === 'zip' ? tc.extractZip : tc.extractTar
const cacheKey = `infisical-cli-2-${SEMVER}-${target.platform}-${target.arch}`
const ARCHIVE_CONTENTS = 'archive payload'
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE_CONTENTS).digest('hex')

let tmpDir: string
let runnerTempDir: string
const originalToolCache = process.env.RUNNER_TOOL_CACHE
const originalRunnerTemp = process.env.RUNNER_TEMP

const expectedArchiveDir = (t: Target = target): string =>
	path.join(runnerTempDir, `infisical-cli-archive-${SEMVER}-${t.platform}-${t.arch}`)

const expectedArchivePath = (t: Target = target): string =>
	path.join(expectedArchiveDir(t), getAssetName(SEMVER, t))

/** Create a directory under tmpDir containing the CLI binary. */
const makeBinDir = (name: string, t: Target = target): string => {
	const dir = path.join(tmpDir, name)
	fs.mkdirSync(dir, { recursive: true })
	fs.writeFileSync(path.join(dir, t.binaryName), 'binary')
	return dir
}

/**
 * Point tc.downloadTool at a matching checksum file, and have it write the
 * archive to the requested destination (mirroring the real implementation).
 */
const mockDownloads = (t: Target = target): void => {
	const asset = getAssetName(SEMVER, t)
	const checksumPath = path.join(tmpDir, 'checksums.txt')
	fs.writeFileSync(checksumPath, `${ARCHIVE_SHA}  ${asset}\n`)
	tc.downloadTool.mockImplementation((url: string, dest?: string) => {
		if (url.endsWith(`/${asset}`)) {
			const archivePath = dest ?? path.join(tmpDir, asset)
			fs.mkdirSync(path.dirname(archivePath), { recursive: true })
			fs.writeFileSync(archivePath, ARCHIVE_CONTENTS)
			return Promise.resolve(archivePath)
		}
		if (url.includes('checksums')) return Promise.resolve(checksumPath)
		return Promise.reject(new Error(`Unexpected download URL in test: ${url}`))
	})
}

const setInputs = (version: string, token = '', checksum = ''): void => {
	core.getInput.mockImplementation((name: string) => {
		if (name === 'version') return version
		if (name === 'github-token') return token
		if (name === 'checksum') return checksum
		return ''
	})
}

/** Temporarily override process.platform/process.arch. */
const stubHostTarget = (
	nodePlatform: NodeJS.Platform,
	nodeArch: NodeJS.Architecture
): (() => void) => {
	const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')
	const archDesc = Object.getOwnPropertyDescriptor(process, 'arch')
	Object.defineProperty(process, 'platform', {
		value: nodePlatform,
		configurable: true,
	})
	Object.defineProperty(process, 'arch', {
		value: nodeArch,
		configurable: true,
	})
	return () => {
		if (platformDesc) Object.defineProperty(process, 'platform', platformDesc)
		if (archDesc) Object.defineProperty(process, 'arch', archDesc)
	}
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-test-'))
	runnerTempDir = path.join(tmpDir, 'runner-temp')
	fs.mkdirSync(runnerTempDir, { recursive: true })
	process.env.RUNNER_TOOL_CACHE = path.join(tmpDir, 'tool-cache')
	process.env.RUNNER_TEMP = runnerTempDir
	tc.find.mockReturnValue('')
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
	process.env.RUNNER_TOOL_CACHE = originalToolCache
	process.env.RUNNER_TEMP = originalRunnerTemp
})

describe('run', () => {
	it('uses the runner tool cache when present (no download, no actions cache)', async () => {
		setInputs(SEMVER)
		const found = makeBinDir('found')
		tc.find.mockReturnValue(found)

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(tc.downloadTool).not.toHaveBeenCalled()
		expect(cache.restoreCache).not.toHaveBeenCalled()
		expect(cache.saveCache).not.toHaveBeenCalled()
		expect(core.addPath).toHaveBeenCalledWith(found)
		expect(core.setOutput).toHaveBeenCalledWith('version', SEMVER)
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'true')
		expect(core.setOutput).toHaveBeenCalledWith(
			'infisical-path',
			path.join(found, target.binaryName)
		)
	})

	it('ignores a tool cache entry that is missing the binary and downloads', async () => {
		setInputs(SEMVER)
		const stale = path.join(tmpDir, 'stale')
		fs.mkdirSync(stale, { recursive: true }) // no binary inside
		tc.find.mockReturnValue(stale)
		cache.isFeatureAvailable.mockReturnValue(false)
		mockDownloads()
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(core.warning).toHaveBeenCalledWith(
			expect.stringContaining(`missing ${target.binaryName}`)
		)
		expect(tc.downloadTool).toHaveBeenCalled()
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
	})

	it('restores the archive from the GitHub Actions cache and re-verifies it', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(true)
		cache.restoreCache.mockResolvedValue(cacheKey)
		mockDownloads()
		// Simulate a restored cache entry: the verified archive is in place.
		fs.mkdirSync(expectedArchiveDir(), { recursive: true })
		fs.writeFileSync(expectedArchivePath(), ARCHIVE_CONTENTS)
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		const cachedDir = makeBinDir('cached')
		tc.cacheFile.mockResolvedValue(cachedDir)

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(cache.restoreCache).toHaveBeenCalledWith([expectedArchiveDir()], cacheKey)
		// Only the checksum file is downloaded, never the asset itself.
		expect(tc.downloadTool).toHaveBeenCalledTimes(1)
		expect(tc.downloadTool.mock.calls[0]?.[0]).toContain('checksums')
		expect(extractMock).toHaveBeenCalledWith(expectedArchivePath())
		expect(cache.saveCache).not.toHaveBeenCalled()
		expect(core.addPath).toHaveBeenCalledWith(cachedDir)
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'true')
	})

	it('discards a restored archive that fails verification and downloads', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(true)
		cache.restoreCache.mockResolvedValue(cacheKey)
		mockDownloads()
		// Poisoned cache entry: contents do not match the release checksum.
		fs.mkdirSync(expectedArchiveDir(), { recursive: true })
		fs.writeFileSync(expectedArchivePath(), 'poisoned payload')
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))
		cache.saveCache.mockResolvedValue(1)

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(core.warning).toHaveBeenCalledWith(
			expect.stringContaining('failed checksum verification')
		)
		expect(tc.downloadTool).toHaveBeenCalledWith(
			`https://github.com/Infisical/cli/releases/download/${TAG}/${assetName}`,
			expectedArchivePath(),
			undefined
		)
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
	})

	it('downloads, verifies, extracts, registers and saves on a full miss', async () => {
		setInputs(SEMVER, 'token123')
		cache.isFeatureAvailable.mockReturnValue(true)
		cache.restoreCache.mockResolvedValue(undefined)
		mockDownloads()
		const extractDir = makeBinDir('extracted')
		extractMock.mockResolvedValue(extractDir)
		const cachedDir = makeBinDir('cached')
		tc.cacheFile.mockResolvedValue(cachedDir)
		cache.saveCache.mockResolvedValue(1)

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(tc.downloadTool).toHaveBeenCalledWith(
			`https://github.com/Infisical/cli/releases/download/${TAG}/${assetName}`,
			expectedArchivePath(),
			'Bearer token123'
		)
		expect(extractMock).toHaveBeenCalledTimes(1)
		expect(extractMock).toHaveBeenCalledWith(expectedArchivePath())
		expect(tc.cacheFile).toHaveBeenCalledTimes(1)
		expect(tc.cacheFile).toHaveBeenCalledWith(
			path.join(extractDir, target.binaryName),
			target.binaryName,
			'infisical',
			SEMVER,
			target.arch
		)
		expect(cache.saveCache).toHaveBeenCalledTimes(1)
		expect(cache.saveCache).toHaveBeenCalledWith([expectedArchiveDir()], cacheKey)
		expect(core.addPath).toHaveBeenCalledWith(cachedDir)
		expect(core.setOutput).toHaveBeenCalledWith('version', SEMVER)
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
		expect(core.setOutput).toHaveBeenCalledWith(
			'infisical-path',
			path.join(cachedDir, target.binaryName)
		)
	})

	it('installs without the cache service when it is unavailable', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(false)
		mockDownloads()
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(cache.restoreCache).not.toHaveBeenCalled()
		expect(cache.saveCache).not.toHaveBeenCalled()
		// No cache: the archive is downloaded to the default location.
		expect(tc.downloadTool).toHaveBeenCalledWith(
			`https://github.com/Infisical/cli/releases/download/${TAG}/${assetName}`,
			undefined,
			undefined
		)
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
	})

	it('treats a concurrent cache reservation as benign', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(true)
		cache.restoreCache.mockResolvedValue(undefined)
		mockDownloads()
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))
		cache.saveCache.mockRejectedValue(new cache.ReserveCacheError('already reserved'))

		await run()

		expect(core.info).toHaveBeenCalledWith(
			expect.stringContaining('already being saved by another job')
		)
		expect(core.warning).not.toHaveBeenCalled()
		expect(core.setFailed).not.toHaveBeenCalled()
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
	})

	it('downgrades other saveCache failures to a warning', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(true)
		cache.restoreCache.mockResolvedValue(undefined)
		mockDownloads()
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))
		cache.saveCache.mockRejectedValue(new Error('upload failed'))

		await run()

		expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('upload failed'))
		expect(core.setFailed).not.toHaveBeenCalled()
		expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
	})

	it('handles windows targets: zip extraction, infisical.exe, no chmod', async () => {
		const restoreHost = stubHostTarget('win32', 'x64')
		try {
			const winTarget = getTarget('win32', 'x64')
			setInputs(SEMVER)
			cache.isFeatureAvailable.mockReturnValue(false)
			mockDownloads(winTarget)
			const extractDir = makeBinDir('extracted', winTarget)
			tc.extractZip.mockResolvedValue(extractDir)
			const cachedDir = makeBinDir('cached', winTarget)
			tc.cacheFile.mockResolvedValue(cachedDir)

			await run()

			expect(core.setFailed).not.toHaveBeenCalled()
			expect(tc.extractZip).toHaveBeenCalledTimes(1)
			expect(tc.extractTar).not.toHaveBeenCalled()
			expect(tc.cacheFile).toHaveBeenCalledWith(
				path.join(extractDir, 'infisical.exe'),
				'infisical.exe',
				'infisical',
				SEMVER,
				'amd64'
			)
			expect(core.setOutput).toHaveBeenCalledWith(
				'infisical-path',
				path.join(cachedDir, 'infisical.exe')
			)
		} finally {
			restoreHost()
		}
	})

	it('verifies against a provided checksum instead of the release files', async () => {
		setInputs(SEMVER, '', ARCHIVE_SHA.toUpperCase())
		cache.isFeatureAvailable.mockReturnValue(false)
		mockDownloads()
		extractMock.mockResolvedValue(makeBinDir('extracted'))
		tc.cacheFile.mockResolvedValue(makeBinDir('cached'))

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		// Only the asset itself is downloaded, never a checksum file.
		expect(tc.downloadTool).toHaveBeenCalledTimes(1)
		expect(tc.downloadTool.mock.calls[0]?.[0]).toContain(assetName)
		expect(core.setOutput).toHaveBeenCalledWith('version', SEMVER)
	})

	it('fails a malformed checksum input before any network access', async () => {
		setInputs(SEMVER, '', 'not-a-sha256')

		await run()

		expect(core.setFailed).toHaveBeenCalledWith(
			expect.stringContaining('Invalid "checksum" input.')
		)
		expect(tc.downloadTool).not.toHaveBeenCalled()
		expect(httpClient.get).not.toHaveBeenCalled()
		expect(core.addPath).not.toHaveBeenCalled()
	})

	it('fails with the no-binaries message on an asset 404', async () => {
		setInputs(SEMVER)
		cache.isFeatureAvailable.mockReturnValue(false)
		tc.downloadTool.mockRejectedValue(new tc.HTTPError(404))

		await run()

		expect(core.setFailed).toHaveBeenCalledWith(
			`Infisical CLI ${TAG} has no asset ${assetName}. The version may not ` +
				'exist, or the release may have been published without binaries. ' +
				'See https://github.com/Infisical/cli/releases'
		)
		expect(extractMock).not.toHaveBeenCalled()
		expect(core.addPath).not.toHaveBeenCalled()
		expect(core.setOutput).not.toHaveBeenCalled()
	})

	it('fails on an unsupported architecture without any network calls', async () => {
		setInputs(SEMVER)
		const descriptor = Object.getOwnPropertyDescriptor(process, 'arch')
		Object.defineProperty(process, 'arch', {
			value: 'ia32',
			configurable: true,
		})
		try {
			await run()
		} finally {
			if (descriptor) Object.defineProperty(process, 'arch', descriptor)
		}

		expect(core.setFailed).toHaveBeenCalledWith(
			expect.stringContaining(`Unsupported platform/architecture: ${process.platform}/ia32.`)
		)
		expect(tc.downloadTool).not.toHaveBeenCalled()
		expect(httpClient.get).not.toHaveBeenCalled()
		expect(core.addPath).not.toHaveBeenCalled()
	})

	it('resolves "latest" via the releases redirect before installing', async () => {
		setInputs('latest')
		httpClient.get.mockResolvedValueOnce(
			httpClient.mockResponse(302, {
				location: `https://github.com/Infisical/cli/releases/tag/${TAG}`,
			})
		)
		const found = makeBinDir('found')
		tc.find.mockReturnValue(found)

		await run()

		expect(core.setFailed).not.toHaveBeenCalled()
		expect(httpClient.get).toHaveBeenCalledWith('https://github.com/Infisical/cli/releases/latest')
		expect(core.setOutput).toHaveBeenCalledWith('version', SEMVER)
	})
})
