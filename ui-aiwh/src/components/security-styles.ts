import { css } from 'lit';

export const securityStyles = css`
  :host {
    display: block;
    color: var(--text-primary, #F5EDD6);
    font-family: 'Inter', -apple-system, sans-serif;
  }

  /* ── Shield ──────────────────── */
  .shield {
    display: flex; align-items: center; gap: 16px;
    padding: 20px; margin-bottom: 20px;
    background: var(--surface, rgba(14,14,18,0.65));
    border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
    border-radius: 6px;
    backdrop-filter: blur(20px);
  }
  .shield svg { width: 44px; height: 44px; flex-shrink: 0; }
  .shield.active svg { color: var(--success, #4CAF7A); filter: drop-shadow(0 0 10px rgba(76,175,122,0.4)); }
  .shield.pending svg { color: var(--amber, #F0C040); filter: drop-shadow(0 0 10px rgba(240,192,64,0.3)); }
  .shield-text h3 {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px; letter-spacing: 2px; text-transform: uppercase;
    margin: 0 0 4px;
  }
  .shield.active h3 { color: var(--success, #4CAF7A); }
  .shield.pending h3 { color: var(--amber, #F0C040); }
  .shield-text p { font-size: 12px; color: var(--text-muted, #8A8578); margin: 0; }

  /* ── Metrics ─────────────────── */
  .metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
  .m-card {
    background: var(--surface, rgba(14,14,18,0.65));
    border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
    border-radius: 4px;
    padding: 18px 16px;
    text-align: center;
    position: relative;
    backdrop-filter: blur(12px);
  }
  .m-card::after {
    content: ''; position: absolute; top: 0; left: 0; right: 0;
    height: 2px; background: var(--accent, #C9A84C); opacity: 0.25;
  }
  .m-val {
    font-family: 'JetBrains Mono', monospace;
    font-size: 28px; font-weight: 600; line-height: 1; margin-bottom: 6px;
  }
  .m-lbl {
    font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted, #8A8578);
  }

  /* ── Event Bar ────────────────── */
  .events {
    display: flex; gap: 24px; padding: 10px 16px;
    background: var(--surface, rgba(14,14,18,0.65));
    border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
    border-radius: 4px; margin-bottom: 24px; font-size: 12px;
  }
  .ev { display: flex; align-items: center; gap: 6px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot-g { background: var(--success, #4CAF7A); box-shadow: 0 0 6px rgba(76,175,122,0.5); }
  .dot-o { background: var(--amber, #F0C040); box-shadow: 0 0 6px rgba(240,192,64,0.4); }
  .dot-r { background: var(--critical, #E05252); box-shadow: 0 0 6px rgba(224,82,82,0.5); }
  .dot-c { background: var(--cyan, #A0845C); }

  /* ── Tabs ─────────────────────── */
  .tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border-dim, rgba(201,168,76,0.12));
    margin-bottom: 20px;
  }
  .tab {
    padding: 10px 24px; background: none; border: none;
    border-bottom: 2px solid transparent;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--text-muted, #8A8578); cursor: pointer;
    transition: all 200ms cubic-bezier(0.4,0,0.2,1);
  }
  .tab:hover { color: var(--accent, #C9A84C); }
  .tab[active] { color: var(--accent, #C9A84C); border-bottom-color: var(--accent, #C9A84C); }

  /* ── Table ────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  th {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
    color: var(--text-muted, #8A8578); text-align: left; padding: 10px 12px;
    border-bottom: 1px solid var(--border-dim, rgba(201,168,76,0.12)); font-weight: 500;
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-faint, rgba(201,168,76,0.04));
    font-size: 12px;
  }
  tr:hover td { background: rgba(var(--accent-rgb, 201,168,76), 0.03); }
  code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; color: var(--accent, #C9A84C); opacity: 0.85;
  }

  /* ── Badges ───────────────────── */
  .b {
    display: inline-block; padding: 2px 8px; border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
    font-weight: 500; margin: 1px 2px;
  }
  .b-lock { background: rgba(var(--critical-rgb, 224,82,82), 0.08); color: var(--critical, #E05252); border: 1px solid rgba(var(--critical-rgb, 224,82,82), 0.15); }
  .b-allow { background: rgba(var(--success-rgb, 76,175,122), 0.10); color: var(--success, #4CAF7A); border: 1px solid rgba(var(--success-rgb, 76,175,122), 0.18); }
  .b-deny { background: rgba(var(--critical-rgb, 224,82,82), 0.10); color: var(--critical, #E05252); border: 1px solid rgba(var(--critical-rgb, 224,82,82), 0.18); }
  .b-out {
    display: inline-block; padding: 3px 10px; border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
  }
  .b-out-g { background: rgba(var(--success-rgb, 76,175,122), 0.12); color: var(--success, #4CAF7A); }
  .b-out-o { background: rgba(var(--amber-rgb, 240,192,64), 0.12); color: var(--amber, #F0C040); }
  .b-out-r { background: rgba(var(--critical-rgb, 224,82,82), 0.12); color: var(--critical, #E05252); }
  .b-out-c { background: rgba(var(--cyan-rgb, 160,132,92), 0.12); color: var(--cyan, #A0845C); }

  /* ── Buttons ──────────────────── */
  .btn {
    padding: 6px 16px; background: none;
    border: 1px solid var(--border-dim, rgba(201,168,76,0.12));
    color: var(--accent, #C9A84C); border-radius: 3px; cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    transition: all 200ms;
  }
  .btn:hover { border-color: var(--accent, #C9A84C); background: var(--magenta-dim, rgba(201,168,76,0.08)); }
  .btn-success { border-color: var(--success, #4CAF7A); color: var(--success, #4CAF7A); }
  .btn-success:hover { background: rgba(var(--success-rgb, 76,175,122), 0.10); }

  /* ── Add Rule Form ───────────── */
  .add-form {
    background: var(--surface, rgba(14,14,18,0.65));
    border: 1px solid var(--border-dim);
    border-radius: 6px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .add-form h4 {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
    color: var(--accent); margin: 0 0 16px;
  }
  .form-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: center; }
  .form-input {
    flex: 1; padding: 8px 12px;
    background: var(--surface-hi, rgba(20,20,24,0.80));
    border: 1px solid var(--border-dim);
    border-radius: 4px;
    color: var(--text-primary); font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
  }
  .form-input:focus { outline: none; border-color: var(--accent); }
  .form-input::placeholder { color: var(--text-dim); }
  .form-select {
    padding: 8px 12px;
    background: var(--surface-hi, rgba(20,20,24,0.80));
    border: 1px solid var(--border-dim);
    border-radius: 4px;
    color: var(--text-primary); font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
  }

  /* ── Toggle badges ─────────── */
  .toggles { display: flex; gap: 6px; flex-wrap: wrap; }
  .toggle {
    padding: 4px 12px; border-radius: 3px; cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase;
    font-weight: 500; border: 1px solid; transition: all 150ms;
    user-select: none;
  }
  .toggle.allow-on { background: rgba(var(--success-rgb, 76,175,122), 0.15); color: var(--success, #4CAF7A); border-color: rgba(var(--success-rgb, 76,175,122), 0.3); }
  .toggle.allow-off { background: transparent; color: var(--text-dim, #4A4740); border-color: var(--border-dim, rgba(201,168,76,0.12)); opacity: 0.5; }
  .toggle.deny-on { background: rgba(var(--critical-rgb, 224,82,82), 0.15); color: var(--critical, #E05252); border-color: rgba(var(--critical-rgb, 224,82,82), 0.3); }
  .toggle.deny-off { background: transparent; color: var(--text-dim, #4A4740); border-color: var(--border-dim, rgba(201,168,76,0.12)); opacity: 0.5; }
  .toggle:hover { opacity: 1 !important; }
  .toggles-label {
    font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--text-muted); margin-bottom: 6px;
    font-family: 'JetBrains Mono', monospace;
  }

  .empty { text-align: center; padding: 48px 20px; color: var(--text-dim, #4A4740); font-size: 13px; }
  .comment { color: var(--text-dim, #4A4740); font-size: 11px; }
  .path { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle; }

  @media (max-width: 768px) {
    .metrics { grid-template-columns: repeat(2, 1fr); }
    .events { flex-wrap: wrap; gap: 12px; }
  }
`;
