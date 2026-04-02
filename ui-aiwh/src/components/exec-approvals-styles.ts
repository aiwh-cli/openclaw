import { css } from "lit";

export const execApprovalsStyles = css`
  :host {
    display: block;
    color: var(--text-primary, #f5edd6);
    font-family:
      "Inter",
      -apple-system,
      sans-serif;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    margin-bottom: 20px;
    background: var(--surface, rgba(14, 14, 18, 0.65));
    border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
    border-radius: 6px;
    backdrop-filter: blur(20px);
  }
  .header svg {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    color: var(--success, #4caf7a);
  }
  .header h3 {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--success, #4caf7a);
    margin: 0 0 4px;
  }
  .header p {
    font-size: 12px;
    color: var(--text-muted, #8a8578);
    margin: 0;
  }

  .policy-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 20px;
  }
  .policy-item label {
    display: block;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-muted, #8a8578);
    margin-bottom: 4px;
    font-family: "JetBrains Mono", monospace;
  }
  .form-select {
    width: 100%;
    padding: 8px 12px;
    background: var(--surface-hi, rgba(20, 20, 24, 0.8));
    border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
    border-radius: 4px;
    color: var(--text-primary, #f5edd6);
    font-size: 12px;
    font-family: "JetBrains Mono", monospace;
  }

  .section-title {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--accent, #c9a84c);
    margin: 0 0 12px;
  }

  /* ─── Tier sections ─────────────────────────── */
  .tier-section {
    margin-bottom: 16px;
    border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
    border-radius: 6px;
    overflow: hidden;
    background: var(--surface, rgba(14, 14, 18, 0.65));
  }
  .tier-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    cursor: pointer;
    transition: background 200ms;
  }
  .tier-header:hover {
    background: rgba(201, 168, 76, 0.04);
  }
  .tier-chevron {
    font-size: 12px;
    color: var(--text-muted, #8a8578);
    width: 12px;
  }
  .tier-label {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 600;
  }
  .tier-label.tier-1 {
    background: rgba(201, 168, 76, 0.12);
    color: var(--accent, #c9a84c);
    border: 1px solid rgba(201, 168, 76, 0.2);
  }
  .tier-label.tier-base {
    background: rgba(76, 175, 122, 0.1);
    color: var(--success, #4caf7a);
    border: 1px solid rgba(76, 175, 122, 0.18);
  }
  .tier-title {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--text-primary, #f5edd6);
  }
  .tier-desc {
    padding: 0 16px 12px 38px;
    font-size: 11px;
    color: var(--text-muted, #8a8578);
  }

  /* ─── Agent rows ────────────────────────────── */
  .agent-row {
    border-top: 1px solid var(--border-faint, rgba(201, 168, 76, 0.04));
  }
  .agent-row-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px 10px 38px;
    cursor: pointer;
    transition: background 200ms;
  }
  .agent-row-header:hover {
    background: rgba(201, 168, 76, 0.03);
  }
  .agent-chevron {
    font-size: 11px;
    color: var(--text-muted, #8a8578);
    width: 12px;
  }
  .agent-name {
    font-size: 12px;
    flex: 1;
    min-width: 0;
  }
  .agent-count {
    font-size: 11px;
    color: var(--text-muted, #8a8578);
  }
  .agent-add-btn {
    margin-left: 8px;
    flex-shrink: 0;
  }
  .b-count {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    background: rgba(76, 175, 122, 0.1);
    color: var(--success, #4caf7a);
    border: 1px solid rgba(76, 175, 122, 0.18);
  }
  .b-base {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    color: var(--text-muted, #8a8578);
    letter-spacing: 0.5px;
  }
  .agent-row.expanded {
    background: rgba(201, 168, 76, 0.02);
  }
  .empty-sm {
    padding: 8px 16px 12px 60px;
    font-size: 11px;
    color: var(--text-muted, #8a8578);
  }

  /* ─── Pattern table ─────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 8px;
  }
  th {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-muted, #8a8578);
    text-align: left;
    padding: 8px 16px 8px 60px;
    font-weight: 500;
    border-bottom: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
  }
  td {
    padding: 8px 16px 8px 60px;
    font-size: 12px;
    border-bottom: 1px solid var(--border-faint, rgba(201, 168, 76, 0.04));
  }
  td:nth-child(2),
  td:nth-child(3) {
    padding-left: 12px;
  }
  th:nth-child(2),
  th:nth-child(3) {
    padding-left: 12px;
  }
  tr:hover td {
    background: rgba(201, 168, 76, 0.03);
  }
  code {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--accent, #c9a84c);
    opacity: 0.85;
  }

  /* ─── Buttons & inputs ──────────────────────── */
  .btn {
    padding: 6px 16px;
    background: none;
    border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
    color: var(--accent, #c9a84c);
    border-radius: 3px;
    cursor: pointer;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    transition: all 200ms;
  }
  .btn:hover {
    border-color: var(--accent, #c9a84c);
    background: rgba(201, 168, 76, 0.08);
  }
  .btn-success {
    border-color: var(--success, #4caf7a);
    color: var(--success, #4caf7a);
  }
  .btn-success:hover {
    background: rgba(76, 175, 122, 0.1);
  }
  .btn-danger {
    border-color: var(--critical, #e05252);
    color: var(--critical, #e05252);
  }
  .btn-danger:hover {
    background: rgba(224, 82, 82, 0.1);
  }
  .btn-sm {
    padding: 2px 10px;
    font-size: 9px;
  }

  .add-row {
    display: flex;
    gap: 8px;
    margin: 4px 16px 12px 60px;
    align-items: center;
  }
  .form-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--surface-hi, rgba(20, 20, 24, 0.8));
    border: 1px solid var(--border-dim, rgba(201, 168, 76, 0.12));
    border-radius: 4px;
    color: var(--text-primary, #f5edd6);
    font-size: 12px;
    font-family: "JetBrains Mono", monospace;
  }
  .form-input:focus {
    outline: none;
    border-color: var(--accent, #c9a84c);
  }
  .form-input::placeholder {
    color: rgba(138, 133, 120, 0.5);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .toggle-switch {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    cursor: pointer;
    background: var(--border-dim, rgba(201, 168, 76, 0.12));
    position: relative;
    transition: background 200ms;
  }
  .toggle-switch[active] {
    background: var(--success, #4caf7a);
  }
  .toggle-switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-primary, #f5edd6);
    transition: left 200ms;
  }
  .toggle-switch[active]::after {
    left: 18px;
  }
  .toggle-label {
    font-size: 12px;
    color: var(--text-muted, #8a8578);
  }

  .empty {
    text-align: center;
    padding: 48px 20px;
    color: rgba(74, 71, 64, 1);
    font-size: 13px;
  }
  .error {
    padding: 12px 16px;
    background: rgba(224, 82, 82, 0.08);
    border: 1px solid rgba(224, 82, 82, 0.2);
    border-radius: 4px;
    color: var(--critical, #e05252);
    font-size: 12px;
    margin-bottom: 16px;
  }

  @media (max-width: 768px) {
    .policy-grid {
      grid-template-columns: 1fr;
    }
  }
`;
