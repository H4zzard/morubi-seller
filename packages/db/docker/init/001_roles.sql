DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morubi_app') THEN
    CREATE ROLE morubi_app LOGIN PASSWORD 'morubi_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morubi_auth') THEN
    CREATE ROLE morubi_auth LOGIN PASSWORD 'morubi_auth' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morubi_worker') THEN
    CREATE ROLE morubi_worker LOGIN PASSWORD 'morubi_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO morubi_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO morubi_auth', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO morubi_worker', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO morubi_app;
GRANT USAGE ON SCHEMA public TO morubi_auth;
GRANT USAGE ON SCHEMA public TO morubi_worker;
