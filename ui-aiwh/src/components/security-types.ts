// Shared types for security-panel and sub-components

export type PolicyData = {
  policy: {
    locked_files: Array<{ path: string; comment: string }>;
    locked_directories: Array<{ path: string; comment: string }>;
    directory_rules: Array<{ path: string; allow: string[]; deny: string[]; comment: string }>;
  };
  guardAvailable: boolean;
};

export type AuditEntry = {
  timestamp: string;
  agent_id: string;
  action: string;
  target_path: string;
  outcome: string;
  detail: string;
};

export type AuditData = {
  entries: AuditEntry[];
  stats: { total: number; today: { allowed: number; redirected: number; blocked: number; policy: number } };
};

export type TrashItem = {
  name: string;
  date: string;
  path: string;
  size: number;
  originPath: string;
  expiresAt: string;
  expired: boolean;
};

export type TrashData = { items: TrashItem[]; totalSize: number };
