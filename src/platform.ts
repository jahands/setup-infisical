import { Result, TaggedError } from 'better-result'

import { OWNER, REPO } from './constants.js'

export class UnsupportedPlatformError extends TaggedError('UnsupportedPlatformError')<{
	nodePlatform: string
	nodeArch: string
	message: string
}>() {
	constructor(args: { nodePlatform: string; nodeArch: string }) {
		super({
			...args,
			message:
				`Unsupported platform/architecture: ${args.nodePlatform}/${args.nodeArch}. ` +
				'Supported: linux (x64, arm64), macOS (x64, arm64), Windows (x64, arm64).',
		})
	}
}

export interface Target {
	platform: 'linux' | 'darwin' | 'windows'
	arch: 'amd64' | 'arm64'
	archiveType: 'tar.gz' | 'zip'
	binaryName: 'infisical' | 'infisical.exe'
}

const PLATFORMS: Partial<Record<NodeJS.Platform, Target['platform']>> = {
	linux: 'linux',
	darwin: 'darwin',
	win32: 'windows',
}

const ARCHES: Partial<Record<NodeJS.Architecture, Target['arch']>> = {
	x64: 'amd64',
	arm64: 'arm64',
}

export function getTarget(
	nodePlatform: NodeJS.Platform = process.platform,
	nodeArch: NodeJS.Architecture = process.arch
): Result<Target, UnsupportedPlatformError> {
	const platform = PLATFORMS[nodePlatform]
	const arch = ARCHES[nodeArch]
	if (!platform || !arch) {
		return Result.err(new UnsupportedPlatformError({ nodePlatform, nodeArch }))
	}
	return Result.ok({
		platform,
		arch,
		archiveType: platform === 'windows' ? 'zip' : 'tar.gz',
		binaryName: platform === 'windows' ? 'infisical.exe' : 'infisical',
	})
}

export function getAssetName(semver: string, target: Target): string {
	return `cli_${semver}_${target.platform}_${target.arch}.${target.archiveType}`
}

export function getDownloadUrl(tag: string, assetName: string): string {
	return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${assetName}`
}
