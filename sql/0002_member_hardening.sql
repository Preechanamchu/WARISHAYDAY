-- WARISHAYDAY Member hardening migration 0002
-- Enforce globally unique Hay Day Player Tags and useful lookup indexes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_tags_tag_ci ON customer_tags(UPPER(TRIM(tag)));
CREATE INDEX IF NOT EXISTS idx_orders_member_id ON orders(member_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_tag ON orders(customer_tag);
CREATE INDEX IF NOT EXISTS idx_credit_deposits_member_status ON credit_deposits(member_id, status);
CREATE INDEX IF NOT EXISTS idx_member_activities_member_created ON member_activities(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_member_created ON wallet_transactions(member_id, created_at DESC);
