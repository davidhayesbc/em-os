-- t_e9515b7b: structured ticket data schema + ingestion (ranking eligibility inputs).
-- Adds optional structured ticket metadata to source_items and links/tracking to commitments.
ALTER TABLE source_items ADD COLUMN ticket_data TEXT CHECK (ticket_data IS NULL OR (json_valid(ticket_data) AND json_type(ticket_data) = 'object'));
ALTER TABLE commitments ADD COLUMN ticket_id TEXT;
ALTER TABLE commitments ADD COLUMN pin_provenance TEXT CHECK (pin_provenance IN ('user', 'system')) CHECK (pin_provenance IS NULL OR pinned = 1);
