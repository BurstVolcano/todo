import { useState, type FormEvent } from 'react'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { Modal } from './Modal'
import { api } from './api'
import type { User } from './types'
export function AuthDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: User) => Promise<void> }) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const { user } = await api<{ user: User }>(`/auth/${mode}`, 'POST', { name, email, password }); await onSuccess(user); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in.') }
    finally { setBusy(false) }
  }
  return <Modal title={mode === 'register' ? 'Your own little corner.' : 'Welcome back.'} onClose={() => { if (!busy) onClose() }}>
    <p className="modal-subtitle">A calmer place for everything you want to do.</p>
    <div className="auth-tabs"><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button></div>
    <form className="editor-form" onSubmit={submit}>
      {mode === 'register' && <label>Your name<input autoFocus required maxLength={80} autoComplete="name" placeholder="Alex Morgan" value={name} onChange={e => setName(e.target.value)} /></label>}
      <label>Email address<input type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary auth-submit" disabled={busy}>{busy ? 'One moment…' : mode === 'register' ? 'Create your account' : 'Sign in'}<ArrowUpRight size={16} /></button>
      <p className="privacy-note"><ShieldCheck size={15} />Your tasks stay private and belong only to you.</p>
    </form>
  </Modal>
}
