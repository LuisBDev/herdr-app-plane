export function parseTeam(text) {
  const raw = JSON.parse(text);
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(raw?.project ?? "")) throw new Error("project debe ser el UUID del proyecto");
  if (!uuid.test(raw?.lead ?? "")) throw new Error("lead debe ser el UUID del líder");
  const members = (raw.members ?? []).map((m) => {
    if (!uuid.test(m?.id ?? "") || !m.label) throw new Error("cada miembro necesita id (UUID) y label");
    return { id: m.id, label: String(m.label) };
  });
  return { project: raw.project, lead: raw.lead, members, ids: new Set([raw.lead, ...members.map((m) => m.id)]) };
}

export const ORIGINS = {
  propia: "Propia",
  delegada: "Delegada",
  equipo: "Equipo",
  externa: "Externa",
};

export function origin(item, team) {
  if (item.createdBy === team.lead) return item.assignees.some((a) => a !== team.lead) ? "delegada" : "propia";
  return team.ids.has(item.createdBy) ? "equipo" : "externa";
}

export const inUniverse = (item, team) => team.ids.has(item.createdBy) || item.assignees.some((a) => team.ids.has(a));

export const ORIGIN_FILTERS = [
  { key: "all", label: "Todas", match: () => true },
  { key: "propia", label: "Propias", match: (i, team) => origin(i, team) === "propia" },
  { key: "delegada", label: "Delegadas", match: (i, team) => origin(i, team) === "delegada" },
  { key: "equipo", label: "Del equipo", match: (i, team) => origin(i, team) === "equipo" },
  { key: "externa", label: "Externas", match: (i, team) => origin(i, team) === "externa" },
];

export const personFilters = (team) => [
  { key: "all", label: "Todos", match: () => true },
  { key: "me", label: "Yo", match: (i) => i.assignees.includes(team.lead) },
  ...team.members.map((m) => ({ key: m.id, label: m.label, match: (i) => i.assignees.includes(m.id) })),
  { key: "none", label: "Sin asignar", match: (i) => i.assignees.length === 0 },
];

export const PERIODS = [
  { key: "7", label: "7 d" },
  { key: "14", label: "14 d" },
  { key: "30", label: "30 d" },
  { key: "all", label: "Todo" },
];

export const DEFAULT_FILTERS = { origin: "all", person: "all", period: "7" };

export function periodDays(key) {
  if (key === "all") return null;
  const n = /^\d+$/.test(key ?? "") ? Number(key) : NaN;
  return n >= 1 && n <= 3650 ? n : 7;
}

const DAY = 86400000;
const CLOSED = new Set(["completed", "cancelled"]);

export const isOpen = (item, states) => !CLOSED.has(states[item.stateId]?.group);

const byKey = (list, key) => list.find((f) => f.key === key) ?? list[0];

const fold = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function searchMatcher(query) {
  const q = (query ?? "").trim();
  if (!q) return null;
  const id = /^(?:[a-z][a-z0-9]*-)?(\d+)$/i.exec(q);
  if (id) return (i) => i.seq === Number(id[1]);
  const words = fold(q).split(/\s+/);
  return (i) => { const name = fold(i.name); return words.every((w) => name.includes(w)); };
}

export function filterItems(items, states, filters, now, team, query = "") {
  const o = byKey(ORIGIN_FILTERS, filters.origin), p = byKey(personFilters(team), filters.person);
  const search = searchMatcher(query);
  const days = search ? null : periodDays(filters.period);
  const since = days === null ? null : now.getTime() - days * DAY;
  return items.filter((i) => inUniverse(i, team) && o.match(i, team) && p.match(i) && (!search || search(i)) &&
    (since === null || isOpen(i, states) || Date.parse(i.completedAt ?? i.updatedAt) >= since));
}

const STATE_COLORS = {
  "Backlog": "#9ca3af", "Todo": "#22d3ee", "En Análisis": "#60a5fa", "En Desarrollo": "#fbbf24",
  "En Progreso": "#fb923c", "En Calidad": "#c084fc", "En Despliegue": "#f472b6",
  "Finalizado": "#4ade80", "Cancelado": "#f87171",
};

export const stateColor = (state) => STATE_COLORS[state?.name] ?? state?.color ?? null;

const STATE_ORDER = ["En Análisis", "En Desarrollo", "En Calidad", "En Despliegue", "En Progreso",
  "Todo", "Backlog", "Finalizado", "Cancelado"];
const GROUP_ANCHOR = { started: "En Progreso", unstarted: "Todo", backlog: "Backlog",
  completed: "Finalizado", cancelled: "Cancelado" };

function stateRank(state) {
  const known = STATE_ORDER.indexOf(state?.name);
  if (known >= 0) return known;
  const anchor = STATE_ORDER.indexOf(GROUP_ANCHOR[state?.group]);
  return anchor >= 0 ? anchor + 0.5 : STATE_ORDER.length;
}

export function compareItems(states) {
  return (a, b) => stateRank(states[a.stateId]) - stateRank(states[b.stateId]) ||
    (a.target === b.target ? 0 : a.target === null ? 1 : b.target === null ? -1 : a.target < b.target ? -1 : 1) ||
    b.seq - a.seq;
}

export const NO_MODULE = { id: "none", code: null, name: "Sin módulo" };

export function groupByModule(items, modules, states) {
  const sections = new Map(modules.map((m) => [m.id, { module: m, items: [] }]));
  const none = { module: NO_MODULE, items: [] };
  for (const item of items) {
    const homes = item.moduleIds.map((id) => sections.get(id)).filter(Boolean);
    for (const s of homes.length ? homes : [none]) s.items.push(item);
  }
  const compare = compareItems(states);
  const open = (s) => s.items.filter((i) => isOpen(i, states)).length;
  const filled = [...sections.values()].filter((s) => s.items.length)
    .map((s) => ({ ...s, open: open(s) }))
    .sort((a, b) => b.open - a.open || b.items.length - a.items.length || a.module.name.localeCompare(b.module.name));
  if (none.items.length) filled.push({ ...none, open: open(none) });
  for (const s of filled) s.items.sort(compare);
  return filled;
}

export const moduleCode = (name) => (name.includes(" - ") ? name.split(" - ")[0].trim() : null);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div)>\s*(?=<\/t[dh]>)/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/t[dh]>\s*(?=<t[dh])/gi, " | ")
    .replace(/<\/(p|div|h[1-6]|tr|ul|ol|table|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1))
        : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const pad = (n) => String(n).padStart(2, "0");

export function ddmm(date) {
  if (!date) return "—";
  const [, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export function hhmm(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${hhmm(iso)}`;
}

export const localDay = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const isOverdue = (item, states, now) => isOpen(item, states) && item.target !== null && item.target < localDay(now);

export function initials(member) {
  if (!member) return "?";
  const parts = (member.name || member.display || "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export const PRIORITIES = { urgent: "Urgente", high: "Alta", medium: "Media", low: "Baja", none: "—" };

const CATALOG_MS = 30 * 60 * 1000;

export function reusableCatalog(previous, issueIds, baseUrl, project, now) {
  if (!previous?.catalogAt || !previous.moduleIds || !previous.identifier) return null;
  if (previous.baseUrl !== baseUrl || previous.project !== project) return null;
  if (now - Date.parse(previous.catalogAt) > CATALOG_MS) return null;
  const known = new Set(previous.items.map((i) => i.id));
  if (issueIds.some((id) => !known.has(id))) return null;
  const { catalogAt, identifier, states, members, modules, moduleIds } = previous;
  return { catalogAt, identifier, states, members, modules, moduleIds };
}
