/**
 * Agent utility functions for the AIWH chat UI.
 * Slimmed from openclaw/ui/src/ui/views/agents-utils.ts (705 lines).
 * Only agentLogoUrl and resolveAgentAvatarUrl are needed by the chat.
 * Original deep dep (tool-policy-shared → tool-catalog) removed.
 */

type AgentIdentityResult = {
  agentId: string;
  name: string;
  avatar: string;
  emoji?: string;
};

const AVATAR_URL_RE = /^(https?:\/\/|data:image\/|\/)/i;

export function resolveAgentAvatarUrl(
  agent: { identity?: { avatar?: string; avatarUrl?: string } },
  agentIdentity?: AgentIdentityResult | null,
): string | null {
  const candidates = [
    agentIdentity?.avatar?.trim(),
    agent.identity?.avatarUrl?.trim(),
    agent.identity?.avatar?.trim(),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (AVATAR_URL_RE.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function agentLogoUrl(basePath: string): string {
  const base = basePath?.trim() ? basePath.replace(/\/$/, "") : "";
  return base ? `${base}/favicon.svg` : "favicon.svg";
}
