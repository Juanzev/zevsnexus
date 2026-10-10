// Extensões e funções genéricas (pág. 07 — ordem-base das migrations).
// - f_unaccent: wrapper IMMUTABLE do unaccent, usável em colunas geradas e índices de busca.
// - set_updated_at: trigger que mantém updated_at.
// - prevent_mutation: trigger que torna uma tabela append-only (auditoria).

export const up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;

    CREATE FUNCTION f_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

    CREATE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $$;

    CREATE FUNCTION prevent_mutation() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'tabela append-only: % não é permitido em %', TG_OP, TG_TABLE_NAME
          USING ERRCODE = 'restrict_violation';
      END;
      $$;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS prevent_mutation();
    DROP FUNCTION IF EXISTS set_updated_at();
    DROP FUNCTION IF EXISTS f_unaccent(text);
    DROP EXTENSION IF EXISTS unaccent;
    DROP EXTENSION IF EXISTS pg_trgm;
    DROP EXTENSION IF EXISTS citext;
    DROP EXTENSION IF EXISTS pgcrypto;
  `);
};
