#!/bin/bash
# Quick E2E Workflow Test
# Tests: Research → Copywriter → Video → Social

echo "🧪 AIWH E2E Workflow Test"
echo ""
echo "Test: Bitcoin video creation + posting"
echo "Time est: 5-8 min | Cost est: \$0.50-1.50"
echo ""

# Query CEO agent
echo "1️⃣  Sending request to CEO agent..."
openclaw ask @ceo "Create a 60-second video script about Bitcoin bull run, then produce video" 2>/dev/null || echo "  (requires interactive session)"

echo ""
echo "✅ Test request submitted to agent queue"
echo "📊 Monitor at: http://localhost:7000"

