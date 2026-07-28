import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'

import { install } from './install.js'
import { getTarget } from './platform.js'
import { resolveVersion } from './version.js'

export async function run(): Promise<void> {
	try {
		// action.yml owns the 'latest' default.
		const versionInput = core.getInput('version')
		const token = core.getInput('github-token')
		const authorization = token ? `Bearer ${token}` : undefined
		const checksumInput = core.getInput('checksum').trim().toLowerCase()
		if (checksumInput && !/^[0-9a-f]{64}$/.test(checksumInput)) {
			throw new Error(
				'Invalid "checksum" input. Expected a 64-character hex SHA-256 ' +
					'digest of the release archive for this platform.'
			)
		}

		const resolved = await resolveVersion(versionInput, authorization)
		core.info(`Resolved Infisical CLI version: ${resolved.semver}`)
		const target = getTarget()

		const { toolPath, cacheHit } = await install(
			resolved,
			target,
			authorization,
			checksumInput || undefined
		)

		if (target.platform !== 'windows') {
			// tar preserves the executable bit, but zip extraction and cache
			// round-trips are not guaranteed to; chmod defensively.
			fs.chmodSync(path.join(toolPath, target.binaryName), 0o755)
		}
		core.addPath(toolPath)
		core.setOutput('version', resolved.semver)
		core.setOutput('cache-hit', String(cacheHit))
		core.setOutput('infisical-path', path.join(toolPath, target.binaryName))
		core.info(`Infisical CLI ${resolved.semver} installed at ${toolPath} (cache hit: ${cacheHit})`)
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error))
		return
	}
}
