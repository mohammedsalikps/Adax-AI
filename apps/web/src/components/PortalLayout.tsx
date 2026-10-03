import type { Role } from '@adaxai/contracts'
import { AppShell } from './shell/AppShell.tsx'

/** The route element of a signed-in role: the shared application shell. */
export function PortalLayout({ role }: { role: Role }) {
  return <AppShell role={role} />
}
