import { vi } from 'vitest'

import type * as core from '@actions/core'

export const getInput = vi.fn<typeof core.getInput>()
export const setOutput = vi.fn<typeof core.setOutput>()
export const setFailed = vi.fn<typeof core.setFailed>()
export const addPath = vi.fn<typeof core.addPath>()
export const info = vi.fn<typeof core.info>()
export const warning = vi.fn<typeof core.warning>()
