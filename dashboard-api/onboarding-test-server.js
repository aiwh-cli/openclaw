// ─── Onboarding Test Server ─────────────────────────────────
// Standalone server on port 3099 for testing onboarding + login
// Uses /tmp/aiwh-test-client — does NOT touch live data
// Usage: node onboarding-test-server.js

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

// Force isolated test directory BEFORE requiring routes
const TEST_ROOT = '/tmp/aiwh-test-client';
process.env.CLIENT_ROOT = TEST_ROOT;
fs.mkdirSync(path.join(TEST_ROOT, 'config'), { recursive: true });

const app = express();
const PORT = 3099;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Mount onboarding API routes (reads CLIENT_ROOT from env)
const onboardingRoutes = require('./routes/onboarding');
const { isFirstRun } = require('./routes/onboarding');
app.use('/api/onboarding', onboardingRoutes);

// Root redirect BEFORE static — otherwise index.html gets served
app.get('/', (req, res) => {
  if (isFirstRun()) {
    return res.redirect('/onboarding.html');
  }
  res.redirect('/login.html');
});

// Serve static files (after root redirect)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  AIWH Onboarding Test Server             ║`);
  console.log(`  ║  http://localhost:${PORT}                  ║`);
  console.log(`  ║                                          ║`);
  console.log(`  ║  Using: ${TEST_ROOT}`);
  console.log(`  ║  Port 3099 — isolated from live (3001)   ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
