import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = new Date().toISOString().slice(0, 10)
    const { data: scheduledRows, error } = await supabase
      .from('scheduled_transactions')
      .select('id,start_date,status,notify_whatsapp,notify_whatsapp_number,notify_whatsapp_days_before,notify_whatsapp_on_upcoming')
      .eq('status', 'active')
      .eq('notify_whatsapp', true)
      .eq('notify_whatsapp_on_upcoming', true)

    if (error) throw error

    let queued = 0
    for (const row of scheduledRows || []) {
      const daysBefore = Number(row.notify_whatsapp_days_before || 0)
      const targetDate = addDays(today, daysBefore)
      const { error: invokeError } = await supabase.functions.invoke('send-scheduled-whatsapp', {
        body: {
          scheduled_id: row.id,
          occurrence_date: targetDate,
          notification_type: 'upcoming',
          recipient: row.notify_whatsapp_number,
        },
      })
      if (!invokeError) queued += 1
    }

    return new Response(JSON.stringify({ ok: true, queued }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
