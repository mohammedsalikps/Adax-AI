import type { ReactElement } from 'react'

/**
 * Development-only screen that throws during render, so the route error
 * boundary can be exercised. It is excluded from production builds by the
 * import.meta.env.DEV guard in the router.
 */
export function CrashProbe(): ReactElement {
  throw new Error('CrashProbe: deliberate render failure for error-boundary testing.')
}
