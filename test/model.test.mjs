import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTeam, personFilters, reusableCatalog, origin, inUniverse, filterItems, compareItems, groupByModule, htmlToText,
  isOverdue, ddmm, periodDays, stateColor,
} from "../mods/plane-board/model.js";

const LEAD = "00000000-0000-0000-0000-00000000000a";
const ANA = "00000000-0000-0000-0000-00000000000b";
const BEN = "00000000-0000-0000-0000-00000000000c";
const PROJECT = "00000000-0000-0000-0000-0000000000ff";
const TEAM = parseTeam(JSON.stringify({ project: PROJECT, lead: LEAD, members: [{ id: ANA, label: "Ana" }, { id: BEN, label: "Ben" }] }));
const OTHER = "00000000-0000-0000-0000-000000000001";
const OTHER2 = "00000000-0000-0000-0000-000000000002";

const states = {
  ana: { name: "En Análisis", group: "started" },
  dev: { name: "En Desarrollo", group: "started" },
  prog: { name: "En Progreso", group: "started" },
  odd: { name: "Revisión externa", group: "started" },
  todo: { name: "Todo", group: "unstarted" },
  back: { name: "Backlog", group: "backlog" },
  done: { name: "Finalizado", group: "completed" },
  cancel: { name: "Cancelado", group: "cancelled" },
};

let next = 1;
const item = (over) => ({
  id: `i${next}`, seq: next++, name: "x", stateId: "todo", priority: "none", start: null, target: null,
  completedAt: null, updatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z",
  createdBy: LEAD, assignees: [], moduleIds: [], ...over,
});

const NOW = new Date("2026-11-02T12:00:00Z");
const ALL = { origin: "all", person: "all", period: "all" };

test("origin: propia when I created it and nobody else is assigned", () => {
  assert.equal(origin(item({ assignees: [] }), TEAM), "propia");
  assert.equal(origin(item({ assignees: [LEAD] }), TEAM), "propia");
});

test("origin: delegada when I created it and someone else is assigned", () => {
  assert.equal(origin(item({ assignees: [ANA] }), TEAM), "delegada");
  assert.equal(origin(item({ assignees: [LEAD, BEN] }), TEAM), "delegada", "two assignees, one of them me");
});

test("origin: equipo when a teammate created it", () => {
  assert.equal(origin(item({ createdBy: ANA, assignees: [OTHER] }), TEAM), "equipo");
  assert.equal(origin(item({ createdBy: BEN, assignees: [] }), TEAM), "equipo");
});

test("origin: externa when someone outside the team created it", () => {
  assert.equal(origin(item({ createdBy: OTHER, assignees: [LEAD] }), TEAM), "externa");
});

test("universe: team creator or team assignee, nothing else", () => {
  assert.equal(inUniverse(item({ createdBy: ANA }), TEAM), true);
  assert.equal(inUniverse(item({ createdBy: OTHER, assignees: [OTHER2, BEN] }), TEAM), true);
  assert.equal(inUniverse(item({ createdBy: OTHER, assignees: [OTHER2] }), TEAM), false);
  assert.equal(inUniverse(item({ createdBy: OTHER, assignees: [] }), TEAM), false);
  const outside = item({ createdBy: OTHER, assignees: [OTHER2] });
  assert.deepEqual(filterItems([outside], states, ALL, NOW, TEAM), []);
});

