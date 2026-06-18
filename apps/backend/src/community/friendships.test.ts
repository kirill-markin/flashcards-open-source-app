import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("0063 migration creates friend invitations, directed friendships, and narrow helpers", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0063_community_friend_invitations.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.friend_invitations/);
  assert.match(sql, /friend_invitation_id UUID PRIMARY KEY/);
  assert.match(sql, /inviter_user_id TEXT NOT NULL REFERENCES org\.user_settings\(user_id\) ON DELETE CASCADE/);
  assert.match(sql, /invite_token_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /invitee_display_name_for_inviter TEXT NOT NULL/);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /accepted_by_user_id TEXT REFERENCES org\.user_settings\(user_id\) ON DELETE SET NULL/);
  assert.match(sql, /CONSTRAINT friend_invitations_invite_token_hash_format CHECK \( invite_token_hash ~ '\^\[0-9a-f\]\{64\}\$' \)/);
  assert.match(sql, /CONSTRAINT friend_invitations_invitee_display_name_valid CHECK \( char_length\(btrim\(invitee_display_name_for_inviter\)\) BETWEEN 1 AND 30 AND invitee_display_name_for_inviter !~ '\[\[:cntrl:\]\]' \)/);
  assert.match(sql, /CONSTRAINT friend_invitations_expires_after_created CHECK \(expires_at > created_at\)/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS community\.friendships/);
  assert.match(sql, /viewer_user_id TEXT NOT NULL REFERENCES org\.user_settings\(user_id\) ON DELETE CASCADE/);
  assert.match(sql, /friend_user_id TEXT NOT NULL REFERENCES org\.user_settings\(user_id\) ON DELETE CASCADE/);
  assert.match(sql, /friend_public_profile_id UUID NOT NULL REFERENCES community\.public_profiles\(public_profile_id\) ON DELETE CASCADE/);
  assert.match(sql, /created_from_invitation_id UUID NOT NULL/);
  assert.match(sql, /CONSTRAINT friendships_created_from_invitation_fkey FOREIGN KEY \(created_from_invitation_id\) REFERENCES community\.friend_invitations\(friend_invitation_id\) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /PRIMARY KEY \(viewer_user_id, friend_user_id\)/);
  assert.match(sql, /CONSTRAINT friendships_not_self CHECK \(viewer_user_id <> friend_user_id\)/);
  assert.match(sql, /CONSTRAINT friendships_friend_display_name_valid CHECK \( char_length\(btrim\(friend_display_name\)\) BETWEEN 1 AND 30 AND friend_display_name !~ '\[\[:cntrl:\]\]' \)/);

  assert.match(sql, /COMMENT ON TABLE community\.friend_invitations IS/);
  assert.match(sql, /COMMENT ON COLUMN community\.friend_invitations\.invite_token_hash IS/);
  assert.match(sql, /COMMENT ON TABLE community\.friendships IS/);
  assert.match(sql, /COMMENT ON COLUMN community\.friendships\.friend_display_name IS/);
  assert.match(sql, /COMMENT ON FUNCTION community\.preview_friend_invitation\(TEXT\) IS/);
  assert.match(sql, /COMMENT ON FUNCTION community\.accept_friend_invitation\(TEXT, TEXT\) IS/);

  assert.match(sql, /idx_friend_invitations_inviter_accepted_expires ON community\.friend_invitations\(inviter_user_id, accepted_at, expires_at\)/);
  assert.match(sql, /idx_friendships_viewer_public_profile ON community\.friendships\(viewer_user_id, friend_public_profile_id\)/);

  assert.match(sql, /ALTER TABLE community\.friend_invitations ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE community\.friendships ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /GRANT USAGE ON SCHEMA community TO backend_app/);
  assert.match(sql, /GRANT SELECT \([^)]*friend_invitation_id,[^)]*inviter_user_id,[^)]*expires_at,[^)]*accepted_at[^)]*\) ON TABLE community\.friend_invitations TO backend_app/);
  assert.match(sql, /GRANT INSERT \([^)]*friend_invitation_id,[^)]*inviter_user_id,[^)]*invite_token_hash,[^)]*expires_at[^)]*\) ON TABLE community\.friend_invitations TO backend_app/);
  assert.match(sql, /GRANT SELECT \([^)]*viewer_user_id,[^)]*friend_user_id,[^)]*friend_public_profile_id,[^)]*friend_display_name[^)]*\) ON TABLE community\.friendships TO backend_app/);
  assert.equal(/GRANT (INSERT|UPDATE|DELETE)[^;]*ON TABLE community\.friendships TO backend_app/.test(sql), false);

  assert.match(sql, /CREATE POLICY friend_invitations_inviter_pending_select_runtime ON community\.friend_invitations FOR SELECT TO backend_app USING \( inviter_user_id = security\.current_user_id\(\) AND accepted_at IS NULL \)/);
  assert.match(sql, /CREATE POLICY friend_invitations_inviter_insert_runtime ON community\.friend_invitations FOR INSERT TO backend_app WITH CHECK \( inviter_user_id = security\.current_user_id\(\) AND accepted_at IS NULL AND accepted_by_user_id IS NULL \)/);
  assert.match(sql, /CREATE POLICY friendships_viewer_select_runtime ON community\.friendships FOR SELECT TO backend_app USING \(viewer_user_id = security\.current_user_id\(\)\)/);

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.preview_friend_invitation\( p_invite_token_hash TEXT \)/);
  assert.match(sql, /RETURNS TABLE \( invitation_status TEXT, expires_at TIMESTAMPTZ \)/);
  assert.match(sql, /SECURITY DEFINER SET search_path = pg_catalog, public/);
  assert.match(sql, /WHEN active_invitation\.expires_at IS NULL THEN 'inactive'::TEXT ELSE 'active'::TEXT/);
  assert.match(sql, /FROM community\.friend_invitations AS friend_invitations/);
  assert.match(sql, /friend_invitations\.accepted_at IS NULL AND friend_invitations\.expires_at > now\(\)/);
  assert.equal(sql.includes("inviter_user_id AS"), false);

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.accept_friend_invitation\( p_invite_token_hash TEXT, p_inviter_display_name_for_invitee TEXT \)/);
  assert.match(sql, /RETURNS TABLE \( acceptance_status TEXT, inviter_public_profile_id UUID, invitee_public_profile_id UUID \)/);
  assert.match(sql, /v_invitee_user_id := security\.current_user_id\(\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /RETURN QUERY SELECT 'inactive'::TEXT, NULL::UUID, NULL::UUID/);
  assert.match(sql, /RETURN QUERY SELECT 'already_accepted'::TEXT, NULL::UUID, NULL::UUID/);
  assert.match(sql, /RETURN QUERY SELECT 'self'::TEXT, NULL::UUID, NULL::UUID/);
  assert.match(sql, /PERFORM pg_advisory_xact_lock\( hashtextextended\( 'community\.friendships:' \|\| char_length\(LEAST\(v_invitation\.inviter_user_id, v_invitee_user_id\)\)::TEXT/);
  assert.match(sql, /GREATEST\(v_invitation\.inviter_user_id, v_invitee_user_id\), 0::bigint \) \)/);
  assert.match(sql, /RETURN QUERY SELECT 'already_friends'::TEXT, v_inviter_public_profile_id, v_invitee_public_profile_id/);
  assert.match(sql, /INSERT INTO community\.friendships \( viewer_user_id, friend_user_id, friend_public_profile_id, friend_display_name, created_from_invitation_id \) VALUES/);
  assert.match(sql, /UPDATE community\.friend_invitations AS friend_invitations SET accepted_at = now\(\), accepted_by_user_id = v_invitee_user_id/);

  assert.match(sql, /REVOKE ALL ON FUNCTION community\.preview_friend_invitation\(TEXT\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.preview_friend_invitation\(TEXT\) TO backend_app/);
  assert.match(sql, /REVOKE ALL ON FUNCTION community\.accept_friend_invitation\(TEXT, TEXT\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.accept_friend_invitation\(TEXT, TEXT\) TO backend_app/);
});

test("0064 migration exposes only current viewer leaderboard friend labels", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0064_leaderboard_friend_labels.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /CREATE OR REPLACE FUNCTION community\.read_current_user_leaderboard_friend_labels\(\)/);
  assert.match(sql, /RETURNS TABLE \( friend_public_profile_id UUID, friend_display_name TEXT \)/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog, public/);
  assert.match(sql, /FROM community\.friendships AS friendships/);
  assert.match(sql, /INNER JOIN community\.public_profiles AS friend_profiles/);
  assert.match(sql, /friend_profiles\.public_profile_id = friendships\.friend_public_profile_id/);
  assert.match(sql, /friendships\.viewer_user_id = security\.current_user_id\(\)/);
  assert.match(sql, /friend_profiles\.leaderboard_participation_enabled = TRUE/);
  assert.match(sql, /REVOKE ALL ON FUNCTION community\.read_current_user_leaderboard_friend_labels\(\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION community\.read_current_user_leaderboard_friend_labels\(\) TO backend_app/);
  assert.equal(sql.includes("friend_user_id"), false);
  assert.equal(sql.includes("created_from_invitation_id"), false);
  assert.equal(sql.includes("inviter_user_id"), false);
  assert.equal(sql.includes("email"), false);
});

