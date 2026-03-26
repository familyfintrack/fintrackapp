import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Payload = {
  scheduled_id: string
  occurrence_date: string
  notification_type: 'upcoming' | 'processed' | 'overdue'
  recipient: string
  amount?: number | string | null
  template_name?: string | null
  lang?: string | null
}

function normalizePhone(raw: string | null | undefined) {
  return String(raw || '').replace(/\D+/g, '')
}

async function sendViaMeta(phone: string, bodyText: string) {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!token || !phoneNumberId) throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID não configurados')

  const res = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: bodyText },
    }),
  })

  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message || `Meta HTTP ${res.status}`)
  return {
    provider_message_id: json?.messages?.[0]?.id || null,
    raw: json,
  }
}

async function sendViaTwilio(phone: string, bodyText: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM')
  if (!sid || !token || !from) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM não configurados')

  const auth = btoa(`${sid}:${token}`)
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:+${phone}`,
    Body: bodyText,
  })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.message || `Twilio HTTP ${res.status}`)
  return {
    provider_message_id: json?.sid || null,
    raw: json,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRole)

    const payload = (await req.json()) as Payload
    const scheduledId = payload?.scheduled_id
    const occurrenceDate = payload?.occurrence_date
    const notificationType = payload?.notification_type || 'processed'
    const recipient = normalizePhone(payload?.recipient)
    const lang = payload?.lang || 'pt_BR'
    const templateName = payload?.template_name || (notificationType === 'upcoming' ? 'scheduled_upcoming' : 'scheduled_processed')

    if (!scheduledId || !occurrenceDate || !recipient) {
      return new Response(JSON.stringify({ error: 'scheduled_id, occurrence_date e recipient são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: scheduled, error: scErr } = await supabase
      .from('scheduled_transactions')
      .select('id,family_id,description,amount,currency,type,notify_whatsapp,notify_whatsapp_number,notify_whatsapp_template,notify_whatsapp_lang,accounts:accounts!scheduled_transactions_account_id_fkey(name,currency),categories(name),payees(name)')
      .eq('id', scheduledId)
      .single()

    if (scErr || !scheduled) throw new Error(scErr?.message || 'Programação não encontrada')

    const upsertPayload = {
      family_id: scheduled.family_id,
      scheduled_id: scheduled.id,
      occurrence_date: occurrenceDate,
      channel: 'whatsapp',
      notification_type: notificationType,
      recipient,
      template_name: templateName,
      status: 'processing',
      payload: payload,
      updated_at: new Date().toISOString(),
    }

    const { data: logRow, error: logErr } = await supabase
      .from('scheduled_notification_logs')
      .upsert(upsertPayload, {
        onConflict: 'scheduled_id,occurrence_date,channel,notification_type,recipient',
        ignoreDuplicates: false,
      })
      .select('id,status,sent_at,provider_message_id')
      .single()

    if (logErr) throw new Error(logErr.message)
    if (logRow?.sent_at || logRow?.status === 'sent') {
      return new Response(JSON.stringify({ ok: true, duplicated: true, log_id: logRow.id, provider_message_id: logRow.provider_message_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const description = scheduled.description || 'Transação programada'
    const amount = Number(payload.amount ?? scheduled.amount ?? 0)
    const currency = scheduled.accounts?.currency || scheduled.currency || 'BRL'
    const payee = scheduled.payees?.name || scheduled.categories?.name || ''
    const bodyText = notificationType === 'upcoming'
      ? `⏰ Lembrete FinTrack\n${description}\nData: ${occurrenceDate}\nValor: ${amount} ${currency}${payee ? `\nRef.: ${payee}` : ''}`
      : `✅ Registro automático FinTrack\n${description}\nData: ${occurrenceDate}\nValor: ${amount} ${currency}${payee ? `\nRef.: ${payee}` : ''}`

    const provider = (Deno.env.get('WHATSAPP_PROVIDER') || 'meta').toLowerCase()
    const result = provider === 'twilio'
      ? await sendViaTwilio(recipient, bodyText)
      : await sendViaMeta(recipient, bodyText)

    await supabase
      .from('scheduled_notification_logs')
      .update({
        status: 'sent',
        provider_message_id: result.provider_message_id,
        payload: { ...payload, provider_response: result.raw, lang, template_name: templateName },
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', logRow.id)

    return new Response(JSON.stringify({ ok: true, duplicated: false, log_id: logRow.id, provider_message_id: result.provider_message_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[send-scheduled-whatsapp]', error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
