import { APPLICATION_ORDER } from '../lib/applications.ts'
import { ApplicationCard } from '../components/auth/ApplicationCard.tsx'
import { AuthShell } from '../components/auth/AuthShell.tsx'
import { ServiceStatus } from '../components/auth/ServiceStatus.tsx'
import { SignedInNotice } from '../components/auth/SignedInNotice.tsx'
import { useMe } from '../lib/auth.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

/**
 * The front door: ADAXAI's three applications, one card each. Choosing one
 * only takes you to its sign-in page; it grants nothing and chooses nothing
 * for the API, which decides from the account on every request.
 */
export function ApplicationSelectorPage() {
  useDocumentTitle('Choose your application')
  const { data: me } = useMe()
  return (
    <AuthShell wide hideBrand>
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 pt-2 text-center sm:pt-8">
        <img src="/favicon.svg" alt="" className="size-14 rounded-2xl shadow-card" />
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ADAXAI</h1>
        <p className="text-lg text-ink-muted sm:text-xl">Connected Healthcare Intelligence Platform</p>
        <p className="mt-2 text-sm text-ink-muted sm:text-base">Choose the application you want to open.</p>
      </div>

      {me && (
        <div className="mx-auto mt-8 w-full max-w-3xl">
          <SignedInNotice me={me} />
        </div>
      )}

      <ul className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6" aria-label="ADAXAI applications">
        {APPLICATION_ORDER.map((a) => (
          <li key={a}>
            <ApplicationCard application={a} />
          </li>
        ))}
      </ul>

      <div className="mx-auto mt-8 w-full max-w-xl">
        <ServiceStatus />
      </div>
    </AuthShell>
  )
}
