'use client'
import { useState } from 'react'
import { usePlannerStore } from '@/store/plannerStore'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutFooter, HStack, VStack } from '@astryxdesign/core/Layout'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Mail, User } from 'lucide-react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Pre-provision a person who hasn't signed in yet: creates their profiles row
// by email so they can be assigned work and given roles immediately; their
// account links to the row on first sign-in (see db.linkOwnProfile).
export default function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const addPerson = usePlannerStore(s => s.addPerson)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const badEmail = !EMAIL_RE.test(email.trim())
    setEmailError(badEmail)
    if (badEmail || !name.trim()) return
    setSaving(true)
    const ok = await addPerson(email, name)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div data-astryx-theme="neutral">
      <Dialog isOpen onOpenChange={o => !o && onClose()} purpose="form" width={440}>
        <Layout
          header={
            <DialogHeader
              title="Add person"
              subtitle="They can be assigned work right away and link to this entry when they first sign in"
              onOpenChange={() => onClose()}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={4}>
                <TextInput
                  label="Full name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Jane Smith"
                  startIcon={User}
                  hasAutoFocus
                  isRequired
                />
                <TextInput
                  type="email"
                  label="Work email"
                  value={email}
                  onChange={v => { setEmail(v); setEmailError(false) }}
                  placeholder="name@thepurefoodco.com"
                  startIcon={Mail}
                  isRequired
                  status={emailError ? { type: 'error', message: 'Enter a valid email address' } : undefined}
                />
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="secondary" onClick={onClose} />
                <Button label="Add person" variant="primary" isLoading={saving} onClick={submit} />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </div>
  )
}
