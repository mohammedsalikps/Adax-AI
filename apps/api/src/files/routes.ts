import { and, eq, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { files } from '../db/schema.ts'
import { notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { readStoredBytes } from './storage.ts'

/** Staff download of an uploaded file of their facility (audited). */
export function registerFileRoutes(app: FastifyInstance, { db, config }: { db: Db; config: Config }) {
  app.get('/api/files/:id', { config: { permission: 'patients:read' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(z.object({ id: z.uuid() }), req.params)
    // Dataset exports have their own route and permission (thermal:export).
    const f = await db.query.files.findFirst({ where: and(eq(files.id, id), eq(files.facilityId, me.facilityId), ne(files.kind, 'dataset_export')) })
    if (!f) throw notFound('File')
    const data = await readStoredBytes(config.storageDir, f.storageKey)
    await audit(db, req, { action: 'file.read', entityType: 'file', entityId: id, patientId: f.patientId, details: { kind: f.kind } })
    return reply
      .header('content-type', f.mimeType)
      .header('content-length', String(data.length))
      .header('content-disposition', `inline; filename="${(f.originalName ?? 'file').replace(/[^\w.-]/g, '_')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(data)
  })
}
