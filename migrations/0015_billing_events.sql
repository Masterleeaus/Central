-- Subscription lifecycle ledger (issue #35). Applied after 0009. Migration numbers 0010-0014 are not used.
-- Why a table is needed: provisioning_audit is keyed by request id and only records applied commands, so it
-- cannot store an ignored or rejected event. Nothing else stores the last applied position per subscription,
-- so without these tables the out-of-order rule cannot be enforced and replays cannot be recognised.
-- Card data and provider credentials are never stored here: only provider ids, states and dates.
BEGIN;

CREATE TABLE IF NOT EXISTS titan.billing_subscriptions (
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
  subscription_id text NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  organisation_id uuid NOT NULL REFERENCES titan.organisations(id),
  state text NOT NULL CHECK (state IN ('trial','active','grace','cancelled','refunded','expired')),
  position_at timestamptz NOT NULL,
  position_event_id text NOT NULL CHECK (length(position_event_id) BETWEEN 1 AND 256),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subscription_id)
);

CREATE TABLE IF NOT EXISTS titan.billing_events (
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 64),
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 256),
  subscription_id text NOT NULL CHECK (length(subscription_id) BETWEEN 1 AND 256),
  occurred_at timestamptz NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('pending','applied','ignored_out_of_order','rejected_transition','rejected_invalid','rejected_organisation')),
  reason text,
  request_ids uuid[] NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS billing_events_subscription_idx ON titan.billing_events (provider, subscription_id, occurred_at DESC);

-- Written only by the trusted writer, which runs every ledger statement inside SET LOCAL ROLE.
-- Nothing is granted to the login role or to the trusted reader.
GRANT SELECT, INSERT, UPDATE ON titan.billing_subscriptions TO titan_trusted_writer;
GRANT SELECT, INSERT, UPDATE ON titan.billing_events TO titan_trusted_writer;
COMMIT;
