import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { AuthShell, FormError } from '../components/auth/AuthShell'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { useAuth } from '../lib/auth/auth-context'
import { authErrorMessage } from '../lib/auth/errors'

const PASSWORD_MIN = 8

export const Route = createFileRoute('/signup')({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) throw redirect({ to: '/' })
  },
  component: SignupPage,
})

function SignupPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!displayName.trim()) {
      setError('Pick a display name.')
      return
    }
    if (!email.trim()) {
      setError('Enter your email.')
      return
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`)
      return
    }
    setBusy(true)
    try {
      await auth.register(email.trim(), password, displayName.trim())
      await navigate({ to: '/' })
    } catch (err) {
      setError(authErrorMessage(err, 'register'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Pick a name and you’re ready to chat."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-accent-strong hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormError>{error}</FormError>}
        <TextField
          label="Display name"
          autoComplete="nickname"
          placeholder="Ada Lovelace"
          maxLength={80}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoFocus
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          hint="8 characters minimum."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  )
}