test("period: open items stay, closed ones only inside the window", () => {
  const open = item({ stateId: "dev", updatedAt: "2020-01-01T00:00:00Z" });
  const closedIn = item({ stateId: "done", completedAt: "2026-10-30T10:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  const closedOut = item({ stateId: "done", completedAt: "2026-10-20T10:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
  const cancelledNoCompletion = item({ stateId: "cancel", completedAt: null, updatedAt: "2026-11-01T00:00:00Z" });
  const all = [open, closedIn, closedOut, cancelledNoCompletion];
  assert.deepEqual(filterItems(all, states, { ...ALL, period: "7" }, NOW, TEAM), [open, closedIn, cancelledNoCompletion]);
  assert.deepEqual(filterItems(all, states, { ...ALL, period: "30" }, NOW, TEAM), all);
  assert.deepEqual(filterItems(all, states, ALL, NOW, TEAM), all);
  assert.deepEqual(filterItems(all, states, { ...ALL, period: "14" }, NOW, TEAM), all, "closedOut is 13 days old");
  assert.deepEqual(filterItems(all, states, { ...ALL, period: "10" }, NOW, TEAM), [open, closedIn, cancelledNoCompletion], "manual days");
});

test("period: a manual value outside 1..3650 or not a whole number falls back to 7 d", () => {
  for (const bad of ["0", "-3", "2.5", "abc", "", "9999"]) assert.equal(periodDays(bad), 7, bad);
  assert.equal(periodDays("all"), null);
  assert.equal(periodDays("21"), 21);
});

test("search: by id with or without the project prefix, ignoring the period", () => {
  const old = item({ stateId: "done", completedAt: "2020-01-01T00:00:00Z", name: "Antiguo" });
  const other = item({ name: "Otro" });
  for (const q of [String(old.seq), `ABC-${old.seq}`, `abc-${old.seq}`, ` abc-${old.seq} `])
    assert.deepEqual(filterItems([old, other], states, { ...ALL, period: "7" }, NOW, TEAM, q), [old], q);
});

test("search: by name, every word, ignoring case and accents", () => {
  const a = item({ name: "Corrección de la firma masiva en ABC" });
  const b = item({ name: "Firma de anexos" });
  assert.deepEqual(filterItems([a, b], states, ALL, NOW, TEAM, "firma"), [a, b]);
  assert.deepEqual(filterItems([a, b], states, ALL, NOW, TEAM, "CORRECCION abc"), [a]);
  assert.deepEqual(filterItems([a, b], states, ALL, NOW, TEAM, "  "), [a, b], "blank query filters nothing");
  assert.deepEqual(filterItems([a, b], states, ALL, NOW, TEAM, "deploy"), []);
});

test("search: still respects origin and person", () => {
  const mine = item({ name: "Firma", assignees: [LEAD] });
  const ana = item({ name: "Firma", assignees: [ANA] });
  assert.deepEqual(filterItems([mine, ana], states, { ...ALL, person: ANA }, NOW, TEAM, "firma"), [ana]);
});

test("state colors: each known state has its own color", () => {
  const names = ["Backlog", "Todo", "En Progreso", "Finalizado", "Cancelado", "En Análisis", "En Desarrollo", "En Calidad", "En Despliegue"];
  const colors = names.map((n) => stateColor({ name: n, color: "#000000" }));
  assert.equal(new Set(colors).size, names.length);
  assert.equal(stateColor({ name: "Nuevo", color: "#123456" }), "#123456", "unknown state keeps Plane's color");
});

test("person = Sin asignar keeps only items with no assignee", () => {
  const none = item({ assignees: [] });
  const mine = item({ assignees: [LEAD] });
  const ana = item({ createdBy: ANA, assignees: [ANA] });
  assert.deepEqual(filterItems([none, mine, ana], states, { ...ALL, person: "none" }, NOW, TEAM), [none]);
  assert.deepEqual(filterItems([none, mine, ana], states, { ...ALL, person: ANA }, NOW, TEAM), [ana]);
});

test("order: by state, then target with nulls last, then seq descending", () => {
  const a = item({ seq: 10, stateId: "todo", target: null });
  const b = item({ seq: 11, stateId: "ana", target: "2026-11-10" });
  const c = item({ seq: 12, stateId: "ana", target: "2026-11-05" });
  const d = item({ seq: 13, stateId: "ana", target: null });
  const e = item({ seq: 14, stateId: "ana", target: null });
  const f = item({ seq: 15, stateId: "done" });
  const g = item({ seq: 16, stateId: "odd" });
  const h = item({ seq: 17, stateId: "prog" });
  const sorted = [a, b, c, d, e, f, g, h].sort(compareItems(states)).map((i) => i.seq);
  assert.deepEqual(sorted, [12, 11, 14, 13, 17, 16, 10, 15], "unknown started state sorts after En Progreso");
});

test("grouping: an item in two modules shows in both, Sin módulo goes last", () => {
  const modules = [
    { id: "m1", code: "ABC", name: "ABC - Firma" },
    { id: "m2", code: "XYZ", name: "XYZ - Proyección" },
    { id: "m3", code: null, name: "Vacío" },
  ];
  const both = item({ moduleIds: ["m1", "m2"], stateId: "dev" });
  const onlyM2a = item({ moduleIds: ["m2"], stateId: "dev" });
  const onlyM2b = item({ moduleIds: ["m2"], stateId: "done" });
  const loose1 = item({ moduleIds: [], stateId: "dev" });
  const loose2 = item({ moduleIds: [], stateId: "todo" });
  const loose3 = item({ moduleIds: [], stateId: "back" });
  const sections = groupByModule([both, onlyM2a, onlyM2b, loose1, loose2, loose3], modules, states);
  assert.deepEqual(sections.map((s) => s.module.name), ["XYZ - Proyección", "ABC - Firma", "Sin módulo"],
    "by open count, empty modules dropped, Sin módulo last even with the most open items");
  assert.deepEqual(sections.map((s) => [s.items.length, s.open]), [[3, 2], [1, 1], [3, 3]]);
  assert.ok(sections[0].items.includes(both) && sections[1].items.includes(both));
});

test("htmlToText: paragraphs, lists, tables and entities", () => {
  const html = "<p>Hola&nbsp;mundo &amp; cía</p><p>Segundo &lt;b&gt; &#225; &#x41;</p>" +
    "<ul><li>uno</li><li>dos</li></ul>" +
    "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
  assert.equal(htmlToText(html),
    "Hola mundo & cía\nSegundo <b> á A\n\n• uno\n• dos\nA | B\n1 | 2");
  assert.equal(htmlToText(null), "");
  assert.equal(htmlToText("<p>a<br/>b</p>"), "a\nb");
  assert.equal(htmlToText('<table><tbody><tr><td colspan="1"><p class="x"><strong>Tipo</strong></p></td>' +
    '<td><p>Mejora <code class="y">ABC-1</code></p></td></tr><tr><td><p>Otro</p></td><td><p>valor</p></td></tr></tbody></table>'),
    "Tipo | Mejora ABC-1\nOtro | valor", "Plane's key/value tables keep each pair on one line");
});

test("dates: dd/mm and overdue only when open and target before today", () => {
  assert.equal(ddmm("2026-11-05"), "05/11");
  assert.equal(ddmm(null), "—");
  assert.equal(isOverdue(item({ stateId: "dev", target: "2026-11-01" }), states, NOW), true);
  assert.equal(isOverdue(item({ stateId: "dev", target: "2026-11-02" }), states, NOW), false);
  assert.equal(isOverdue(item({ stateId: "done", target: "2026-10-01" }), states, NOW), false);
});

test("team: the config needs UUIDs for the project, the lead, and each member", () => {
  assert.throws(() => parseTeam('{"project":"x","lead":"' + LEAD + '"}'), /project/);
  assert.throws(() => parseTeam(JSON.stringify({ project: PROJECT, lead: LEAD, members: [{ id: ANA }] })), /label/);
  assert.deepEqual(personFilters(TEAM).map((f) => f.label), ["Todos", "Yo", "Ana", "Ben", "Sin asignar"]);
});

test("catalog: reused for 30 minutes unless the server, the project, or the item set changes", () => {
  const at = Date.parse("2026-11-02T12:00:00Z");
  const previous = { catalogAt: "2026-11-02T12:00:00Z", identifier: "ABC", baseUrl: "http://p", project: PROJECT,
    moduleIds: {}, states: {}, members: {}, modules: [], items: [{ id: "a" }, { id: "b" }] };
  assert.ok(reusableCatalog(previous, ["a", "b"], "http://p", PROJECT, at + 6 * 60000), "6 minutes later, same items");
  assert.ok(reusableCatalog(previous, ["a"], "http://p", PROJECT, at), "an item gone is fine");
  assert.equal(reusableCatalog(previous, ["a", "c"], "http://p", PROJECT, at), null, "new item");
  assert.equal(reusableCatalog(previous, ["a"], "http://p", PROJECT, at + 31 * 60000), null, "too old");
  assert.equal(reusableCatalog(previous, ["a"], "http://q", PROJECT, at), null, "other server");
  assert.equal(reusableCatalog(previous, ["a"], "http://p", OTHER, at), null, "other project");
  assert.equal(reusableCatalog({ ...previous, identifier: undefined }, ["a"], "http://p", PROJECT, at), null, "cache from an older version");
});
