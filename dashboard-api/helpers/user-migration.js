// ─── Owner Migration (Theme AB.10) ─────────────────────────────
// One-time migration: create owner user from existing single-password auth.json.
// Runs when users table is empty. Preserves existing password hash.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';

function migrateOwnerFromAuth(db) {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0) return; // Already has users

  const AUTH_FILE = path.join(CLIENT_ROOT, 'config', 'auth.json');
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf8');
    const auth = JSON.parse(raw);
    if (!auth.passwordHash || !auth.passwordSalt) return;

    const ownerId = crypto.randomUUID();
    const ownerEmail = auth.ownerEmail || 'owner@local';
    const ownerName = auth.ownerName || 'Owner';

    db.prepare(`
      INSERT INTO users (id, email, display_name, role, departments, command_centres, password_hash, password_salt, status, must_change_password, personal_cc_access)
      VALUES (?, ?, ?, 'owner', '[]', '["business","wealth","life"]', ?, ?, 'active', 0, 1)
    `).run(ownerId, ownerEmail, ownerName, auth.passwordHash, auth.passwordSalt);

    console.log(`  ✅ Owner account migrated from auth.json (${ownerEmail})`);
  } catch {
    // No auth.json or invalid — owner will be created during onboarding
  }
}

module.exports = { migrateOwnerFromAuth };
