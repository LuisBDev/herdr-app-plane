import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, InputState, Input } from "gpui-base";
import { theme, props, appHome, home, readTextFile, writeTextFile } from "herdr";
import { fetchSnapshot, browseUrl } from "./plane.js";
import {
  ORIGINS, ORIGIN_FILTERS, PERIODS, DEFAULT_FILTERS, PRIORITIES, personFilters, parseTeam,
  origin, filterItems, groupByModule, isOpen, isOverdue, ddmm, hhmm, dateTime, initials,
  periodDays, stateColor,
} from "./model.js";

const CACHE = () => appHome() + "/data/plane-board.json";
const TEAM_FILE = () => home() + "/.plane_board.json";
const STORE = "plane-board";
const REFRESH_MS = 5 * 60 * 1000;
const FRESH_ENOUGH_MS = 2 * 60 * 1000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ORIGIN_COLOR = { propia: "ansi4", delegada: "ansi5", equipo: "ansi2", externa: "ansi3" };
const ROW_H = 30;

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return { filters: { ...DEFAULT_FILTERS, ...saved.filters }, collapsed: new Set(saved.collapsed ?? []) };
  } catch {
    return { filters: { ...DEFAULT_FILTERS }, collapsed: new Set() };
  }
}

async function writeCache(snapshot) {
  const text = JSON.stringify(snapshot);
  for (let attempt = 0; ; attempt++) {
    const current = await readTextFile(CACHE());
    try { return await writeTextFile(CACHE(), text, current); } catch (e) { if (attempt) throw e; }
  }
}

