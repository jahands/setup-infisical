import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import { Result, TaggedError } from 'better-result'

import { install } from './install.js'
import { getTarget } from './platform.js'
import { resolveVersion } from './version.js'

class InvalidChecksumInputError extends TaggedError('InvalidChecksumInputError')<{
	message: string
}>() {
	constructor() {
		super({
			message:
				'Invalid "checksum" input. Expected a 64-character hex SHA-256 ' +
				'digest of the release archive for this platform.',
		})
	}
}

class ChmodError extends TaggedError('ChmodError')<{
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

export async function run(): Promise<void> {
	const result = await Result.gen(async function* () {
		// action.yml owns the 'latest' default.
		const versionInput = core.getInput('version')
		const token = core.getInput('github-token')
		const authorization = token ? `Bearer ${token}` : undefined
		const checksumInput = core.getInput('checksum').trim().toLowerCase()
		if (checksumInput && !/^[0-9a-f]{64}$/.test(checksumInput)) {
			return Result.err(new InvalidChecksumInputError())
		}

		const resolved = yield* Result.await(resolveVersion(versionInput, authorization))
		core.info(`Resolved Infisical CLI version: ${resolved.semver}`)
		const target = yield* getTarget()

		const { toolPath, cacheHit } = yield* Result.await(
			install(resolved, target, authorization, checksumInput || undefined)
		)

		if (target.platform !== 'windows') {
			// tar preserves the executable bit, but zip extraction and cache
			// round-trips are not guaranteed to; chmod defensively.
			yield* Result.try({
				try: () => fs.chmodSync(path.join(toolPath, target.binaryName), 0o755),
				catch: (cause) => new ChmodError({ cause }),
			})
		}
		core.addPath(toolPath)
		core.setOutput('version', resolved.semver)
		core.setOutput('cache-hit', String(cacheHit))
		core.setOutput('infisical-path', path.join(toolPath, target.binaryName))
		core.info(`Infisical CLI ${resolved.semver} installed at ${toolPath} (cache hit: ${cacheHit})`)
		return Result.ok()
	})
	result.tapError((error) => core.setFailed(error.message))
}
