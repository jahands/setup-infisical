import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as tc from '../__fixtures__/tool-cache.js'
import { expectErr } from './helpers.js'

vi.mock('@actions/tool-cache', () => import('../__fixtures__/tool-cache.js'))

const { parseChecksumFile, verifyChecksum } = await import('../src/checksum.js')
const { getTarget } = await import('../src/platform.js')

describe('parseChecksumFile', () => {
	it('parses goreleaser-style two-space separated lines', () => {
		const contents =
			'a'.repeat(64) +
			'  cli_0.43.114_linux_amd64.tar.gz\n' +
			'b'.repeat(64) +
			'  cli_0.43.114_windows_amd64.zip\n'
		const entries = parseChecksumFile(contents)
		expect(entries.get('cli_0.43.114_linux_amd64.tar.gz')).toBe('a'.repeat(64))
		expect(entries.get('cli_0.43.114_windows_amd64.zip')).toBe('b'.repeat(64))
	})

	it('tolerates single spaces, tabs and the * binary-mode prefix', () => {
		const contents = 'c'.repeat(64) + ' cli_one.tar.gz\n' + 'd'.repeat(64) + '\t*cli_two.zip\n'
		const entries = parseChecksumFile(contents)
		expect(entries.get('cli_one.tar.gz')).toBe('c'.repeat(64))
		expect(entries.get('cli_two.zip')).toBe('d'.repeat(64))
	})

	it('lowercases uppercase hex digests', () => {
		const entries = parseChecksumFile('AB'.repeat(32) + '  file.tar.gz\n')
		expect(entries.get('file.tar.gz')).toBe('ab'.repeat(32))
	})

	it('skips blank and malformed lines', () => {
		const contents =
			'\n' +
			'not a checksum line\n' +
			'deadbeef  too-short-hash.tar.gz\n' +
			'e'.repeat(64) +
			'  valid.tar.gz\n' +
			'   \n'
		const entries = parseChecksumFile(contents)
		expect(entries.size).toBe(1)
		expect(entries.get('valid.tar.gz')).toBe('e'.repeat(64))
	})
})

