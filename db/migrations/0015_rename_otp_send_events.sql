-- Rename shared OTP send limiter storage to neutral names.

ALTER TABLE IF EXISTS auth.agent_otp_send_events
  RENAME TO otp_send_events;

ALTER INDEX IF EXISTS auth.idx_agent_otp_send_events_email_created
  RENAME TO idx_otp_send_events_email_created;

ALTER INDEX IF EXISTS auth.idx_agent_otp_send_events_ip_created
  RENAME TO idx_otp_send_events_ip_created;
