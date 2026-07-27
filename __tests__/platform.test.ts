import { getAssetName, getDownloadUrl, getTarget } from '../src/platform.js'

describe('getTarget / getAssetName', () => {
  const cases: Array<
    [
      NodeJS.Platform,
      NodeJS.Architecture,
      string, // asset name for 0.43.114
      'tar.gz' | 'zip',
      'infisical' | 'infisical.exe'
    ]
  > = [
    ['linux', 'x64', 'cli_0.43.114_linux_amd64.tar.gz', 'tar.gz', 'infisical'],
    [
      'linux',
      'arm64',
      'cli_0.43.114_linux_arm64.tar.gz',
      'tar.gz',
      'infisical'
    ],
    [
      'darwin',
      'x64',
      'cli_0.43.114_darwin_amd64.tar.gz',
      'tar.gz',
      'infisical'
    ],
    [
      'darwin',
      'arm64',
      'cli_0.43.114_darwin_arm64.tar.gz',
      'tar.gz',
      'infisical'
    ],
    ['win32', 'x64', 'cli_0.43.114_windows_amd64.zip', 'zip', 'infisical.exe'],
    // Historical bug trap: windows arm64 is a .zip, never a .tar.gz.
    ['win32', 'arm64', 'cli_0.43.114_windows_arm64.zip', 'zip', 'infisical.exe']
  ]

  it.each(cases)(
    '%s/%s -> %s',
    (nodePlatform, nodeArch, assetName, archiveType, binaryName) => {
      const target = getTarget(nodePlatform, nodeArch)
      expect(target.archiveType).toBe(archiveType)
      expect(target.binaryName).toBe(binaryName)
      expect(getAssetName('0.43.114', target)).toBe(assetName)
    }
  )

  it.each([
    ['linux', 'ia32'],
    ['freebsd', 'x64'],
    ['win32', 'arm'],
    ['aix', 'ppc64']
  ] as Array<[NodeJS.Platform, NodeJS.Architecture]>)(
    'throws for unsupported %s/%s',
    (nodePlatform, nodeArch) => {
      expect(() => getTarget(nodePlatform, nodeArch)).toThrow(
        `Unsupported platform/architecture: ${nodePlatform}/${nodeArch}. ` +
          'Supported: linux (x64, arm64), macOS (x64, arm64), Windows (x64, arm64).'
      )
    }
  )
})

describe('getDownloadUrl', () => {
  it('embeds the v-prefixed tag in the URL and the bare semver in the asset', () => {
    const target = getTarget('linux', 'x64')
    const assetName = getAssetName('0.43.114', target)
    expect(getDownloadUrl('v0.43.114', assetName)).toBe(
      'https://github.com/Infisical/cli/releases/download/v0.43.114/cli_0.43.114_linux_amd64.tar.gz'
    )
  })
})
