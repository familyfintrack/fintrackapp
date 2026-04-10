-- ════════════════════════════════════════════════════════════════════════
-- tx_reimbursements — Vínculos de reembolso entre transações
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tx_reimbursements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- A transação/programado que originou o reembolso (despesa)
  origin_tx_id         uuid REFERENCES transactions(id) ON DELETE SET NULL,
  origin_sc_id         uuid REFERENCES scheduled_transactions(id) ON DELETE SET NULL,
  -- A transação que representa o recebimento do reembolso (receita)
  reimbursement_tx_id  uuid REFERENCES transactions(id) ON DELETE SET NULL,
  -- Metadados
  status               text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','linked','cancelled')),
  note                 text,
  expected_amount      numeric(15,2),
  expected_date        date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_origin CHECK (origin_tx_id IS NOT NULL OR origin_sc_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_txr_family ON tx_reimbursements(family_id, status);
CREATE INDEX IF NOT EXISTS idx_txr_origin_tx ON tx_reimbursements(origin_tx_id);
CREATE INDEX IF NOT EXISTS idx_txr_origin_sc ON tx_reimbursements(origin_sc_id);
CREATE INDEX IF NOT EXISTS idx_txr_reimbursement ON tx_reimbursements(reimbursement_tx_id);

ALTER TABLE tx_reimbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family members select reimbursements"
  ON tx_reimbursements FOR SELECT
  USING (family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));

CREATE POLICY "family members insert reimbursements"
  ON tx_reimbursements FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));

CREATE POLICY "family members update reimbursements"
  ON tx_reimbursements FOR UPDATE
  USING (family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));

CREATE POLICY "family members delete reimbursements"
  ON tx_reimbursements FOR DELETE
  USING (family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid()));
