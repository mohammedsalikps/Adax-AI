import type { ThermalCapture, ThermalFlags } from '@adaxai/contracts'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical } from 'lucide-react'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtC } from '../../lib/thermal.ts'
import { Button } from '../ui/Button.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { Card } from '../ui/Layout.tsx'

/** Fetched only when the user asks; keyed on the saved regions so it refreshes after a save. */
export function useThermalFlags(c: ThermalCapture, enabled: boolean) {
  return useQuery({
    queryKey: ['thermal', c.id, 'flags', c.rois.map((r) => `${r.id}:${r.pairWith ?? ''}`).join(',')],
    queryFn: () => api<ThermalFlags>(`/thermal/${c.id}/flags`),
    enabled,
    staleTime: Infinity,
  })
}

/**
 * Experimental rule-based flags. Hidden until requested, always labelled as
 * not validated and not a diagnosis.
 */
export function ThermalFlagsCard({ shown, onToggle, flags, unsaved }: { shown: boolean; onToggle: (v: boolean) => void; flags: ReturnType<typeof useThermalFlags>; unsaved: boolean }) {
  const f = flags.data
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          Experimental flags <Badge tone="warn">Not validated</Badge>
        </span>
      }
      actions={
        <Button size="sm" variant="secondary" icon={<FlaskConical aria-hidden="true" className="size-4" />} onClick={() => onToggle(!shown)} aria-expanded={shown}>
          {shown ? 'Hide flags' : 'Run experimental rules'}
        </Button>
      }
    >
      <p className="text-sm">
        Simple threshold rules that point at areas worth a second look: connected warm areas well above the image average, and temperature differences between paired regions. <strong>They are not a diagnosis, are not clinically validated, and must not be used to make clinical decisions.</strong>
      </p>
      {shown && (
        <div className="mt-4 space-y-4">
          {unsaved && <Alert tone="info">Unsaved region changes are not included. Save the regions to include them.</Alert>}
          {flags.isPending && <Spinner label="Running rules…" />}
          {flags.isError && <Alert tone="error">{errorMessage(flags.error)}</Alert>}
          {f && (
            <div className="space-y-4 text-sm" data-testid="thermal-flags">
              <div>
                <h3 className="font-semibold">Warm areas</h3>
                <p className="text-xs text-ink-muted">
                  At least {f.params.hotspot_k} SD above the image mean (≥ {fmtC(f.image.hotspotThresholdC, 2)}), {f.params.hotspot_min_pixels}+ connected pixels. Outlined with dashed boxes on the image. The background and clothing affect this rule.
                </p>
                {f.hotspots.length ? (
                  <ul className="mt-1 space-y-1 tabular-nums">
                    {f.hotspots.map((h, i) => (
                      <li key={`${h.x}-${h.y}`}>
                        H{i + 1}: x {h.x}, y {h.y}, {h.width} × {h.height} px · max {fmtC(h.maxC, 2)} · mean {fmtC(h.meanC, 2)} (+{h.aboveImageMeanC.toFixed(2)} °C above image mean)
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">No area met the rule.</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold">Paired regions</h3>
                <p className="text-xs text-ink-muted">Flagged when the mean temperatures differ by {f.params.asymmetry_threshold_c.toFixed(1)} °C or more.</p>
                {f.asymmetry.length ? (
                  <ul className="mt-1 space-y-1 tabular-nums">
                    {f.asymmetry.map((a) => (
                      <li key={`${a.a}-${a.b}`}>
                        {a.a} − {a.b}: {a.meanDiffC > 0 ? '+' : ''}
                        {a.meanDiffC.toFixed(2)} °C {a.flagged ? <Badge tone="warn">At or above threshold</Badge> : <Badge>Below threshold</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">No paired regions. Use “Compare with” on a region to pair it.</p>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                Rules {f.version}. {f.disclaimer}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
