import { Eye, EyeOff } from 'lucide-react'
import { type InputHTMLAttributes, type ReactNode, useState } from 'react'
import { Field } from '../ui/Form.tsx'

/**
 * A password input with a show/hide toggle. The toggle is a real button with a
 * pressed state, reachable by keyboard; the password is never put in storage,
 * the address or a log, and hiding it again is one press. Browsers' password
 * managers are not blocked.
 */
export function PasswordField({ label, error, hint, className, ...rest }: { label: ReactNode; error?: string | undefined; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Field label={label} error={error} hint={hint} required={rest.required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            autoCapitalize="none"
            spellCheck={false}
            className="block min-h-control w-full rounded-md border border-control bg-surface py-0 pr-12 pl-3 text-sm text-ink shadow-card aria-[invalid=true]:border-down"
            {...rest}
          />
          <button
            type="button"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-muted hover:text-ink"
          >
            {visible ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
            <span className="sr-only">Show password</span>
          </button>
        </div>
      )}
    </Field>
  )
}
