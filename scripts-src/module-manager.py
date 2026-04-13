#!/usr/bin/env python3
"""
Module Manager — checks license before allowing agent spawn.
Called by OpenClaw via bootstrap hook or sessions_spawn wrapper.
Returns JSON: {"allowed": bool, "reason": str, "message": str}

Usage:
  python3 module-manager.py <agent_id>

Exit codes:
  0 = allowed
  1 = blocked
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

CLIENT_ROOT = Path(os.environ.get("CLIENT_ROOT", "/opt/AIWH/client"))
LICENSE_PATH = Path('/opt/AIWH/core/config/license.json')
SUBSCRIPTION_PATH = CLIENT_ROOT / 'config' / 'subscription.json'
EMERGENCY_FLAG = Path('/opt/AIWH/core/control/emergency.flag')

AGENT_MODULES = {
    # Frontend module
    'research':         'frontend',
    'copywriter':       'frontend',
    'video':            'frontend',
    'social':           'frontend',
    'funnel':           'frontend',
    'sales':            'frontend',
    # Backend module
    'cfo':              'backend',
    'crm-manager':      'backend',
    'email-manager':    'backend',
    'calendar-manager': 'backend',
    'systems':          'backend',
    # Lifestyle module
    'coach':            'lifestyle',
    'travel':           'lifestyle',
    'trading':          'lifestyle',
    # System agents — always allowed (no module required)
    'main':             'system',
    'branson':          'system',
    'scheduler':        'system',
    'builder-manager':  'system',
    'security-manager': 'system',
    'ai-council':       'system',
    'ceo':              'system',
    'module-manager':   'system',
    'knowledge-manager':'system',
}


def check(agent_id: str) -> dict:
    # 1. Emergency stop check (flag file — separate from license)
    if EMERGENCY_FLAG.exists():
        reason = EMERGENCY_FLAG.read_text().strip() or 'No reason given'
        return {
            'allowed': False,
            'reason': 'emergency_stop',
            'message': f'SYSTEM HALTED. Reason: {reason}. Contact AIWH support.'
        }

    # 2. Load license (prefer license.json, fall back to subscription.json)
    if LICENSE_PATH.exists():
        lic = json.loads(LICENSE_PATH.read_text())
    elif SUBSCRIPTION_PATH.exists():
        # Legacy format — map to expected fields
        sub = json.loads(SUBSCRIPTION_PATH.read_text())
        lic = {
            'subscription_active': sub.get('status') == 'active',
            'valid_until': sub.get('expires', ''),
            'modules_active': ['frontend', 'backend', 'lifestyle'],  # legacy = all active
        }
    else:
        return {
            'allowed': False,
            'reason': 'no_license',
            'message': 'No license file found. Contact AIWH support.'
        }

    # 3. Subscription active
    if not lic.get('subscription_active', False):
        return {
            'allowed': False,
            'reason': 'subscription_inactive',
            'message': 'Subscription inactive. Contact AIWH to reactivate.'
        }

    # 4. Expiry check — actually enforced
    valid_until = lic.get('valid_until', '')
    if valid_until:
        try:
            expiry = datetime.fromisoformat(valid_until.replace('Z', '+00:00'))
            # Make timezone-aware if naive (assume UTC)
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expiry:
                return {
                    'allowed': False,
                    'reason': 'license_expired',
                    'message': f'License expired {valid_until[:10]}. Contact AIWH to renew.'
                }
        except ValueError:
            pass  # Malformed date — log but don't block

    # 5. Module check
    agent_module = AGENT_MODULES.get(agent_id)

    if agent_module is None:
        return {
            'allowed': False,
            'reason': 'unknown_agent',
            'message': f'Agent "{agent_id}" is not in the module registry.'
        }

    if agent_module == 'system':
        return {'allowed': True, 'reason': 'system_agent'}

    if agent_module not in lic.get('modules_active', []):
        return {
            'allowed': False,
            'reason': 'module_not_licensed',
            'message': (
                f'The {agent_module} module is not active on this device. '
                f'Contact AIWH to upgrade your subscription.'
            )
        }

    return {'allowed': True, 'reason': 'licensed'}


if __name__ == '__main__':
    agent_id = sys.argv[1] if len(sys.argv) > 1 else ''
    if not agent_id:
        print(json.dumps({'allowed': False, 'reason': 'no_agent_id', 'message': 'No agent_id provided.'}))
        sys.exit(1)

    result = check(agent_id)
    print(json.dumps(result))
    sys.exit(0 if result['allowed'] else 1)
