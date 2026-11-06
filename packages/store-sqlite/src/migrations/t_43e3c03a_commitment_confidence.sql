-- t_43e3c03a_commitment_confidence: add optional bounded confidence to commitments.
ALTER TABLE commitments
ADD COLUMN confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
