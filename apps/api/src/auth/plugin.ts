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
  }
  interface FastifyContextConfig {
    /** Route needs no session (health checks, login, patient activation). */
    public?: boolean
    /** Permission the caller's role must hold. */
    permission?: Permission
    /** Reachable while the user must still replace a temporary password. */
    allowWhilePasswordChangeRequired?: boolean
  }
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