test("0065 migration grants reporting access to community analytics without invite token hashes", () => {
  const migrationPath = resolve(
    process.cwd(),
    "../../db/migrations/0065_reporting_readonly_community_analytics.sql",
  );
  const sql = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ");

  assert.match(sql, /GRANT USAGE ON SCHEMA community TO reporting_readonly/);
  assert.match(sql, /REVOKE SELECT ON ALL TABLES IN SCHEMA community FROM reporting_readonly/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA community REVOKE SELECT ON TABLES FROM reporting_readonly/);

  assert.match(sql, /GRANT SELECT \([^)]*user_id,[^)]*public_profile_id,[^)]*leaderboard_participation_enabled[^)]*\) ON TABLE community\.public_profiles TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*review_event_id,[^)]*metric_version,[^)]*public_profile_id,[^)]*reviewed_by_user_id[^)]*\) ON TABLE community\.public_review_activity_facts TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*snapshot_id,[^)]*metric_version,[^)]*window_key[^)]*\) ON TABLE community\.leaderboard_snapshots TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*snapshot_id,[^)]*public_profile_id,[^)]*qualified_review_count[^)]*\) ON TABLE community\.leaderboard_snapshot_entries TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*friend_invitation_id,[^)]*inviter_user_id,[^)]*accepted_at,[^)]*accepted_by_user_id[^)]*\) ON TABLE community\.friend_invitations TO reporting_readonly/);
  assert.match(sql, /GRANT SELECT \([^)]*viewer_user_id,[^)]*friend_user_id,[^)]*friend_public_profile_id,[^)]*created_from_invitation_id[^)]*\) ON TABLE community\.friendships TO reporting_readonly/);

  assert.match(sql, /CREATE POLICY public_profiles_reporting_readonly_select ON community\.public_profiles FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY public_review_activity_facts_reporting_readonly_select ON community\.public_review_activity_facts FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY leaderboard_snapshots_reporting_readonly_select ON community\.leaderboard_snapshots FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY leaderboard_snapshot_entries_reporting_readonly_select ON community\.leaderboard_snapshot_entries FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY friend_invitations_reporting_readonly_select ON community\.friend_invitations FOR SELECT TO reporting_readonly USING \(true\)/);
  assert.match(sql, /CREATE POLICY friendships_reporting_readonly_select ON community\.friendships FOR SELECT TO reporting_readonly USING \(true\)/);

  assert.equal(sql.includes("invite_token_hash"), false);
  assert.equal(sql.includes("invitee_display_name_for_inviter"), false);
  assert.equal(sql.includes("friend_display_name"), false);
});
