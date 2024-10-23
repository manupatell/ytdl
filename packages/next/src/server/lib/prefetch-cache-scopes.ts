import type { CacheScopeStore } from '../async-storage/cache-scope.external'

export class PrefetchCacheScopes {
  private cacheScopes = new Map<
    string,
    {
      cache: CacheScopeStore['cache']
      // we track timestamp as we evict after 30s
      // if a prefetch cache scope isn't used by then
      timestamp: number
    }
  >()

  private evict() {
    for (const [key, value] of this.cacheScopes) {
      if (value.timestamp < Date.now() - 30_000) {
        this.cacheScopes.delete(key)
      }
    }
  }

  // TODO: should this key include query params if so we need to
  // filter _rsc query
  get(url: string) {
    setImmediate(() => this.evict())
    return this.cacheScopes.get(url)?.cache
  }

  set(url: string, cache: CacheScopeStore['cache']) {
    setImmediate(() => this.evict())
    return this.cacheScopes.set(url, {
      cache,
      timestamp: Date.now(),
    })
  }

  del(url: string) {
    this.cacheScopes.delete(url)
  }
}
