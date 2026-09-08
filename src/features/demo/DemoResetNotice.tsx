import { useEffect } from 'react'
import { useToast } from '@/components/ui'
import { DEMO_RESET_FLAG } from './DemoDrawer'

/**
 * Confirms a demo reset after the page has reloaded, so the message is
 * shown on the restored screen instead of disappearing with the old one.
 */
export function DemoResetNotice() {
  const { showToast } = useToast()

  useEffect(() => {
    if (sessionStorage.getItem(DEMO_RESET_FLAG) !== '1') return
    sessionStorage.removeItem(DEMO_RESET_FLAG)
    showToast({
      title: 'Demo data reset',
      description: 'Seeded patients, appointments and consultations restored.',
      status: 'success',
    })
  }, [showToast])

  return null
}
