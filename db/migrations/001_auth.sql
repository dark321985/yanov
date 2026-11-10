CREATE TABLE owner_account (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE owner_sessions (
  token_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owner_account(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX owner_sessions_expiry ON owner_sessions(expires_at);
CREATE TABLE auth_throttle (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
