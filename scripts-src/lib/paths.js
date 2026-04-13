// paths.js — Centralized path configuration for AIWH
// All dashboard routes and scripts should import from here instead of hardcoding.
const path = require('path');

const AIWH_ROOT = '/opt/AIWH';
const CLIENT_ROOT = process.env.CLIENT_ROOT || path.join(AIWH_ROOT, 'client');
const CORE_ROOT = path.join(AIWH_ROOT, 'core');
const OC_STATE = process.env.OPENCLAW_STATE_DIR || path.join(AIWH_ROOT, '.openclaw');

module.exports = {
  AIWH_ROOT,
  CLIENT_ROOT,
  CORE_ROOT,
  OC_STATE,

  // Client data paths
  KNOWLEDGE_DB: path.join(CLIENT_ROOT, 'data', 'client_knowledge.db'),
  VIDEO_DB: path.join(CLIENT_ROOT, 'data', 'video-jobs.db'),
  BASE_KNOWLEDGE_DB: path.join(CLIENT_ROOT, 'data', 'base_knowledge_cache.db'),
  UPLOAD_DIR: path.join(CLIENT_ROOT, 'uploads'),
  CLIENT_LOGS: path.join(CLIENT_ROOT, 'logs'),
  CLIENT_CONFIG: path.join(CLIENT_ROOT, 'config'),
  CLIENT_DATA: path.join(CLIENT_ROOT, 'data'),
  CLIENT_SCRIPTS: path.join(CLIENT_ROOT, 'scripts'),

  // Core paths
  DASHBOARD_DIR: path.join(CORE_ROOT, 'dashboard'),
  MISSION_CONTROL_DB: path.join(CORE_ROOT, 'dashboard', 'mission-control.db'),
  DASHBOARD_DB: path.join(CORE_ROOT, 'dashboard', 'dashboard.db'),
  SCRIPTS_DIR: path.join(CORE_ROOT, 'scripts'),
  MIGRATIONS_DIR: path.join(CORE_ROOT, 'migrations'),
  BACKUPS_DIR: path.join(CORE_ROOT, '.backups'),

  // Tool paths (macOS — override via env for Docker)
  PYTHON: process.env.PYTHON_BIN || '/opt/homebrew/bin/python3',
  OPENCLAW_BIN: process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw',
  INGEST_SCRIPT: path.join(CORE_ROOT, 'scripts', 'ingest-document.py'),

  // OpenClaw state
  OC_CONFIG: path.join(OC_STATE, 'openclaw.json'),
  OC_ENV: path.join(OC_STATE, '.env'),
};
