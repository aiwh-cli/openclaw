// ─── Notifications ────────────────────────────────────────────
// Bell icon dropdown + unread count badge.

let _notifOpen = false;

function toggleNotifications() {
  _notifOpen = !_notifOpen;
  const panel = document.getElementById('notif-panel');
  if (panel) {panel.classList.toggle('open', _notifOpen);}
  if (_notifOpen) {loadNotifications();}
}

function closeNotifications() {
  _notifOpen = false;
  document.getElementById('notif-panel')?.classList.remove('open');
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) {return;}
  badge.textContent = count > 9 ? '9+' : count;
  badge.classList.toggle('hidden', count === 0);
}

async function loadNotifications() {
  const notifs = await api('/notifications?limit=20') || [];
  renderNotifications(notifs);

  // Mark as read after viewing
  setTimeout(() => api('/notifications/read-all', { method: 'POST' }), 2000);
}

function renderNotifications(notifs) {
  const el = document.getElementById('notif-list');
  if (!el) {return;}

  if (!notifs.length) {
    el.innerHTML = '<div class="notif-empty">No notifications</div>';
    return;
  }

  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read_at ? 'read' : 'unread'} priority-${n.priority}">
      <div class="notif-title">${escHtml(n.title)}</div>
      <div class="notif-body">${escHtml(n.body || '')}</div>
      <div class="notif-time">${timeAgo(n.created_at)}</div>
    </div>
  `).join('');
}
