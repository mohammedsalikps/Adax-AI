import { BluetoothOff } from 'lucide-react'

/**
 * Health-band connection indicator.
 *
 * This application integrates with no medical device. There is no Bluetooth
 * pairing, no wearable stream and no live telemetry anywhere in it — vitals
 * come from seeded demonstration records or from what the doctor types into
 * the Record dialog.
 *
 * So this deliberately reports "No device linked" rather than showing a
 * connected band. A demo that displays a live device connection it does not
 * have is claiming a capability the product cannot perform, which is exactly
 * the kind of claim this application avoids everywhere else.
 */
export function DeviceLinkStatus() {
  return (
    <span
      title="This demonstration integrates with no wearable or medical device."
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line px-2 py-1 text-[10px] font-semibold text-ink-muted"
    >
      <BluetoothOff size={12} aria-hidden />
      No device linked
    </span>
  )
}
