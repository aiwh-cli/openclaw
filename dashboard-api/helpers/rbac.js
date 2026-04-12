// ─── RBAC Authorization Engine (Theme AB.11 + AB.12.5) ──────
// Policy-driven role-based access control.
// Owner configures permissions via client/config/rbac-policy.json.
// Owner always has full access — policy only governs admin/team.

const fs = require('fs');
const path = require('path');
const CLIENT_ROOT = process.env.CLIENT_ROOT || '/opt/AIWH/client';
const DEPTS_FILE = path.join(CLIENT_ROOT, 'config', 'departments.json');
const POLICY_FILE = path.join(CLIENT_ROOT, 'config', 'rbac-policy.json');

// ─── Caches (60s TTL) ───────────────────────────────────────

let _deptsCache = null, _deptsCacheTime = 0;
let _policyCache = null, _policyCacheTime = 0;

function loadDepartments() {
  const now = Date.now();
  if (_deptsCache && now - _deptsCacheTime < 60000) return _deptsCache;
  try { _deptsCache = JSON.parse(fs.readFileSync(DEPTS_FILE, 'utf8')); }
  catch { _deptsCache = { departments: [] }; }
  _deptsCacheTime = now;
  return _deptsCache;
}

function loadPolicy() {
  const now = Date.now();
  if (_policyCache && now - _policyCacheTime < 60000) return _policyCache;
  try { _policyCache = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')); }
  catch { _policyCache = defaultPolicy(); }
  _policyCacheTime = now;
  return _policyCache;
}

function defaultPolicy() {
  return { version: 1, roles: {
    admin: { views: {}, actions: { manage_users: true, create_agents: true, manage_connectors: true, manage_workflows: true, manage_knowledge: true, manage_channels: true, view_costs: true, manage_providers: true, view_audit: false, manage_system: false } },
    team: { views: {}, actions: {} },
  }};
}

/** Check if a role has a specific action permission */
function hasAction(role, action) {
  if (role === 'owner') return true;
  const policy = loadPolicy();
  return !!policy.roles?.[role]?.actions?.[action];
}

/** Check if a role can see a specific view */
function hasView(role, viewId) {
  if (role === 'owner') return true;
  const policy = loadPolicy();
  const view = policy.roles?.[role]?.views?.[viewId];
  return view !== undefined ? !!view : false;
}

/** Get full permissions object for a role (used by /api/auth/status) */
function getPermissionsForRole(role) {
  if (role === 'owner') {
    return { canManageUsers: true, canViewSecurity: true, canViewCosts: true, canViewSystem: true,
      canViewConnectors: true, canViewWorkflows: true, canViewKnowledge: true, canViewAudit: true, canCreateAgents: true };
  }
  const policy = loadPolicy();
  const actions = policy.roles?.[role]?.actions || {};
  return {
    canManageUsers: !!actions.manage_users,
    canViewSecurity: !!actions.manage_system,
    canViewCosts: !!actions.view_costs,
    canViewSystem: !!actions.manage_system,
    canViewConnectors: !!actions.manage_connectors,
    canViewWorkflows: !!actions.manage_workflows,
    canViewKnowledge: !!actions.manage_knowledge,
    canViewAudit: !!actions.view_audit,
    canCreateAgents: !!actions.create_agents,
  };
}

// ─── Agent/Department Access ────────────────────────────────

const SYSTEM_AGENTS = ['main', 'builder-manager', 'security-manager', 'module-manager', 'scheduler', 'ai-council', 'systems'];
const PERSONAL_CC_DEPTS = ['wealth', 'personal']; // departments tied to personal CCs

function getAccessibleAgents(user) {
  if (!user) return [];
  if (user.role === 'owner') return null;
  const depts = loadDepartments();
  const agentSet = new Set();
  if (user.role === 'admin') {
    const userCCs = new Set(user.commandCentres || []);
    for (const dept of depts.departments || []) {
      if (userCCs.has(dept.command_centre)) for (const a of dept.agents || []) agentSet.add(a);
    }
    for (const a of SYSTEM_AGENTS) agentSet.add(a);
  } else {
    const userDepts = new Set(user.departments || []);
    for (const dept of depts.departments || []) {
      if (userDepts.has(dept.id)) for (const a of dept.agents || []) agentSet.add(a);
    }
  }
  // Personal CC access: add Wealth/Life agents regardless of role/departments
  if (user.personalCcAccess) {
    for (const dept of depts.departments || []) {
      if (PERSONAL_CC_DEPTS.includes(dept.id)) for (const a of dept.agents || []) agentSet.add(a);
    }
  }
  return agentSet;
}

function getAccessibleDepartments(user) {
  if (!user) return [];
  if (user.role === 'owner') return null;
  const depts = loadDepartments();
  if (user.role === 'admin') {
    const userCCs = new Set(user.commandCentres || []);
    return (depts.departments || []).filter(d => userCCs.has(d.command_centre)).map(d => d.id);
  }
  return user.departments || [];
}

function canAccessAgent(user, agentId) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  // AC.1: team users reach dept specialists ONLY through department-lead.
  // Direct access to specialists is refused — scoping happens via
  // scopeSessionForDeptLead() + the injected [AIWH-DEPT-CONTEXT] block.
  if (user.role === 'team' && agentId === 'department-lead') {
    return Array.isArray(user.departments) && user.departments.length > 0;
  }
  const accessible = getAccessibleAgents(user);
  return accessible === null || accessible.has(agentId);
}

