import type * as cache from '@actions/cache'
import { vi } from 'vitest'

export const isFeatureAvailable = vi.fn<typeof cache.isFeatureAvailable>()
export const restoreCache = vi.fn<typeof cache.restoreCache>()
export const saveCache = vi.fn<typeof cache.saveCache>()

export class ReserveCacheError extends Error {}