export default class PlaneBoard extends View {
  init(_props, cx) {
    const prefs = loadPrefs();
    this.filters = prefs.filters;
    this.collapsed = prefs.collapsed;
    this.snapshot = null;
    this.descriptions = new Map();
    this.load = { kind: "loading" };
    this.selected = props()?.selected ?? null;
    this.refreshing = false;
    this.query = "";
    this.search = InputState.new({ placeholder: "Buscar por número o nombre" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.days = InputState.new({ placeholder: "días" });
    if (!PERIODS.some((p) => p.key === this.filters.period)) this.days.set_value(this.filters.period);
    this.days.on("change", (_e, cx) => {
      const v = this.days.value().trim();
      if (/^\d+$/.test(v) && periodDays(v) === Number(v)) this.setFilter("period", String(Number(v)), cx);
    });
    this.team = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(TEAM_FILE());
        if (text === null) throw new Error("no existe ~/.plane_board.json");
        this.team = parseTeam(text);
      } catch (e) {
        this.load = { kind: "setup", reason: String(e?.message ?? e) };
        return cx.notify();
      }
      try {
        const cached = JSON.parse(await readTextFile(CACHE()) ?? "null");
        if (cached?.project === this.team.project) { this.snapshot = cached; this.load = { kind: "stale", reason: null }; }
      } catch (e) { console.error(`plane-board: caché ilegible: ${e}`); }
      cx.notify();
      const age = this.snapshot ? Date.now() - Date.parse(this.snapshot.fetchedAt) : Infinity;
      if (age < FRESH_ENOUGH_MS && !props()?.baseUrl) this.load = { kind: "fresh" };
      else this.refresh(cx, false);
    });
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx, false));
  }

  refresh(cx, full) {
    if (this.refreshing || !this.team) return;
    this.refreshing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { snapshot, descriptions } = await fetchSnapshot(cx, this.team, props()?.baseUrl, this.snapshot, full);
        this.snapshot = snapshot;
        this.descriptions = descriptions;
        this.load = { kind: "fresh" };
        await writeCache(snapshot).catch((e) => console.error(`plane-board: no se pudo guardar el caché: ${e}`));
      } catch (e) {
        const reason = String(e?.message ?? e);
        this.load = this.snapshot ? { kind: "stale", reason } : { kind: "offline", reason };
      } finally {
        this.refreshing = false;
        cx.notify();
      }
    });
  }

  savePrefs() {
    try { localStorage.setItem(STORE, JSON.stringify({ filters: this.filters, collapsed: [...this.collapsed] })); } catch {}
  }

  setFilter(group, key, cx) {
    this.filters = { ...this.filters, [group]: key };
    this.savePrefs();
    cx.notify();
  }

  toggleSection(id, cx) {
    if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
    this.savePrefs();
    cx.notify();
  }

  segmented(group, options, t) {
    return h_flex().flex_none().h(26).p(2).gap(2).rounded(7).border_1().border_color(t.border).bg(t.surface).children(options.map((o) => {
      const on = this.filters[group] === o.key;
      return div().id(`f-${group}-${o.key}`).h_full().px(8).flex().items_center().rounded(5).text_size(12).cursor_pointer()
        .text_color(on ? t.foreground : t.muted).when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (group === "period") this.days.set_value("");
          this.setFilter(group, o.key, cx);
        }).child(o.label);
    }));
  }

  textBox(id, state, width, t) {
    return div().id(id).w(width).h(26).flex_none().px(8).flex().items_center().rounded(7).border_1().border_color(t.border)
      .bg(t.surface).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).h_full().w_full().text_size(12).text_color(t.foreground));
  }

  topBar(t) {
    const fetched = this.snapshot ? `act. ${hhmm(this.snapshot.fetchedAt)}` : "";
    return h_flex().flex_none().flex_wrap().px(14).py(8).gap(10).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().font_semibold().text_size(14).mr(4).child(`Plane · ${this.snapshot?.identifier ?? ""}`))
      .child(this.segmented("origin", ORIGIN_FILTERS, t))
      .child(this.segmented("person", this.team ? personFilters(this.team) : [], t))
      .child(this.segmented("period", PERIODS, t))
      .child(this.textBox("period-days", this.days, 56, t))
      .child(this.textBox("search", this.search, 220, t))
      .when(Boolean(this.query.trim()), (e) => e.child(div().text_size(11).text_color(t.dim).child("en todo el historial")))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(8).items_center()
        .child(div().text_size(12).text_color(t.dim).child(fetched))
        .child(div().id("refresh").w(26).h(26).flex().items_center().justify_center().rounded(6).border_1().border_color(t.border)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx, true))
          .child(this.refreshing ? div().text_color(t.accent).frames(SPINNER, 90) : div().text_color(t.muted).child("↻"))));
  }

  banner(t) {
    const { kind, reason } = this.load;
    if (kind !== "stale" || reason === null) return null;
    return h_flex().flex_none().px(14).py(6).gap(10).items_center().bg(t.blocked + "22").border_b(1).border_color(t.blocked + "55")
      .child(div().flex_none().text_color(t.blocked).font_semibold().child(`Plane no responde · datos de las ${hhmm(this.snapshot.fetchedAt)}`))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(reason));
  }

  centered(t, title, detail, spinning) {
    return v_flex().flex_1().items_center().justify_center().gap(6)
      .child(h_flex().gap(8).items_center()
        .when(spinning, (e) => e.child(div().text_color(t.accent).frames(SPINNER, 90)))
        .child(div().text_size(15).font_semibold().child(title)))
      .when(Boolean(detail), (e) => e.child(div().text_size(12).text_color(t.dim).child(detail)));
  }

  rows(sections) {
    const rows = [];
    for (const s of sections) {
      rows.push({ kind: "section", key: `s-${s.module.id}`, section: s });
      if (!this.collapsed.has(s.module.id))
        for (const item of s.items) rows.push({ kind: "item", key: `i-${s.module.id}-${item.id}`, item });
    }
    return rows;
  }

  sectionRow(s, t) {
    const folded = this.collapsed.has(s.module.id);
    return h_flex().w_full().h(ROW_H).flex_none().px(12).gap(8).items_center().bg(t.surface)
      .border_b(1).border_color(t.border).cursor_pointer().hover((h) => h.bg(t.hover))
      .child(div().w(12).text_color(t.dim).child(folded ? "▸" : "▾"))
      .when(Boolean(s.module.code), (e) => e.child(div().flex_none().font_semibold().text_color(t.accent).child(s.module.code)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted)
        .child(s.module.code ? s.module.name.slice(s.module.name.indexOf(" - ") + 3) : s.module.name))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(`${s.open} ${s.open === 1 ? "abierta" : "abiertas"} · ${s.items.length}`));
  }

  people(item) {
    const m = this.snapshot.members;
    const who = item.assignees.length ? item.assignees.map((a) => initials(m[a])).join(" ") : "—";
    return `${who} ← ${initials(m[item.createdBy])}`;
  }

  statePill(state, t) {
    const color = stateColor(state) ?? t.dim;
    return h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(10).bg(color + "38").text_size(11)
      .child(div().w(7).h(7).rounded(4).bg(color))
      .child(div().text_color(t.foreground).child(state?.name ?? "?"));
  }

  itemRow(item, t, now) {
    const states = this.snapshot.states, o = origin(item, this.team), open = isOpen(item, states);
    return h_flex().w_full().h(ROW_H).flex_none().pl(32).pr(12).gap(10).items_center()
      .cursor_pointer().when(this.selected === item.seq, (e) => e.bg(t.selected)).hover((h) => h.bg(t.hover))
      .child(div().w(62).flex_none().text_size(12).text_color(t.dim).child(`${this.snapshot.identifier}-${item.seq}`))
      .child(div().flex_1().min_w(0).truncate().text_color(open ? t.foreground : t.muted).child(item.name))
      .child(div().w(118).flex_none().flex().child(this.statePill(states[item.stateId], t)))
      .child(div().w(62).flex_none().text_size(11).text_color(t[ORIGIN_COLOR[o]]).child(ORIGINS[o]))
      .child(div().w(80).flex_none().truncate().text_size(11).text_color(t.muted).child(this.people(item)))
      .child(h_flex().w(92).flex_none().text_size(11).text_color(t.muted)
        .child(`${ddmm(item.start)} → `)
        .child(div().text_color(isOverdue(item, states, now) ? t.ansi1 : t.muted).child(ddmm(item.target))))
      .child(div().w(52).flex_none().text_size(11).text_color(item.priority === "urgent" || item.priority === "high" ? t.blocked : t.dim)
        .child(PRIORITIES[item.priority] ?? item.priority ?? "—"));
  }

  list(rows, t, now) {
    if (!rows.length) return this.centered(t, "Nada con estos filtros", "Prueba otro origen, persona o período.");
    return div().flex_1().h_full().min_w(0).min_h(0).relative()
      .child(v_virtual_list("plane-rows", rows.length, ROW_H, (i) => rows[i].key,
        (range) => rows.slice(range.start, range.end).map((r) => (r.kind === "section" ? this.sectionRow(r.section, t) : this.itemRow(r.item, t, now))))
        .absolute().inset_0()
        .on_item_click((key, cx) => {
          const row = rows.find((r) => r.key === key);
          if (row?.kind === "section") return this.toggleSection(row.section.module.id, cx);
          if (row) { this.selected = this.selected === row.item.seq ? null : row.item.seq; cx.notify(); }
        }))
      .child(Scrollbar.vertical("plane-rows").viewport_from_layout().absolute().inset_0());
  }

  field(label, value, t, color) {
    return h_flex().gap(10).items_start()
      .child(div().w(86).flex_none().text_size(11).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(12).text_color(color ?? t.foreground).child(value));
  }

  detail(item, t, now) {
    const s = this.snapshot, state = s.states[item.stateId], o = origin(item, this.team);
    const name = (id) => s.members[id]?.name || s.members[id]?.display || "desconocido";
    const text = this.descriptions.get(item.id);
    const description = text === undefined
      ? (this.load.kind === "fresh" ? "Descripción disponible tras actualizar (↻)" : "Descripción disponible al reconectar")
      : text || "Sin descripción.";
    return v_flex().w(400).h_full().flex_none().min_h(0).border_l(1).border_color(t.border).bg(t.surface)
      .child(h_flex().flex_none().px(14).pt(12).gap(8).items_center()
        .child(div().text_size(12).text_color(t.dim).child(`${this.snapshot.identifier}-${item.seq}`))
        .child(div().flex_1())
        .child(div().id("detail-close").w(22).h(22).flex().items_center().justify_center().rounded(5).text_color(t.muted)
          .cursor_pointer().hover((h) => h.bg(t.hover)).on_click((_e, cx) => { this.selected = null; cx.notify(); }).child("✕")))
      .child(div().flex_none().px(14).pt(4).pb(10).text_size(14).font_semibold().child(item.name))
      .child(v_flex().flex_none().px(14).pb(10).gap(6)
        .child(h_flex().gap(10).items_center().child(div().w(86).flex_none().text_size(11).text_color(t.dim).child("Estado")).child(this.statePill(state, t)))
        .child(this.field("Origen", ORIGINS[o], t, t[ORIGIN_COLOR[o]]))
        .child(this.field("Asignados", item.assignees.length ? item.assignees.map(name).join(", ") : "Sin asignar", t))
        .child(this.field("Creador", name(item.createdBy), t))
        .child(this.field("Fechas", `${ddmm(item.start)} → ${ddmm(item.target)}`, t, isOverdue(item, s.states, now) ? t.ansi1 : undefined))
        .child(this.field("Prioridad", PRIORITIES[item.priority] ?? "—", t))
        .child(this.field("Creado", dateTime(item.createdAt), t))
        .child(this.field("Actualizado", dateTime(item.updatedAt), t)))
      .child(div().flex_none().mx(14).mb(10).id("open-plane").h(30).flex().items_center().justify_center().rounded(7)
        .bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer()
        .on_click((_e, cx) => cx.open_url(browseUrl(s, item.seq))).child("Abrir en Plane"))
      .child(v_flex().id("detail-description").flex_1().min_h(0).overflow_y_scrollbar().px(14).py(10).gap(2).border_t(1).border_color(t.border)
        .text_size(12).text_color(text ? t.foreground : t.dim)
        .children(description.split("\n").map((line) => div().min_h(16).child(line))));
  }

  render(_cx) {
    const t = theme(), now = new Date();
    const banner = this.banner(t);
    const root = v_flex().id("plane-board").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.topBar(t)).when(Boolean(banner), (e) => e.child(banner));
    if (this.load.kind === "setup")
      return root.child(this.centered(t, "Falta configurar el tablero", `${this.load.reason}. El README explica el formato.`));
    if (this.load.kind === "loading") return root.child(this.centered(t, "Cargando Plane…", null, true));
    if (this.load.kind === "offline")
      return root.child(this.centered(t, "Plane no responde", `Aún no hay datos guardados. ${this.load.reason}`));
    const s = this.snapshot;
    const items = filterItems(s.items, s.states, this.filters, now, this.team, this.query);
    const sections = groupByModule(items, s.modules, s.states);
    const selected = this.selected === null ? null : s.items.find((i) => i.seq === Number(this.selected));
    return root.child(h_flex().w_full().flex_1().min_h(0).items_stretch()
      .child(this.list(this.rows(sections), t, now))
      .when(Boolean(selected), (e) => e.child(this.detail(selected, t, now))));
  }
}
