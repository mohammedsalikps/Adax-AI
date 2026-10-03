/**
 * What an uploaded "audio" file actually is, from its first bytes, not from the name or the type the browser (or anyone) said it has.
 * Only containers the application accepts are recognised; everything else (a text file, a playlist, an image, a script) is not audio here and is
 * refused before it is stored or handed to a decoder. The speech service checks again with the same rule: this is defence in depth, not a
 * substitute for its checks.
 */
export type AudioContainer = 'webm' | 'ogg' | 'wav' | 'mp3' | 'mp4'

/** The container each accepted MIME type must be. */
export const CONTAINER_OF_MIME: Record<string, AudioContainer> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'mp4',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
}

export function sniffAudio(b: Buffer): AudioContainer | null {
  // Matroska / WebM: EBML header.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return 'wav'
  // MP3: an ID3 tag, or an MPEG audio frame sync (11 set bits).
  if (b.toString('latin1', 0, 3) === 'ID3' || (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return 'mp3'
  // MP4 / M4A: a "ftyp" box right after the 4-byte size.
  if (b.length >= 8 && b.toString('latin1', 4, 8) === 'ftyp') return 'mp4'
  return null
}
