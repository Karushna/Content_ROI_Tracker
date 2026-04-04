-- Content ROI Tracker — minimal attribution schema
-- Run once: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS visits (
  id          BIGSERIAL PRIMARY KEY,
  visitor_id  TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_visitor_created ON visits (visitor_id, created_at);

CREATE TABLE IF NOT EXISTS leads (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  visitor_id      TEXT NOT NULL,
  utm_campaign    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id         BIGSERIAL PRIMARY KEY,
  lead_id    BIGINT NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  amount     NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_lead ON deals (lead_id);
