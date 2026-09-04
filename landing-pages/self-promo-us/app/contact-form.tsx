'use client'

import { useState } from 'react'
import { CircleArrowRight } from 'lucide-react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

// Client-side only lead capture for now (TEST setup): the form posts to
// this project's own /api/contact route, which currently just logs the
// submission — no email/CRM delivery wired yet, since that needs a
// decision on where real leads should land (Resend email vs a Supabase
// table) rather than a default this file should invent. The GA4/GTM
// tracking side is real and independent of that: every submit attempt
// pushes a dataLayer event, which GTM's "generate_lead" trigger picks up
// regardless of whether delivery is wired up yet.
export function ContactForm() {
  const [status, setStatus] = useState<Status>('idle')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('submitting')

    const form = event.currentTarget
    const data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      message: (form.elements.namedItem('message') as HTMLTextAreaElement).value,
    }

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) throw new Error('submit failed')

      // GA4 event via GTM — no PII (name/email/message) in the payload
      // itself, only that a submission happened and where. GTM's GA4 tag
      // config already fires site-wide (provisionContainerWithGa4Tag); a
      // "Custom Event" trigger on "generate_lead" plus a GA4 Event tag
      // turns this into a real GA4 conversion (marked as a key event —
      // see markKeyEvent in google-analytics.ts) without a page reload to
      // catch, since this is a client-side-only form submission.
      window.dataLayer = window.dataLayer || []
      window.dataLayer.push({ event: 'generate_lead', form_location: 'contact_section' })

      setStatus('success')
      form.reset()
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">
        Thanks — we got your message and will reach out shortly.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          What are you looking to grow?
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          required
          className="resize-none border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-accent"
        />
      </div>
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="inline-flex items-center justify-center gap-3 bg-accent px-5 py-3.5 text-sm font-semibold text-accent-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
      >
        {status === 'submitting' ? 'Sending…' : 'Book a free strategy call'}
        <CircleArrowRight className="size-4" aria-hidden="true" />
      </button>
      {status === 'error' && (
        <p className="text-sm text-destructive">Something went wrong — email us directly at hello@kalinindigital.com.</p>
      )}
    </form>
  )
}

declare global {
  interface Window {
    dataLayer: unknown[]
  }
}
