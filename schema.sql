-- Content ROI Tracker — minimal attribution schema (MySQL / MariaDB)
-- Run once: mysql -u USER -p DBNAME < schema.sql   or paste into your client

CREATE TABLE IF NOT EXISTS visits (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  visitor_id   VARCHAR(512) NOT NULL,
  utm_campaign VARCHAR(512) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_visits_visitor_created ON visits (visitor_id, created_at);

CREATE TABLE IF NOT EXISTS leads (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  visitor_id   VARCHAR(512) NOT NULL,
  utm_campaign VARCHAR(512) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_leads_email (email)
);

CREATE TABLE IF NOT EXISTS deals (
  id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id    BIGINT NOT NULL,
  amount     DECIMAL(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_deals_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
);

CREATE INDEX idx_deals_lead ON deals (lead_id);
