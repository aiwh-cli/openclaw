// Team File Editor — modal for editing agent runtime files.
// Called from team-detail-view.ts. Exposed on window.

const api = (window as any).api as (url: string, opts?: any) => Promise<any>;
const showToast = (window as any).showToast as (msg: string, type?: string) => void;
const showModal = (window as any).showModal as (html: string, cls?: string) => void;
const closeModal = (window as any).closeModal as () => void;
const escHtml = (window as any).escHtml as (s: string) => string;

const FILE_META: Record<string, { label: string; desc: string; readOnly?: boolean }> = {
  'CORE.md':       { label: 'Engine (Product Core)',             desc: 'Core product instructions — read-only, updated automatically', readOnly: true },
  'SOUL.md':       { label: 'Your Vision',                      desc: 'Your custom instructions, voice, and behavior — safe to edit' },
  'MEMORY.md':     { label: 'Long-term Memory', desc: 'Curated knowledge that persists across sessions' },
  'AGENTS.md':     { label: 'Instructions',   desc: 'Operating rules, workflows, and delegation patterns' },
  'IDENTITY.md':   { label: 'Identity',       desc: 'Name, role, and how the agent presents itself' },
  'USER.md':       { label: 'User Profile',   desc: 'Who the agent is talking to — your preferences' },
  'TOOLS.md':      { label: 'Tools & Skills', desc: 'Available tools, scripts, and API access notes' },
  'BOOTSTRAP.md':  { label: 'Startup Rules',  desc: 'First-run checklist executed on every new session' },
  'HEARTBEAT.md':  { label: 'Heartbeat',      desc: 'Periodic check-in tasks the agent runs automatically' },
  'HARD-LIMITS.md':{ label: 'Safety Rules',   desc: 'Non-negotiable boundaries and restrictions' },
  'CONTEXT.md':    { label: 'Context Guide',  desc: 'What the agent should know about the current project' },
};

export { FILE_META };

function _confirmFileChange(label: string): Promise<boolean> {
  return new Promise(resolve => {
    const content = document.getElementById('modal-content');
    (window as any)._dashDialogPrev = content ? content.innerHTML : null;
    (window as any)._dashDialogPrevClass = content?.parentElement?.className || '';
    showModal(`
      <div class="dash-dialog">
        <div class="file-confirm-danger">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12" r="0.8" fill="currentColor"/></svg>
          <div>
            <strong>You are about to change "${label}"</strong>
            <p>This will directly affect how this agent thinks, responds, and operates. Incorrect changes could break the agent's behaviour.</p>
          </div>
        </div>
        <div class="file-confirm-input-wrap">
          <label>Type <strong>CONFIRM</strong> to save changes</label>
          <input type="text" id="file-confirm-input" class="file-confirm-input" placeholder="Type CONFIRM here" autocomplete="off" spellcheck="false">
        </div>
        <div class="dash-dialog-btns">
          <button class="btn btn-ghost" onclick="closeDashDialog(false)">Cancel</button>
          <button class="btn btn-danger" id="file-confirm-btn" disabled onclick="closeDashDialog(true)">Save Changes</button>
        </div>
      </div>
    `);
    (window as any)._dashDialogResolve = resolve;
    const inp = document.getElementById('file-confirm-input') as HTMLInputElement;
    const btn = document.getElementById('file-confirm-btn') as HTMLButtonElement;
    if (inp && btn) {
      inp.addEventListener('input', () => { btn.disabled = inp.value.trim() !== 'CONFIRM'; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim() === 'CONFIRM') { (window as any).closeDashDialog(true); } });
      setTimeout(() => inp.focus(), 50);
    }
  });
}

export async function openFileEditor(filePath: string, fileName: string) {
  const meta = FILE_META[fileName] || { label: fileName, desc: 'Agent file' };
  const isReadOnly = (meta as any).readOnly;
  const modal = document.getElementById('modal-content');
  const overlay = document.getElementById('modal-overlay');
  if (!modal || !overlay) { return; }

  modal.innerHTML = '<div class="file-editor-loading">Loading...</div>';
  overlay.classList.remove('hidden');
  overlay.querySelector('.modal')?.classList.add('modal-fullscreen');

  try {
    const data = await api('/files/read?path=' + encodeURIComponent(filePath));
    if (data?.error) { throw new Error(data.error); }

    const hintText = isReadOnly
      ? 'This file contains product instructions and is updated automatically. You can view it but changes are not saved. To customize this agent, edit "Personality (Your Customizations)" instead.'
      : 'Editing this file will change how this agent thinks and behaves. Changes take effect on the agent\'s very next message. If you\'re unsure, ask your AI team lead first.';

    modal.innerHTML = `
      <div class="file-editor">
        <div class="file-editor-header">
          <div><h2>${escHtml(meta.label)}${isReadOnly ? ' &#128274;' : ''}</h2>
            <p class="file-editor-desc">${escHtml(meta.desc)}</p></div>
          <button class="btn-icon" onclick="closeModal()">&#10005;</button>
        </div>
        <div class="file-editor-hint${isReadOnly ? ' file-editor-hint-readonly' : ''}">${hintText}</div>
        <textarea id="file-editor-textarea" class="file-editor-textarea" spellcheck="false" ${isReadOnly ? 'readonly' : ''}>${escHtml(data.content || '')}</textarea>
        <div class="file-editor-footer">
          <span class="file-editor-size" id="file-editor-size">${(data.content || '').length.toLocaleString()} chars</span>
          <div class="file-editor-actions">
            <button class="btn btn-ghost" onclick="closeModal()">${isReadOnly ? 'Close' : 'Cancel'}</button>
            ${isReadOnly ? '' : `<button class="btn btn-primary" onclick="saveFileEditor('${escHtml(filePath)}')">Save Changes</button>`}
          </div>
        </div>
      </div>
    `;

    const ta = document.getElementById('file-editor-textarea') as HTMLTextAreaElement;
    const sizeEl = document.getElementById('file-editor-size');
    if (ta && sizeEl) {
      ta.addEventListener('input', () => {
        const len = ta.value.length;
        sizeEl.textContent = len.toLocaleString() + ' chars';
        sizeEl.style.color = len > 18000 ? 'var(--red)' : len > 15000 ? 'var(--yellow)' : '';
      });
    }
  } catch (e: any) {
    modal.innerHTML = `<p style="color:var(--red)">Failed to load file: ${escHtml(e.message)}</p>`;
  }
}

export async function saveFileEditor(filePath: string) {
  const ta = document.getElementById('file-editor-textarea') as HTMLTextAreaElement;
  if (!ta) { return; }
  const fileName = filePath.split('/').pop() || '';
  const meta = FILE_META[fileName] || { label: fileName };
  const confirmed = await _confirmFileChange(meta.label);
  if (!confirmed) { return; }

  const content = ta.value;
  const btn = ta.closest('.file-editor')?.querySelector('.btn-primary') as HTMLButtonElement;
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  try {
    const result = await api('/files/save', { method: 'PUT', body: { path: filePath, content } });
    if (result?.ok) {
      showToast('Saved — changes apply on next message', 'success');
      closeModal();
    } else {
      showToast(result?.error || 'Save failed', 'error');
      if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
    }
  } catch (e: any) {
    showToast('Save failed: ' + e.message, 'error');
    if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
  }
}

// Expose on window
(window as any).openFileEditor = openFileEditor;
(window as any).saveFileEditor = saveFileEditor;
