# FinTrack — Processamento Automático de Programados no Supabase

## Visão Geral da Arquitetura

```
06:00 UTC  ── pg_cron ──► ft_process_scheduled_transactions()
                           ├── Insere transactions
                           ├── Atualiza account.balance
                           ├── Marca scheduled_occurrences como executed
                           ├── Insere em scheduled_run_logs (auditoria)
                           └── Enfileira scheduled_notification_logs (pending)

06:30 UTC  ── pg_cron ──► net.http_post → Edge Function ft-send-notifications
                           ├── Lê scheduled_notification_logs (status=pending)
                           ├── Envia Email via EmailJS
                           ├── Envia Telegram via Bot API
                           └── Envia WhatsApp via Business API

07:00 UTC  ── pg_cron ──► ft_queue_upcoming_notifications(3)
                           └── Gera avisos antecipados (até 3 dias antes)
```

---

## Passo 1 — Habilitar Extensões

No **Supabase Dashboard → Database → Extensions**, habilitar:
- `pg_cron` — necessário para agendamento
- `pg_net` — necessário para chamar Edge Functions via cron

---

## Passo 2 — Executar a Migration SQL

1. Acesse **Supabase Dashboard → SQL Editor → New Query**
2. Cole o conteúdo de `sql/scheduled_processing_cron.sql`
3. Clique em **Run**
4. Verifique os jobs criados:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
```

Resultado esperado:
```
fintrack-cleanup-logs       0 2 * * 0    true
fintrack-process-scheduled  0 6 * * *    true
fintrack-upcoming-notifs    0 7 * * *    true
```

---

## Passo 3 — Deploy da Edge Function

### 3.1 Instalar Supabase CLI

```bash
npm install -g supabase
supabase login
```

### 3.2 Configurar projeto local

```bash
cd fintrackapp-main
supabase init   # apenas se não tiver supabase/config.toml
supabase link --project-ref wkiytjwuztnytygpxooe
```

### 3.3 Deploy da função

```bash
supabase functions deploy ft-send-notifications --no-verify-jwt
```

### 3.4 Configurar variáveis de ambiente

No **Supabase Dashboard → Settings → Edge Functions**:

| Variável | Valor | Obrigatório |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | Chave `service_role` (Settings → API) | ✅ |
| `EMAILJS_SERVICE_ID` | ID do serviço EmailJS | Para email |
| `EMAILJS_TEMPLATE_SCHED` | ID do template para programados | Para email |
| `EMAILJS_USER_ID` | Public Key do EmailJS | Para email |
| `TELEGRAM_BOT_TOKEN` | Token do bot | Para Telegram |
| `WA_API_URL` | URL da API WhatsApp Business | Para WhatsApp |
| `WA_TOKEN` | Token de acesso WhatsApp | Para WhatsApp |

### 3.5 Agendar a Edge Function via pg_cron

Execute no SQL Editor após o deploy:

```sql
-- Substituir <ANON_KEY> pela chave anon do projeto
-- (Supabase Dashboard → Settings → API → anon public)
SELECT cron.schedule(
  'fintrack-send-notifs',
  '30 6 * * *',
  format(
    $q$SELECT net.http_post(
      url := %L,
      headers := '{"Authorization":"Bearer %s","Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb
    )$q$,
    'https://wkiytjwuztnytygpxooe.supabase.co/functions/v1/ft-send-notifications',
    '<ANON_KEY>'
  )
);
```

---

## Passo 4 — Teste Manual

### Testar processamento imediato

```sql
-- Executa o processamento agora (sem esperar o cron das 06:00)
SELECT public.ft_process_scheduled_transactions();
```

Retorno esperado:
```json
{"families": 2, "inserted": 5, "skipped": 0, "notifications": 3, "errors": 0, "duration_ms": 142}
```

### Verificar o que foi processado

```sql
-- Últimas 10 transações criadas pelo processador automático
SELECT
  t.date,
  t.description,
  t.amount,
  a.name AS conta,
  srl.created_at AS registrado_em
FROM public.transactions t
JOIN public.scheduled_run_logs srl ON srl.transaction_id = t.id
JOIN public.accounts a ON a.id = t.account_id
ORDER BY srl.created_at DESC
LIMIT 10;
```

### Verificar notificações na fila

```sql
SELECT
  snl.channel,
  snl.notification_type,
  snl.recipient,
  snl.status,
  snl.occurrence_date,
  st.description
FROM public.scheduled_notification_logs snl
JOIN public.scheduled_transactions st ON st.id = snl.scheduled_id
ORDER BY snl.created_at DESC
LIMIT 20;
```

### Ver histórico de execuções do cron

```sql
SELECT * FROM public.v_scheduled_audit LIMIT 20;
```

---

## Passo 5 — Configurar no App (opcional)

Na tela de Programados dentro do FinTrack, quando o usuário ativa `Auto-registrar`:
- O checkbox já existe em `scAutoRegister`
- A função `saveScheduled()` salva `auto_register: true` no banco
- O cron do Supabase processa automaticamente sem precisar do app aberto

Para verificar se o processamento automático está funcionando, o usuário pode ver em **Configurações → Telemetria** (ou via SQL acima).

---

## Frequência de Execução — Referência

| Horário (UTC) | Horário Brasília | Job |
|---|---|---|
| 06:00 | 03:00 / 04:00 | Registro das transações do dia |
| 06:30 | 03:30 / 04:30 | Envio de notificações pós-processamento |
| 07:00 | 04:00 / 05:00 | Avisos antecipados (próximos 3 dias) |
| 02:00 dom | 23:00 / 00:00 sáb | Limpeza de logs antigos |

> **Nota de fuso:** Supabase cron usa UTC. Para horário de Brasília (UTC-3), `0 6 * * *` executa às 03:00 BRT no horário de verão e às 03:00 BRT no horário padrão. Ajuste se preferir executar mais tarde (ex: `0 9 * * *` = 06:00 BRT).

---

## Manutenção

### Pausar um job temporariamente

```sql
SELECT cron.unschedule('fintrack-process-scheduled');
```

### Reativar

```sql
SELECT cron.schedule('fintrack-process-scheduled', '0 6 * * *',
  $$ SELECT public.ft_process_scheduled_transactions(); $$);
```

### Ver transações com erro

```sql
SELECT * FROM public.scheduled_cron_log
WHERE errors_count > 0
ORDER BY run_at DESC;
```

### Forçar reprocessamento de uma data específica

```sql
-- 1. Marcar a ocorrência como 'failed' para permitir reprocessamento
UPDATE public.scheduled_occurrences
SET execution_status = 'failed', error_message = 'manual retry'
WHERE scheduled_id = '<uuid-do-programado>'
  AND scheduled_date = '2025-01-15'
  AND execution_status = 'executed';

-- 2. Deletar a transação gerada (se necessário)
-- DELETE FROM public.transactions WHERE id = '<uuid-da-tx>';

-- 3. Rodar processamento
SELECT public.ft_process_scheduled_transactions();
```
