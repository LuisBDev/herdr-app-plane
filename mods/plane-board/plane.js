import { readTextFile, home } from "herdr";
import { moduleCode, htmlToText, reusableCatalog } from "./model.js";

const TIMEOUT = 10000;

async function readConfig() {
  const text = await readTextFile(home() + "/.plane_api");
  if (text === null) throw new Error("falta ~/.plane_api");
  const config = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) config[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const key of ["base_url", "api_key", "workspace"])
    if (!config[key]) throw new Error(`~/.plane_api sin ${key}`);
  return config;
}

function client(cx, base, apiKey) {
  const headers = { "X-API-Key": apiKey };
  const get = async (path) => {
    const response = await Promise.race([fetch(base + path, { headers }), cx.sleep(TIMEOUT).then(() => null)]);
    if (response === null) throw new Error(`sin respuesta en ${TIMEOUT / 1000} s`);
    if (response.status === 429) throw new Error("Plane limitó las consultas (429); se reintenta en el próximo ciclo");
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${path.split("?")[0]}`);
    return response.json();
  };
  const all = async (path) => {
    const results = [];
    for (let cursor = null; ;) {
      const page = await get(cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path);
      results.push(...page.results);
      if (!page.next_page_results) return results;
      cursor = page.next_cursor;
    }
  };
  return { get, all };
}

export const browseUrl = (snapshot, seq) => `${snapshot.baseUrl}/${snapshot.workspace}/browse/${snapshot.identifier}-${seq}/`;

async function fetchCatalog(api) {
  const [project, states, members, modules] = await Promise.all([
    api.get(""), api.get("states/"), api.get("members/"), api.get("modules/?per_page=100"),
  ]);
  const moduleList = modules.results ?? modules;
  const memberships = await Promise.all(moduleList.map((m) => api.all(`modules/${m.id}/module-issues/?per_page=100`)));
  const moduleIds = {};
  moduleList.forEach((m, i) => {
    for (const issue of memberships[i]) (moduleIds[issue.id] ??= []).push(m.id);
  });
  return {
    catalogAt: new Date().toISOString(),
    identifier: project.identifier,
    states: Object.fromEntries((states.results ?? states).map((s) => [s.id, { name: s.name, color: s.color, group: s.group }])),
    members: Object.fromEntries((members.results ?? members).map((m) => [m.id, { display: m.display_name, name: m.first_name }])),
    modules: moduleList.map((m) => ({ id: m.id, code: moduleCode(m.name), name: m.name })),
    moduleIds,
  };
}

export async function fetchSnapshot(cx, team, baseUrlOverride, previous, full) {
  const config = await readConfig();
  const baseUrl = (baseUrlOverride || config.base_url).replace(/\/+$/, "");
  const api = client(cx, `${baseUrl}/api/v1/workspaces/${config.workspace}/projects/${team.project}/`, config.api_key);

  const issues = await api.all("issues/?per_page=100");
  const catalog = (!full && reusableCatalog(previous, issues.map((i) => i.id), baseUrl, team.project, Date.now()))
    ?? await fetchCatalog(api);

  const descriptions = new Map(issues.map((i) => [i.id, htmlToText(i.description_html)]));
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    baseUrl,
    workspace: config.workspace,
    project: team.project,
    ...catalog,
    items: issues.map((i) => ({
      id: i.id, seq: i.sequence_id, name: i.name, stateId: i.state, priority: i.priority,
      start: i.start_date, target: i.target_date, completedAt: i.completed_at, updatedAt: i.updated_at,
      createdAt: i.created_at, createdBy: i.created_by, assignees: i.assignees ?? [], moduleIds: catalog.moduleIds[i.id] ?? [],
    })),
  };
  return { snapshot, descriptions };
}
