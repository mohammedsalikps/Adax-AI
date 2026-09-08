import { lazy } from 'react'

/* ------------------------------------------------------------------
   Lazily loaded screens, kept apart from the route table so that file
   exports only the router (and Fast Refresh stays happy).

   Today's Clinic is the landing screen and is NOT lazy — it ships in the
   main bundle so the first paint needs no extra request.
------------------------------------------------------------------ */

export const PatientRegistrationPage = lazy(() =>
  import('@/features/registration/PatientRegistrationPage').then((module) => ({
    default: module.PatientRegistrationPage,
  })),
)

export const PatientSearchPage = lazy(() =>
  import('@/features/search/PatientSearchPage').then((module) => ({
    default: module.PatientSearchPage,
  })),
)

export const PatientProfilePage = lazy(() =>
  import('@/features/profile/PatientProfilePage').then((module) => ({
    default: module.PatientProfilePage,
  })),
)

export const ConsultationPage = lazy(() =>
  import('@/features/consultation/ConsultationPage').then((module) => ({
    default: module.ConsultationPage,
  })),
)

/** Development aid. Absent from production builds; the catch-all serves 404. */
export const ComponentShowcasePage = import.meta.env.DEV
  ? lazy(() =>
      import('@/features/showcase/ComponentShowcasePage').then((module) => ({
        default: module.ComponentShowcasePage,
      })),
    )
  : null

/** Dev-only probe used to verify the error boundary. Absent in production. */
export const CrashProbe = import.meta.env.DEV
  ? lazy(() =>
      import('@/app/CrashProbe').then((module) => ({ default: module.CrashProbe })),
    )
  : null
