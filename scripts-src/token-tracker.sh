#!/bin/bash
# Token Usage Tracker
# Extracts token/cost data from OpenClaw sessions
# Generates reports visible to user

WORKSPACE="/opt/AIWH/IAW"
TOKEN_REPORT="/opt/AIWH/system/logs/token-report.json"
SESSIONS_DIR="$HOME/.openclaw/agents/main/sessions"

generate_token_report() {
  # Parse sessions.json for token counts and costs
  if [ ! -f "$SESSIONS_DIR/sessions.json" ]; then
    echo '{"status":"no-sessions"}' > "$TOKEN_REPORT"
    return
  fi
  
  # Use jq to extract token data
  jq '
    . as $sessions |
    [$sessions[] | 
      {
        session: .label,
        tokens: (.totalTokens // 0),
        cost: (.cost // 0),
        model: .model,
        updated: .updatedAt
      }
    ] |
    {
      sessions: .,
      total_tokens: map(.tokens) | add,
      total_cost: map(.cost) | add,
      session_count: length,
      generated_at: (now | todate)
    }
  ' "$SESSIONS_DIR/sessions.json" > "$TOKEN_REPORT" 2>/dev/null || true
}

# Generate report
generate_token_report

# Print summary to stdout
echo "📊 Token Usage Report:"
if [ -f "$TOKEN_REPORT" ]; then
  jq '.total_tokens, .total_cost, .session_count' "$TOKEN_REPORT" 2>/dev/null | {
    read tokens
    read cost
    read sessions
    echo "  Tokens: $tokens | Cost: \$$cost | Sessions: $sessions"
  }
fi
