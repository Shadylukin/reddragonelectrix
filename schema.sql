-- Enquiry storage.
--
-- The single most important property of this table: a row is written BEFORE
-- any model call and BEFORE any email attempt. The old site's contact form
-- died in April 2024 and nobody noticed for 28 months because the only record
-- of an enquiry was the email. If the notification path breaks here, the
-- enquiry still exists and can be recovered.

CREATE TABLE IF NOT EXISTS enquiries (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,

  -- what the customer actually submitted
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  suburb        TEXT,
  job_type      TEXT,          -- ev | residential | commercial | other
  message       TEXT,
  photo_count   INTEGER DEFAULT 0,

  -- EV-specific qualification (the 80% case)
  ev_vehicle    TEXT,
  ev_charger    TEXT,
  ev_distance   TEXT,          -- board -> parking spot
  ev_property   TEXT,          -- standalone | terrace | apartment | body corporate

  -- what the model made of it. NULL is a valid, expected state: if the model
  -- call fails the enquiry is still complete and still gets sent.
  ai_summary    TEXT,
  ai_priority   TEXT,          -- urgent | standard | info
  ai_status     TEXT NOT NULL DEFAULT 'pending',  -- pending | ok | failed | skipped

  -- delivery
  notified_at   TEXT,
  notify_status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed

  user_agent    TEXT,
  source_page   TEXT
);

CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_notify  ON enquiries (notify_status);

-- Heartbeat: lets a monitor ask "have we had ANY enquiry in the last 30 days?"
-- Zero enquiries for a month is exactly the signal that went unnoticed for two
-- years last time.
CREATE VIEW IF NOT EXISTS enquiry_health AS
SELECT
  COUNT(*)                                              AS total,
  MAX(created_at)                                       AS last_enquiry_at,
  SUM(CASE WHEN notify_status = 'failed' THEN 1 ELSE 0 END) AS failed_notifications
FROM enquiries;

-- Added Aug 2026: consent to text back. The old form never even asked for a
-- phone number, let alone permission to use it.
ALTER TABLE enquiries ADD COLUMN ok_to_text INTEGER DEFAULT 0;

-- Added Aug 2026: the suggested reply Nick can copy, change and send himself.
-- Stored as well as emailed so it survives a lost or spam-foldered notification.
ALTER TABLE enquiries ADD COLUMN ai_draft TEXT;