function canAccessDepartment(user, deptId) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  const accessible = getAccessibleDepartments(user);
  return accessible === null || accessible.includes(deptId);
}

// ─── Express Middleware Factories ────────────────────────────

/** Require a specific action permission from the policy */
function requireAction(action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (hasAction(req.user.role, action)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/** Require minimum role (owner always passes). Kept for routes that shouldn't be policy-configurable. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (roles.includes(req.user.role) || req.user.role === 'owner') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

function requireAgentAccess(paramName = 'id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'owner') return next();
    const agentId = req.params[paramName] || req.body?.agentId;
    if (!agentId) return next();
    if (canAccessAgent(req.user, agentId)) return next();
    return res.status(403).json({ error: 'You do not have access to this agent' });
  };
}

function requireDepartmentAccess(paramName = 'id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'owner') return next();
    const deptId = req.params[paramName];
    if (!deptId) return next();
    if (canAccessDepartment(req.user, deptId)) return next();
    return res.status(403).json({ error: 'You do not have access to this department' });
  };
}

// ─── Filters ────────────────────────────────────────────────

// AC.1: synthesize one Delta (department-lead) card per accessible department
// for team users. Team users never see the underlying specialists — they reach
// them by talking to Delta, which orchestrates within the department allowlist.
function buildDeltaCardsForTeam(user) {
  const depts = loadDepartments();
  const userDepts = new Set(user.departments || []);
  return (depts.departments || [])
    .filter(d => userDepts.has(d.id))
    .map(d => ({
      id: 'department-lead',
      agent_id: 'department-lead',
      departmentId: d.id,
      displayName: `${d.name} Lead`,
      title: 'Department Lead',
      name: `${d.name} Lead`,
      emoji: '📋',
      model: 'haiku',
      commandCentre: d.command_centre || 'business',
      department: d.id,
    }));
}

function filterAgentsForUser(user, agents) {
  if (!user || user.role === 'owner') return agents;
  const accessible = getAccessibleAgents(user);
  if (accessible === null) return agents;
  const filtered = agents.filter(a => accessible.has(a.id || a.agent_id));
  // Team users: prepend one Delta (department-lead) card per accessible department.
  // Delta sits at the top like Branson does for owners; specialists stay visible below.
  if (user.role === 'team') return [...buildDeltaCardsForTeam(user), ...filtered];
  return filtered;
}

function filterOrgChartForUser(user, orgChart) {
  if (!user || user.role === 'owner') return orgChart;
  const chart = JSON.parse(JSON.stringify(orgChart));
  const accessible = getAccessibleAgents(user);
  const accessibleDepts = getAccessibleDepartments(user);
  if (chart.hierarchy?.commandCentres) {
    if (user.role === 'admin') {
      const userCCs = new Set(user.commandCentres || []);
      chart.hierarchy.commandCentres = chart.hierarchy.commandCentres.filter(cc => userCCs.has(cc.id));
    } else {
      chart.hierarchy.commandCentres = chart.hierarchy.commandCentres.map(cc => {
        const filteredDepts = (cc.departments || []).filter(d => accessibleDepts.includes(d.id));
        return filteredDepts.length === 0 ? null : { ...cc, departments: filteredDepts };
      }).filter(Boolean);
    }
    if (accessible) {
      for (const cc of chart.hierarchy.commandCentres) {
        for (const dept of cc.departments || []) {
          dept.agents = (dept.agents || []).filter(a => accessible.has(a.id));
        }
      }
    }
  }
  return chart;
}

function clearDepartmentsCache() { _deptsCache = null; }
function clearPolicyCache() { _policyCache = null; }

module.exports = {
  requireRole, requireAction, requireAgentAccess, requireDepartmentAccess,
  filterAgentsForUser, filterOrgChartForUser,
  getAccessibleAgents, getAccessibleDepartments, canAccessAgent, canAccessDepartment,
  clearDepartmentsCache, clearPolicyCache,
  hasAction, hasView, getPermissionsForRole, loadPolicy,
};
