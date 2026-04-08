import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { securityStyles } from './security-styles.js';
import type { AuditData } from './security-types.js';

@customElement('security-audit-tab')
export class SecurityAuditTab extends LitElement {
  static styles = securityStyles;

  @property({ type: Object }) audit: AuditData | null = null;

  private _s(p: string) { return (p || '').replace('/opt/AIWH/', ''); }

  private _outBadge(o: string) {
    const map: Record<string, [string, string]> = {
      'redirected_to_trash': ['b-out-o', 'Trashed'],
      'kernel_blocked': ['b-out-r', 'Blocked'],
      'policy_applied': ['b-out-c', 'Policy'],
      'policy_changed': ['b-out-c', 'Changed'],
      'trash_restored': ['b-out-g', 'Restored'],
      'trash_purged': ['b-out-o', 'Purged'],
    };
    const [cls, label] = map[o] || ['b-out-g', 'Allowed'];
    return html`<span class="b-out ${cls}">${label}</span>`;
  }

  render() {
    const entries = this.audit?.entries || [];
    if (!entries.length) {return html`<div class="empty">No security events logged yet.</div>`;}
    return html`<table>
      <thead><tr><th>Time</th><th>Outcome</th><th>Detail</th></tr></thead>
      <tbody>
        ${entries.map(e => html`<tr>
          <td style="white-space:nowrap;font-size:11px">${e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
          <td>${this._outBadge(e.outcome)}</td>
          <td style="font-size:11px">
            <span style="color:var(--text-muted)">${e.agent_id || '—'}</span>
            ${e.action ? html` <span style="opacity:0.5">›</span> <span>${e.action}</span>` : ''}
            ${e.target_path ? html` <span style="opacity:0.5">›</span> <code class="path" title="${e.target_path}">${this._s(e.target_path)}</code>` : ''}
            ${e.detail ? html`<br><span style="color:var(--text-muted);font-size:10px">${e.detail}</span>` : ''}
          </td>
        </tr>`)}
      </tbody>
    </table>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'security-audit-tab': SecurityAuditTab; } }
