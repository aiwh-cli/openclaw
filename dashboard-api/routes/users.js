// ─── User Management Routes (Theme AB.10) ───────────────────
// CRUD for dashboard users. Owner/admin only (RBAC guards in AB.11).
// Creates local user accounts with scrypt-hashed passwords.
// Integrates with team_invites table for Tailscale access flow.

const crypto = require('crypto');
const { logRbacEvent } = require('../helpers/auth');
const { loadDepartments } = require('../openclaw-adapter');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateTempPassword() {
  // 12-char alphanumeric temp password
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

// AC.5-P2-6: Strip HTML tags, allow Unicode letters + common punctuation
function sanitizeDisplayName(name) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.replace(/<[^>]*>/g, '');             // strip HTML tags
  clean = clean.replace(/[^\p{L}\p{N}\s\-'.,]/gu, ''); // keep letters, digits, spaces, hyphens, apostrophes, dots, commas
  clean = clean.trim();
  return clean.slice(0, 60);
}

// AC.5-P2-9: Validate department/CC arrays against actual config
const VALID_CCS = new Set(['business', 'wealth', 'life']);

// AC.3: Shareholder protection — confirmation phrase guards destructive actions
// on protected users. Local-only fallback; central-server email codes are a
// future upgrade. Phrase is case-sensitive and includes the user's own name.
function requiredConfirmPhrase(targetUser, action) {
  const name = (targetUser.display_name || targetUser.email || 'USER').toUpperCase();
  return `CONFIRM ${action.toUpperCase()} ${name}`;
}
function checkProtection(targetUser, action, confirmCode) {
  if (!targetUser.protected) return null; // not protected — proceed
  const required = requiredConfirmPhrase(targetUser, action);
  if (!confirmCode) {
    return { status: 409, body: {
      error: 'This user is protected. Confirmation required.',
      requireConfirmation: true,
      protectedEmail: targetUser.email,
      confirmPhrase: required,
    }};
  }
  if (confirmCode !== required) {
    return { status: 403, body: { error: 'Confirmation phrase did not match. Action refused.' }};
  }
  return null;
}
function validateAccess(departments, commandCentres) {
  const errors = [];
  if (Array.isArray(departments) && departments.length > 0) {
    const deptData = loadDepartments();
    const validDeptIds = new Set((deptData.departments || []).map(d => d.id));
    const invalid = departments.filter(d => !validDeptIds.has(d));
    if (invalid.length > 0) errors.push(`Invalid department(s): ${invalid.join(', ')}`);
  }
  if (Array.isArray(commandCentres) && commandCentres.length > 0) {
    const invalid = commandCentres.filter(c => !VALID_CCS.has(c));
    if (invalid.length > 0) errors.push(`Invalid command centre(s): ${invalid.join(', ')}`);
  }
  return errors;
}

module.exports = (app, deps) => {
  const { db } = deps;

  // ── List all users ─────────────────────────────────────────
  app.get('/api/users', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, email, display_name, role, departments, command_centres, status, must_change_password, personal_cc_access, protected, created_at, updated_at
        FROM users ORDER BY role ASC, display_name ASC
      `).all();
      const users = rows.map(u => ({
        ...u,
        departments: JSON.parse(u.departments || '[]'),
        command_centres: JSON.parse(u.command_centres || '[]'),
        must_change_password: !!u.must_change_password,
        personal_cc_access: !!u.personal_cc_access,
        protected: !!u.protected,
      }));
      res.json({ users });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Get single user ───────────────────────────────────────
  app.get('/api/users/:id', (req, res) => {
    try {
      const user = db.prepare(`
        SELECT id, email, display_name, role, departments, command_centres, status, must_change_password, created_at, updated_at
        FROM users WHERE id = ?
      `).get(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      user.departments = JSON.parse(user.departments || '[]');
      user.command_centres = JSON.parse(user.command_centres || '[]');
      user.must_change_password = !!user.must_change_password;
      res.json({ user });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Create user (invite) ──────────────────────────────────
  app.post('/api/users', async (req, res) => {
    const { email, displayName, role, departments, commandCentres, personalCcAccess } = req.body;

    if (!email || !displayName) return res.status(400).json({ error: 'Email and display name required' });
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return res.status(400).json({ error: 'Invalid email format' });
    const cleanName = sanitizeDisplayName(displayName);
    if (!cleanName) return res.status(400).json({ error: 'Display name contains no valid characters' });
    const accessErrors = validateAccess(departments, commandCentres);
    if (accessErrors.length > 0) return res.status(400).json({ error: accessErrors.join('; ') });
    const validRoles = ['admin', 'team'];
    const userRole = validRoles.includes(role) ? role : 'team';

    // Admin can only create team users, not other admins
    if (req.user?.role === 'admin' && userRole === 'admin') {
      return res.status(403).json({ error: 'Only the owner can create admin accounts' });
    }

    // Check for duplicate email
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

    try {
      const id = crypto.randomUUID();
      const tempPassword = generateTempPassword();
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(tempPassword, salt);

      const depts = JSON.stringify(Array.isArray(departments) ? departments : []);
      const ccs = JSON.stringify(Array.isArray(commandCentres) ? commandCentres : []);

      const pcc = userRole === 'admin' && personalCcAccess ? 1 : 0;
      db.prepare(`
        INSERT INTO users (id, email, display_name, role, departments, command_centres, password_hash, password_salt, status, must_change_password, personal_cc_access)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)
      `).run(id, email, cleanName, userRole, depts, ccs, hash, salt, pcc);

      // Ensure team_invites record exists (links to Tailscale access)
      db.prepare(`
        INSERT INTO team_invites (email, status) VALUES (?, 'pending')
        ON CONFLICT(email) DO UPDATE SET status='pending', revoked_at=NULL
      `).run(email);

      // Auto-send Tailscale invite via central server (AC.2 unified flow)
      let tailscaleInvited = false;
      try {
        const { centralFetch } = require('../helpers/central-server');
        await centralFetch('/invite', { method: 'POST', body: JSON.stringify({ email }) });
        tailscaleInvited = true;
      } catch { /* Central server unreachable — not fatal */ }

      logRbacEvent('user_created', {
        userId: req.user?.userId,
        email: req.user?.email,
        ip: req.ip,
        detail: { targetEmail: email, role: userRole, tailscaleInvited },
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        user: { id, email, displayName: cleanName, role: userRole },
        tempPassword, tailscaleInvited,
        message: `User created. Temporary password: ${tempPassword} — they must change it on first login.`,
      });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Update user ───────────────────────────────────────────
  app.put('/api/users/:id', (req, res) => {
    const { displayName, role, departments, commandCentres, status, personalCcAccess, protected: protectedFlag, confirmCode } = req.body;
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // AC.3: Destructive PUT actions on protected users require typed confirmation.
    // Destructive = suspend, role demotion, department revocation, or removing protection itself.
    const isDestructive = (
      status === 'suspended' ||
      (role && role !== targetUser.role) ||
      (departments !== undefined) ||
      (commandCentres !== undefined) ||
      (protectedFlag === false || protectedFlag === 0)
    );
    if (isDestructive) {
      const action = status === 'suspended' ? 'suspend' : 'modify';
      const check = checkProtection(targetUser, action, confirmCode);
      if (check) return res.status(check.status).json(check.body);
    }

    // Prevent users from modifying their own role/departments/commandCentres
    if (req.user?.userId === req.params.id && (role !== undefined || departments !== undefined || commandCentres !== undefined)) {
      return res.status(403).json({ error: 'Cannot modify your own role or permissions' });
    }

    // Admin can only edit team users, not other admins or owner
    if (req.user?.role === 'admin' && targetUser.role !== 'team') {
      return res.status(403).json({ error: 'You can only manage team members' });
    }

    // Cannot demote or modify the owner via this endpoint
    if (targetUser.role === 'owner' && role && role !== 'owner') {
      return res.status(403).json({ error: 'Cannot change the owner role' });
    }

    // AC.5-P2-9: Validate access arrays before processing
    const accessErrors = validateAccess(departments, commandCentres);
    if (accessErrors.length > 0) return res.status(400).json({ error: accessErrors.join('; ') });

    try {
      const updates = [];
      const params = [];

      if (displayName !== undefined) {
        const cleanName = sanitizeDisplayName(displayName);
        if (!cleanName) return res.status(400).json({ error: 'Display name contains no valid characters' });
        updates.push('display_name = ?'); params.push(cleanName);
      }
      if (role !== undefined && targetUser.role !== 'owner') {
        if (!['admin', 'team'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
        updates.push('role = ?'); params.push(role);
      }
      if (departments !== undefined) {
        updates.push('departments = ?'); params.push(JSON.stringify(Array.isArray(departments) ? departments : []));
      }
      if (commandCentres !== undefined) {
        updates.push('command_centres = ?'); params.push(JSON.stringify(Array.isArray(commandCentres) ? commandCentres : []));
      }
      if (status !== undefined && ['active', 'suspended'].includes(status) && targetUser.role !== 'owner') {
        updates.push('status = ?'); params.push(status);
      }
      if (personalCcAccess !== undefined && req.user?.role === 'owner') {
        updates.push('personal_cc_access = ?'); params.push(personalCcAccess ? 1 : 0);
      }
      // AC.3: Only the owner can mark/unmark protection. Owner cannot protect themselves (already undeletable).
      if (protectedFlag !== undefined && req.user?.role === 'owner' && targetUser.role !== 'owner') {
        updates.push('protected = ?'); params.push(protectedFlag ? 1 : 0);
      }

      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

      updates.push("updated_at = datetime('now')");
      params.push(req.params.id);

      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Kill active sessions when role/departments/status change (forces re-login with new permissions)
      if (status === 'suspended' || role !== undefined || departments !== undefined || commandCentres !== undefined || personalCcAccess !== undefined) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
      }

      logRbacEvent('user_updated', {
        userId: req.user?.userId,
        email: req.user?.email,
        ip: req.ip,
        detail: { targetId: req.params.id, changes: req.body },
      });

      res.json({ ok: true });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Reset password ────────────────────────────────────────
  app.post('/api/users/:id/reset-password', (req, res) => {
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'owner') return res.status(403).json({ error: 'Cannot reset owner password here. Use Settings.' });
    if (req.user?.role === 'admin' && targetUser.role !== 'team') {
      return res.status(403).json({ error: 'You can only reset team member passwords' });
    }

    try {
      const tempPassword = generateTempPassword();
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(tempPassword, salt);

      db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1, status = 'pending', updated_at = datetime('now') WHERE id = ?`).run(hash, salt, req.params.id);

      logRbacEvent('password_reset', {
        userId: req.user?.userId,
        email: req.user?.email,
        ip: req.ip,
        detail: { targetId: req.params.id, targetEmail: targetUser.email },
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, tempPassword, message: `Password reset. New temp password: ${tempPassword}` });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Delete user (owner only) ───────────────────────────────
  app.delete('/api/users/:id', async (req, res) => {
    if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete user accounts' });
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.role === 'owner') return res.status(403).json({ error: 'Cannot delete the owner account' });

    // AC.3: Protected users require typed confirmation to delete
    const check = checkProtection(targetUser, 'delete', req.body?.confirmCode || req.query?.confirmCode);
    if (check) return res.status(check.status).json(check.body);

    try {
      db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

      // Auto-revoke Tailscale access for the deleted user
      let tailscaleRevoked = false;
      try {
        const { centralFetch } = require('../helpers/central-server');
        const rRes = await centralFetch(`/revoke?email=${encodeURIComponent(targetUser.email)}`, { method: 'DELETE' });
        if (rRes.ok) tailscaleRevoked = true;
        db.prepare("UPDATE team_invites SET status='revoked', revoked_at=datetime('now') WHERE email=?").run(targetUser.email);
      } catch { /* Central server unreachable — not fatal */ }

      logRbacEvent('user_deleted', {
        userId: req.user?.userId,
        email: req.user?.email,
        ip: req.ip,
        detail: { targetId: req.params.id, targetEmail: targetUser.email, tailscaleRevoked },
      });

      res.json({ ok: true, tailscaleRevoked });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Update owner profile (email, name) ────────────────────
  app.put('/api/users/owner/profile', (req, res) => {
    const { email, displayName } = req.body;
    if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });

    const owner = db.prepare("SELECT * FROM users WHERE role = 'owner'").get();
    if (!owner) return res.status(404).json({ error: 'Owner account not found' });

    try {
      const updates = [];
      const params = [];
      if (email) {
        if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return res.status(400).json({ error: 'Invalid email' });
        updates.push('email = ?'); params.push(email);
      }
      if (displayName) {
        const cleanName = sanitizeDisplayName(displayName);
        if (!cleanName) return res.status(400).json({ error: 'Display name contains no valid characters' });
        updates.push('display_name = ?'); params.push(cleanName);
      }
      if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

      updates.push("updated_at = datetime('now')");
      params.push(owner.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Update auth.json with new email
      if (email) {
        try {
          const fs = require('fs');
          const path = require('path');
          const AUTH_FILE = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'auth.json');
          const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
          auth.ownerEmail = email;
          if (displayName) auth.ownerName = displayName;
          fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
        } catch {}
      }

      logRbacEvent('owner_profile_updated', { userId: owner.id, email: email || owner.email, ip: req.ip });
      res.json({ ok: true });
    } catch (e) {
      console.error('[users]', e.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};
