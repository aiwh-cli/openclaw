#!/usr/bin/env node
// Reset dashboard password without touching onboarding or other config.
// Usage: node reset-password.js <new-password>

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(process.env.CLIENT_ROOT || '/opt/AIWH/client', 'config', 'auth.json');

const newPassword = process.argv[2];
if (!newPassword || newPassword.length < 8) {
  console.error('Usage: node reset-password.js <new-password>');
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

if (!fs.existsSync(AUTH_FILE)) {
  console.error(`Auth file not found: ${AUTH_FILE}`);
  console.error('Run onboarding first.');
  process.exit(1);
}

const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(newPassword, salt, 64).toString('hex');

auth.passwordHash = hash;
auth.passwordSalt = salt;
auth.passwordChangedAt = new Date().toISOString();

fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
console.log('Password reset successfully. Log in at http://localhost:3001');
