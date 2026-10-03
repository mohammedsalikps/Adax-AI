// Pure helpers for showing a transcript's times and language (no React: unit-tested with node --test).

/** Milliseconds on a recording's timeline as m:ss (h:mm:ss from an hour). */
export function fmtOffset(ms: number | null | undefined): string {
  if (ms == null) return ''
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** "en" -> "English". Falls back to the code itself. */
export function languageName(code: string | null | undefined): string {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}