describe('verifyChecksum', () => {
	let tmpDir: string
	let archivePath: string
	let archiveSha: string

	const writeChecksumFile = (name: string, contents: string): string => {
		const filePath = path.join(tmpDir, name)
		fs.writeFileSync(filePath, contents)
		return filePath
	}

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checksum-test-'))
		archivePath = path.join(tmpDir, 'archive.bin')
		const contents = 'infisical archive payload\n'
		fs.writeFileSync(archivePath, contents)
		archiveSha = createHash('sha256').update(contents).digest('hex')
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('uses checksums-darwin.txt first for darwin targets', async () => {
		const target = getTarget('darwin', 'arm64').unwrap()
		const assetName = 'cli_0.43.114_darwin_arm64.tar.gz'
		tc.downloadTool.mockResolvedValueOnce(
			writeChecksumFile('checksums-darwin.txt', `${archiveSha}  ${assetName}\n`)
		)
		const result = await verifyChecksum(
			archivePath,
			assetName,
			'v0.43.114',
			'0.43.114',
			target,
			'Bearer token'
		)
		expect(result.isOk()).toBe(true)
		expect(tc.downloadTool).toHaveBeenCalledTimes(1)
		expect(tc.downloadTool).toHaveBeenCalledWith(
			'https://github.com/Infisical/cli/releases/download/v0.43.114/checksums-darwin.txt',
			undefined,
			'Bearer token'
		)
	})

	it('falls back to checksums.txt when checksums-darwin.txt is missing', async () => {
		// The v0.43.81/82 regression case: darwin hashes moved back into
		// checksums.txt and checksums-darwin.txt was not published.
		const target = getTarget('darwin', 'arm64').unwrap()
		const assetName = 'cli_0.43.81_darwin_arm64.tar.gz'
		tc.downloadTool
			.mockRejectedValueOnce(new tc.HTTPError(404))
			.mockResolvedValueOnce(writeChecksumFile('checksums.txt', `${archiveSha}  ${assetName}\n`))
		const result = await verifyChecksum(
			archivePath,
			assetName,
			'v0.43.81',
			'0.43.81',
			target,
			undefined
		)
		expect(result.isOk()).toBe(true)
		expect(tc.downloadTool).toHaveBeenCalledTimes(2)
		expect(tc.downloadTool).toHaveBeenLastCalledWith(
			'https://github.com/Infisical/cli/releases/download/v0.43.81/checksums.txt',
			undefined,
			undefined
		)
	})

	it('never requests checksums-darwin.txt for linux targets', async () => {
		const target = getTarget('linux', 'x64').unwrap()
		const assetName = 'cli_0.43.114_linux_amd64.tar.gz'
		tc.downloadTool.mockResolvedValueOnce(
			writeChecksumFile('checksums.txt', `${archiveSha}  ${assetName}\n`)
		)
		await verifyChecksum(archivePath, assetName, 'v0.43.114', '0.43.114', target, undefined)
		expect(tc.downloadTool).toHaveBeenCalledTimes(1)
		for (const call of tc.downloadTool.mock.calls) {
			expect(call[0]).not.toContain('checksums-darwin.txt')
		}
	})

	it('errors on a hash mismatch with expected and actual in the message', async () => {
		const target = getTarget('linux', 'x64').unwrap()
		const assetName = 'cli_0.43.114_linux_amd64.tar.gz'
		const wrong = 'f'.repeat(64)
		tc.downloadTool.mockResolvedValueOnce(
			writeChecksumFile('checksums.txt', `${wrong}  ${assetName}\n`)
		)
		const error = expectErr(
			await verifyChecksum(archivePath, assetName, 'v0.43.114', '0.43.114', target, undefined)
		)
		expect(error._tag).toBe('ChecksumMismatchError')
		expect(error.message).toBe(
			`SHA-256 mismatch for ${assetName}: expected ${wrong}, got ` +
				`${archiveSha}. The download may be corrupted or tampered with.`
		)
	})

	it('errors listing every file tried when no candidate has the entry', async () => {
		const target = getTarget('win32', 'arm64').unwrap()
		const assetName = 'cli_0.43.114_windows_arm64.zip'
		tc.downloadTool
			.mockResolvedValueOnce(writeChecksumFile('checksums.txt', `${archiveSha}  other-file.zip\n`))
			.mockRejectedValueOnce(new tc.HTTPError(404))
		const error = expectErr(
			await verifyChecksum(archivePath, assetName, 'v0.43.114', '0.43.114', target, undefined)
		)
		expect(error._tag).toBe('ChecksumEntryNotFoundError')
		expect(error.message).toBe(
			`No SHA-256 entry for ${assetName} found in the release checksum ` +
				'files (tried: checksums.txt, cli_0.43.114_checksums.txt) for v0.43.114.'
		)
	})

	it('verifies a provided checksum without downloading checksum files', async () => {
		const target = getTarget('linux', 'x64').unwrap()
		const assetName = 'cli_0.43.114_linux_amd64.tar.gz'
		const result = await verifyChecksum(
			archivePath,
			assetName,
			'v0.43.114',
			'0.43.114',
			target,
			undefined,
			archiveSha
		)
		expect(result.isOk()).toBe(true)
		expect(tc.downloadTool).not.toHaveBeenCalled()
	})

	it('errors when the provided checksum does not match', async () => {
		const target = getTarget('linux', 'x64').unwrap()
		const assetName = 'cli_0.43.114_linux_amd64.tar.gz'
		const wrong = 'a'.repeat(64)
		const error = expectErr(
			await verifyChecksum(
				archivePath,
				assetName,
				'v0.43.114',
				'0.43.114',
				target,
				undefined,
				wrong
			)
		)
		expect(error._tag).toBe('ChecksumMismatchError')
		expect(error.message).toContain(
			`SHA-256 mismatch for ${assetName}: the "checksum" input expected ` +
				`${wrong}, got ${archiveSha}.`
		)
		expect(tc.downloadTool).not.toHaveBeenCalled()
	})

	it('propagates non-404 download errors', async () => {
		const target = getTarget('linux', 'x64').unwrap()
		tc.downloadTool.mockRejectedValueOnce(new tc.HTTPError(500))
		const error = expectErr(
			await verifyChecksum(
				archivePath,
				'cli_0.43.114_linux_amd64.tar.gz',
				'v0.43.114',
				'0.43.114',
				target,
				undefined
			)
		)
		expect(error._tag).toBe('ChecksumDownloadError')
		expect(error.message).toBe('Unexpected HTTP response: 500')
	})
})
