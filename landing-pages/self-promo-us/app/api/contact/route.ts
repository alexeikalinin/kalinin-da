import { NextResponse } from 'next/server'

// TEST setup, 2026-09-04: this only logs the submission — nothing forwards
// it to email/CRM yet. That's a deliberate gap, not an oversight: whether
// leads should go to a Resend-sent email or into Supabase (matching the
// agency's existing client-data model) is the owner's call, not a default
// this route should invent. Wire that up here once decided.
export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; email?: string; message?: string }
  if (!body.name || !body.email || !body.message) {
    return NextResponse.json({ error: 'name, email, and message are required' }, { status: 400 })
  }

  console.log('[contact-form] new lead:', { name: body.name, email: body.email, message: body.message })

  return NextResponse.json({ ok: true })
}
