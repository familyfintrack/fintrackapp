# FinTrack — Processamento Automático de Programados
## 100% via Supabase Dashboard — sem CLI, sem projeto local

---

## Como funciona

Tudo roda dentro do próprio banco de dados Supabase usando duas extensões nativas:

| Extensão | Função |
|---|---|
| `pg_cron` | Agenda execução automática das funções SQL |
| `pg_net` | Faz chamadas HTTP para APIs de notificação (Telegram, EmailJS, WhatsApp) diretamente do banco |

```
06:00 UTC  ── pg_cron ──► ft_process_scheduled_transactions()
                           ├── Registra transações do dia
                           ├── Atualiza saldos das contas
                           ├── Marca ocorrências como executadas
                           └── Enfileira notificações (scheduled_notification_logs)

06:30 UTC  ── pg_cron ──► ft_send_pending_notifications()
                           ├── Lê fila de notificações pendentes
                           ├── Chama API Telegram via net.http_post()
                           ├── Chama API EmailJS via net.http_post()
                           └── Chama API WhatsApp via net.http_post()

07:00 UTC  ── pg_cron ──► ft_queue_upcoming_notifications(3)
                           └── Gera avisos antecipados (próximos 3 dias)
```

---

## Passo 1 — Habilitar extensões

Acesse **Supabase Dashboard → Database → Extensions** e habilite:
- **pg_cron** — necessário para agendamento automático
- **pg_net** — necessário para envio de notificações

---

## Passo 2 — Executar o script SQL

1. Acesse **Supabase Dashboard → SQL Editor → New Query**
2. Abra o arquivo `sql/scheduled_processing_cron.sql`
3. Cole o conteúdo completo e clique em **Run**

O script cria todas as funções e agenda os jobs automaticamente.

**Verificar se os jobs foram criados:**
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;
```

Resultado esperado:
```
fintrack-cleanup-logs        0 2 * * 0    true
fintrack-process-scheduled   0 6 * * *    true
fintrack-send-notifications  30 6 * * *   true
fintrack-upcoming-notifs     0 7 * * *    true
```

---

## Passo 3 — Configurar tokens de notificação (opcional)

Se quiser receber notificações, insira os tokens no **SQL Editor**. Execute apenas os blocos dos canais que você usa:

### Telegram
```sql
INSERT INTO public.app_settings (key, value) VALUES
  ('notif_telegram_bot_token', '"SEU_BOT_TOKEN"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Como obter o token:** fale com [@BotFather](https://t.me/BotFather) no Telegram → `/newbot` → copie o token gerado.

### EmailJS
```sql
INSERT INTO public.app_settings (key, value) VALUES
  ('notif_emailjs_service_id',  '"service_xxxxxxx"'),
  ('notif_emailjs_template_id', '"template_xxxxxxx"'),
  ('notif_emailjs_public_key',  '"sua_public_key"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Como obter:** acesse [emailjs.com](https://www.emailjs.com) → Dashboard → Email Services e Email Templates.

### WhatsApp Business API
```sql
INSERT INTO public.app_settings (key, value) VALUES
  ('notif_wa_api_url', '"https://graph.facebook.com/v19.0/SEU_PHONE_ID/messages"'),
  ('notif_wa_token',   '"seu_access_token"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Verificar tokens configurados:**
```sql
SELECT key, LEFT(value::text, 15) || '...' AS valor_parcial
FROM public.app_settings
WHERE key LIKE 'notif_%';
```

> **Sem notificações:** se não configurar nenhum token, o processamento de transações funciona normalmente. As notificações ficam com status `skipped` na tabela de log.

---

## Passo 4 — Testar manualmente

**Testar processamento de transações:**
```sql
SELECT public.ft_process_scheduled_transactions();
```

Resultado esperado:
```json
{"families": 1, "inserted": 3, "skipped": 0, "notifications": 2, "errors": 0, "duration_ms": 87}
```

**Testar envio de notificações:**
```sql
SELECT public.ft_send_pending_notifications();
```

**Verificar o que foi processado hoje:**
```sql
SELECT t.date, t.description, t.amount, a.name AS conta
FROM public.transactions t
JOIN public.scheduled_run_logs srl ON srl.transaction_id = t.id
JOIN public.accounts a ON a.id = t.account_id
WHERE srl.created_at::date = CURRENT_DATE
ORDER BY t.created_at DESC;
```

**Ver log de execuções:**
```sql
SELECT * FROM public.v_scheduled_audit LIMIT 10;
```

**Ver fila de notificações:**
```sql
SELECT channel, notification_type, recipient, status, occurrence_date
FROM public.scheduled_notification_logs
ORDER BY created_at DESC
LIMIT 20;
```

---

## Referência de horários

| Job | Horário (UTC) | Horário Brasília | O que faz |
|---|---|---|---|
| `fintrack-process-scheduled` | 06:00 | 03:00 | Registra transações do dia |
| `fintrack-send-notifications` | 06:30 | 03:30 | Envia notificações via pg_net |
| `fintrack-upcoming-notifs` | 07:00 | 04:00 | Avisos dos próximos 3 dias |
| `fintrack-cleanup-logs` | 02:00 dom | 23:00 sáb | Limpeza de logs > 90 dias |

> Para alterar os horários, basta re-executar o script com os valores desejados na expressão cron.

---

## Manutenção

**Pausar um job:**
```sql
SELECT cron.unschedule('fintrack-process-scheduled');
```

**Reativar:**
```sql
SELECT cron.schedule(
  'fintrack-process-scheduled', '0 6 * * *',
  $$ SELECT public.ft_process_scheduled_transactions(); $$
);
```

**Reprocessar uma data com erro:**
```sql
-- 1. Marcar a ocorrência para retry
UPDATE public.scheduled_occurrences
SET execution_status = 'failed', error_message = 'manual retry'
WHERE scheduled_id = '<uuid>'
  AND scheduled_date = '2025-01-15';

-- 2. Rodar processamento agora
SELECT public.ft_process_scheduled_transactions();
```

**Ver erros recentes:**
```sql
SELECT run_at, errors_count, error_details
FROM public.scheduled_cron_log
WHERE errors_count > 0
ORDER BY run_at DESC;
```
