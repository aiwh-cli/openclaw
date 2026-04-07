// ─── Trash View ──────────────────────────────────────────────
// Shows files moved to /opt/AIWH/trash/ by the media archiver.
// Files can only be permanently deleted after 48-hour cooldown
// and only if they have a verified GDrive copy.

async function initTrash() {
  await loadTrashManifest();
  await loadTrashStats();
}

async function loadTrashStats() {
  try {
    const data = await api('/trash/stats');
    const el = document.getElementById('trash-stats');
    if (!el || !data) {return;}
    el.innerHTML = `
      <div class="trash-stat"><span class="trash-stat-value">${data.total_files || 0}</span><span class="trash-stat-label">Files</span></div>
      <div class="trash-stat"><span class="trash-stat-value">${formatBytes(data.total_size || 0)}</span><span class="trash-stat-label">Total Size</span></div>
      <div class="trash-stat"><span class="trash-stat-value">${data.verified || 0}</span><span class="trash-stat-label">Verified on GDrive</span></div>
      <div class="trash-stat"><span class="trash-stat-value">${data.deletable || 0}</span><span class="trash-stat-label">Ready to Delete</span></div>
    `;
  } catch {}
}

async function loadTrashManifest() {
  try {
    const data = await api('/trash/manifest');
    const el = document.getElementById('trash-list');
    if (!el) {return;}

    const items = data?.items || [];
    if (!items.length) {
      el.innerHTML = '<div class="trash-empty">Trash is empty. Media archiver moves files here after uploading to GDrive.</div>';
      return;
    }

    el.innerHTML = `
      <table class="trash-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Source</th>
            <th>GDrive</th>
            <th>Trashed</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => _renderTrashRow(item)).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    const el = document.getElementById('trash-list');
    if (el) {el.innerHTML = `<div class="trash-empty">Error loading trash: ${escHtml(e.message)}</div>`;}
  }
}

function _renderTrashRow(item) {
  const filename = item.original_path.split('/').pop();
  const relPath = item.original_path.replace('/opt/AIWH/', '');
  const ext = filename.split('.').pop().toLowerCase();
  const icon = _trashFileIcon(ext);
  const sizeStr = formatBytes(item.file_size || 0);
  const verified = item.verified ? '1' : '0';
  const verifiedHtml = item.verified
    ? `<span class="trash-verified" title="Verified on GDrive: ${escHtml(item.gdrive_folder_path || '')}/${escHtml(filename)}">Verified</span>`
    : '<span class="trash-unverified">Not verified</span>';

  const trashedAt = item.trashed_at ? new Date(item.trashed_at) : null;
  const hoursAgo = trashedAt ? (Date.now() - trashedAt.getTime()) / 3600000 : 0;
  const canDelete = item.verified && hoursAgo >= 48;
  const cooldownLeft = Math.max(0, 48 - hoursAgo);

  let actionHtml;
  if (item.deleted_at) {
    actionHtml = '<span class="trash-deleted-label">Deleted</span>';
  } else if (canDelete) {
    actionHtml = `<button class="btn btn-ghost btn-xs trash-delete-btn" onclick="trashDeleteFile(${item.id})">Delete</button>`;
  } else if (!item.verified) {
    actionHtml = '<span class="trash-cooldown">Upload not verified</span>';
  } else {
    const hrs = Math.ceil(cooldownLeft);
    actionHtml = `<span class="trash-cooldown">${hrs}h cooldown</span>`;
  }

  const sourceLabel = _trashSourceLabel(item.original_path);
  const trashedStr = trashedAt ? timeAgo(item.trashed_at) : '-';

  return `<tr class="${item.deleted_at ? 'trash-row-deleted' : ''}">
    <td>
      <div class="trash-file-info">
        <span class="trash-file-icon">${icon}</span>
        <div>
          <div class="trash-filename">${escHtml(filename)}</div>
          <div class="trash-filepath">${escHtml(relPath)}</div>
        </div>
      </div>
    </td>
    <td>${sizeStr}</td>
    <td><span class="trash-source">${sourceLabel}</span></td>
    <td>${verifiedHtml}</td>
    <td>${trashedStr}</td>
    <td>${actionHtml}</td>
  </tr>`;
}

function _trashFileIcon(ext) {
  const icons = { mp4: '🎬', mp3: '🎵', wav: '🎵', mov: '🎬', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️' };
  return icons[ext] || '📄';
}

function _trashSourceLabel(path) {
  if (path.includes('/content/jobs/')) {return 'Video Job';}
  if (path.includes('/cinematic/')) {return 'Cinematic';}
  if (path.includes('/outputs/')) {return 'Output';}
  return 'Other';
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) {return '0 B';}
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

async function trashDeleteFile(id) {
  const ok = typeof dashConfirm === 'function'
    ? await dashConfirm('Permanently delete this file? This cannot be undone.')
    : confirm('Permanently delete this file?');
  if (!ok) {return;}

  try {
    const r = await fetch(`/api/trash/${id}`, { method: 'DELETE' });
    const data = await r.json();
    if (data.ok) {
      showToast('File deleted', 'success');
      loadTrashManifest();
      loadTrashStats();
    } else {
      showToast('Delete failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function trashDeleteAllReady() {
  const ok = typeof dashConfirm === 'function'
    ? await dashConfirm('Delete ALL files that are verified and past 48h cooldown?')
    : confirm('Delete ALL verified files past 48h cooldown?');
  if (!ok) {return;}

  try {
    const r = await fetch('/api/trash/delete-ready', { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      if (data.deleted > 0) {
        showToast(`Deleted ${data.deleted} file(s)${data.errors ? ` (${data.errors} errors)` : ''}`, 'success');
      } else {
        showToast('No files ready to delete (need 48h cooldown + GDrive verification)', 'info');
      }
      loadTrashManifest();
      loadTrashStats();
    } else {
      showToast('Delete failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function trashRunArchiver() {
  const ok = typeof dashConfirm === 'function'
    ? await dashConfirm('Run the media archiver now? This will upload completed media to GDrive and move files to trash.')
    : confirm('Run media archiver now?');
  if (!ok) {return;}

  const btn = document.getElementById('trash-run-archiver');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

  try {
    const r = await fetch('/api/trash/run-archiver', { method: 'POST' });
    const data = await r.json();
    if (!data.ok) {
      if (btn) { btn.disabled = false; btn.textContent = 'Run Archiver'; }
      showToast(data.error || 'Failed to start', 'error');
      return;
    }

    // Poll for progress
    const poll = setInterval(async () => {
      try {
        const pr = await fetch('/api/trash/archiver-progress');
        const job = await pr.json();
        if (btn) {btn.textContent = job.progress || 'Running...';}

        if (job.status === 'done') {
          clearInterval(poll);
          if (btn) { btn.disabled = false; btn.textContent = 'Run Archiver'; }
          showToast('Archiver complete', 'success');
          loadTrashManifest();
          loadTrashStats();
        } else if (job.status === 'error') {
          clearInterval(poll);
          if (btn) { btn.disabled = false; btn.textContent = 'Run Archiver'; }
          showToast('Archiver failed: ' + (job.error || 'unknown'), 'error');
          loadTrashManifest();
          loadTrashStats();
        }
      } catch { /* keep polling */ }
    }, 2000);

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(poll);
      if (btn?.disabled) { btn.disabled = false; btn.textContent = 'Run Archiver'; }
    }, 600000);
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Archiver'; }
  }
}
