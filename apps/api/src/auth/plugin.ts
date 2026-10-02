import cookie from '@fastify/cookie'
import type { FastifyInstance } from 'fastify'
import { audit } from '../audit/audit.ts'
import type { Db } from '../db/client.ts'
import { forbidden, HttpError, unauthorized } from '../http/errors.ts'
import { can, type Permission } from './permissions.ts'
import { resolveSession, SESSION_COOKIE, type SessionUser } from './sessions.ts'

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
    /** Set once a denial of this request has been written to the audit log. */
    denialAudited?: boolean
  }
  interface FastifyContextConfig {
    /** Route needs no session (health checks, login, patient activation). */
    public?: boolean
    /** Permission the caller's role must hold. */
    permission?: Permission
    /** Any signed-in user, whatever the role (own session: me, logout, change password). */
    anySession?: boolean
    /** Reachable while the user must still replace a temporary password. */
    allowWhilePasswordChangeRequired?: boolean
  }
  interface FastifyInstance {
    /** Every /api route and how access to it is decided (checked by tests). */
    routeInventory: RouteAccess[]
  }
}

export interface RouteAccess {
  method: string
  url: string
  access: 'public' | 'permission' | 'anySession'
  permission: Permission | null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const CSRF_HEADER = 'x-adaxai-csrf'

export interface AuthOptions {
  db: Db
  cookieSecure: boolean
}

/**
 * Default-deny authentication and authorization for every route:
 * - state-changing requests must carry the custom CSRF header (a cross-site
 *   form or fetch cannot set it without a CORS preflight, which is never granted);
 * - the session cookie is resolved to a user;
 * - routes are private unless `config.public` is set;
 * - `config.permission` is enforced server-side, and denials are audited.
 */
export function registerAuth(app: FastifyInstance, opts: AuthOptions): void {
  void app.register(cookie)
  app.decorateRequest('user', null)

  // Default deny, enforced at start-up: every /api route must say how access
  // is decided (public, a permission, or any signed-in user). A route that
  // says nothing stops the API from starting instead of being open.
  const inventory: RouteAccess[] = []
  app.decorate('routeInventory', inventory)
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return
    const methods = (Array.isArray(route.method) ? route.method : [route.method]).filter((m) => m !== 'HEAD')
    const c = (route.config ?? {}) as { public?: boolean; permission?: Permission; anySession?: boolean }
    const access = c.public ? 'public' : c.permission ? 'permission' : c.anySession ? 'anySession' : null
    if (!access) throw new Error(`Route ${methods.join(',')} ${route.url} declares no access rule (config.public, config.permission or config.anySession)`)
    for (const method of methods) inventory.push({ method, url: route.url, access, permission: c.permission ?? null })
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'csrf_header_missing', 'Request rejected (missing CSRF header)')
    }

    const token = req.cookies[SESSION_COOKIE]
    if (token) {
      req.user = await resolveSession(opts.db, token)
      if (!req.user) void reply.clearCookie(SESSION_COOKIE, { path: '/' })
    }

    const config = req.routeOptions.config
    // Unknown routes fall through to the 404 handler.
    if (!req.routeOptions.url || config.public) return
    if (!req.user) throw unauthorized()
    if (req.user.mustChangePassword && !config.allowWhilePasswordChangeRequired) {
      throw new HttpError(403, 'password_change_required', 'Change your temporary password to continue')
    }
    if (config.permission && !can(req.user.role, config.permission)) {
      await audit(opts.db, req, {
        action: 'access.denied',
        outcome: 'denied',
        details: { permission: config.permission, method: req.method, route: req.routeOptions.url },
      })
      req.denialAudited = true
      throw forbidden()
    }
  })
}

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', expires }
}

/** The signed-in user; only call from routes that are not public. */
export function currentUser(req: { user: SessionUser | null }): SessionUser {
  if (!req.user) throw unauthorized()
  return req.user
}
