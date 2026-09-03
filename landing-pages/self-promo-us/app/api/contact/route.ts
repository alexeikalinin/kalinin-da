import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Writes into `self_promo_lead` (supabase/migrations/0013_self_promo_leads.sql)
// — a standalone table with no foreign key into the client/client_ad_account
// family StarMedia/Astrum data lives in, so this can never be joined with
// either (see project_client_entity_hierarchy: self-promo is its own
// top-level entity, not a client). Uses the service_role key server-side
// only — this route runs on the server (Next.js Route Handler), the key
// is never sent to the browser, same pattern as apps/web/lib/supabase.ts.
function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; email?: string; message?: string }
  if (!body.name || !body.email || !body.message) {
    return NextResponse.json({ error: 'name, email, and message are required' }, { status: 400 })
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })

  const { error } = await supabase.from('self_promo_lead').insert({
    tenant_id: requiredEnv('SUPABASE_OWNER_TENANT_ID'),
    name: body.name,
    email: body.email,
    message: body.message,
    source: 'self_promo_us_landing',
  })

  if (error) {
    console.error('[contact-form] failed to write lead to Supabase:', error.message)
    return NextResponse.json({ error: 'failed to save lead' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
