import type { FastifyRequest } from 'fastify'
import { badRequest, HttpError } from '../http/errors.ts'

export interface Upload {
  filename: string
  /** MIME type as sent by the client (validate content separately). */
  mimetype: string
  /** Text fields sent BEFORE the file part. */
  fields: Record<string, string>
  data: Buffer
}

/**
 * Reads the single file of a multipart request. Client mistakes (not
 * multipart, malformed body, truncated stream, file too large, no file)
 * become 4xx errors instead of server errors.
 */
export async function readUpload(req: FastifyRequest, what = 'a file'): Promise<Upload> {
  let upload: Upload | null = null
  try {
    const part = await req.file()
    if (part) {
      const data = await part.toBuffer()
      const fields: Record<string, string> = {}
      for (const [k, f] of Object.entries(part.fields)) {
        const v = (f as { value?: unknown } | undefined)?.value
        if (k !== part.fieldname && typeof v === 'string') fields[k] = v
      }
      upload = { filename: part.filename, mimetype: part.mimetype.split(';')[0]!.trim().toLowerCase(), fields, data }
    }
  } catch (e) {
    if (e instanceof HttpError) throw e
    const err = e as { code?: string; statusCode?: number }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) throw new HttpError(413, 'too_large', 'The file is larger than the upload limit.')
    if (err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') throw new HttpError(415, 'not_multipart', 'Send the file as multipart/form-data.')
    throw new HttpError(400, 'malformed_upload', 'The upload could not be read. Send one file as multipart/form-data.')
  }
  if (!upload) throw badRequest(`Attach ${what}`, [{ path: 'file', message: 'Required' }])
  if (!upload.data.length) throw badRequest('The file is empty', [{ path: 'file', message: 'Empty file' }])
  return upload
}
