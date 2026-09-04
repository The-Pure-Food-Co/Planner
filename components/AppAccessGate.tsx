'use client'
import type { ReactNode } from 'react'
import { useAppAccess } from '@/lib/useAppAccess'

const GRAD = 'linear-gradient(135deg, #93328E 0%, #C63663 50%, #F8485E 100%)'

// Wrap the app's contents with this to enforce the same per-app restriction
// that hides its tile on the hub — hiding the hub tile alone is cosmetic,
// since anyone who knows the URL could otherwise still open the app
// directly. proxy.ts already proves the user is signed in with an org
// account by the time this runs.
export default function AppAccessGate({ appKey, children }: { appKey: string; children: ReactNode }) {
  const { loading, canSee } = useAppAccess()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#7A7A7A', fontSize: 14 }}>
        Loading…
      </div>
    )
  }

  if (!canSee(appKey)) {
    return (
      <div style={{ fontFamily: "'Montserrat','Inter','Segoe UI',system-ui,sans-serif", background: '#EDE5E2', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#fff', border: '1px solid #D4CCC9', borderRadius: 16, padding: '40px clamp(20px, 6vw, 48px)', textAlign: 'center', width: 'calc(100% - 32px)', maxWidth: 420 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: GRAD, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>
            P
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#2C2C2C', marginBottom: 8 }}>Restricted</div>
          <p style={{ fontSize: 13, color: '#7A7A7A', lineHeight: 1.6, margin: 0 }}>
            You don&apos;t have access to this app. If you think this is a mistake, ask an admin to grant you access.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
