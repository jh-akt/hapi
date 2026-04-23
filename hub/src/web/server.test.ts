import { describe, expect, it } from 'bun:test'
import { getStaticAssetCacheControl } from './server'

describe('getStaticAssetCacheControl', () => {
    it('marks hashed assets as immutable', () => {
        expect(getStaticAssetCacheControl('/assets/index-abc123.js')).toBe('public, max-age=31536000, immutable')
    })

    it('forces revalidation for root web files', () => {
        expect(getStaticAssetCacheControl('/')).toBe('no-cache, max-age=0, must-revalidate')
        expect(getStaticAssetCacheControl('/index.html')).toBe('no-cache, max-age=0, must-revalidate')
        expect(getStaticAssetCacheControl('/sw.js')).toBe('no-cache, max-age=0, must-revalidate')
        expect(getStaticAssetCacheControl('/manifest.webmanifest')).toBe('no-cache, max-age=0, must-revalidate')
    })
})
