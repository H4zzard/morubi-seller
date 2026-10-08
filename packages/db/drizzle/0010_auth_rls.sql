REVOKE ALL PRIVILEGES ON TABLE "users", "accounts", "sessions", "verifications" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "users", "accounts", "sessions", "verifications" FROM "morubi_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users", "accounts", "sessions", "verifications" TO "morubi_auth";
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "users_auth_backend" ON "users";
--> statement-breakpoint
CREATE POLICY "users_auth_backend" ON "users" FOR ALL TO "morubi_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "accounts_auth_backend" ON "accounts";
--> statement-breakpoint
CREATE POLICY "accounts_auth_backend" ON "accounts" FOR ALL TO "morubi_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_auth_backend" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_auth_backend" ON "sessions" FOR ALL TO "morubi_auth" USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "verifications_auth_backend" ON "verifications";
--> statement-breakpoint
CREATE POLICY "verifications_auth_backend" ON "verifications" FOR ALL TO "morubi_auth" USING (true) WITH CHECK (true);
