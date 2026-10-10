// Plataforma (pág. 13): Platform Admin, planos, features, assinatura e override por empresa.
// Features ativas = features do plano − desligadas + ligadas para a empresa.

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE platform_admins (
      user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE features (
      code text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
      name text NOT NULL,
      description text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE plans (
      code text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
      name text NOT NULL,
      max_users integer NOT NULL CHECK (max_users > 0),
      storage_quota_bytes bigint NOT NULL CHECK (storage_quota_bytes >= 0),
      max_file_size_bytes bigint NOT NULL CHECK (max_file_size_bytes > 0),
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX plans_single_default_key ON plans (is_default) WHERE is_default;
    CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON plans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE plan_features (
      plan_code text NOT NULL REFERENCES plans (code) ON DELETE CASCADE,
      feature_code text NOT NULL REFERENCES features (code) ON DELETE CASCADE,
      PRIMARY KEY (plan_code, feature_code)
    );

    CREATE TABLE subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL UNIQUE REFERENCES companies (id) ON DELETE CASCADE,
      plan_code text NOT NULL REFERENCES plans (code),
      status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
      trial_ends_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE company_features (
      company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
      feature_code text NOT NULL REFERENCES features (code) ON DELETE CASCADE,
      enabled boolean NOT NULL,
      created_by uuid REFERENCES users (id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, feature_code)
    );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS company_features;
    DROP TABLE IF EXISTS subscriptions;
    DROP TABLE IF EXISTS plan_features;
    DROP TABLE IF EXISTS plans;
    DROP TABLE IF EXISTS features;
    DROP TABLE IF EXISTS platform_admins;
  `);
};
