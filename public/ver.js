/* ===== Comisario Principal — vista de consulta (solo lectura) ===== */

const API = {
  events: "/api/events",
  event: (id) => "/api/event/" + id,
};

let state = { eventsIndex: [], currentId: null, event: null };

const CATEGORIAS = ["Reunión", "Briefing", "Control técnico", "Seguridad", "Cronometraje", "Logística", "Premiación", "Otro"];

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function fmtFecha(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmtFechaCorta(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-CR", { weekday: "short", day: "numeric", month: "short" });
}
function rangoDias(inicio, fin) {
  const dias = [];
  if (!inicio || !fin) return dias;
  const [y1, m1, d1] = inicio.split("-").map(Number);
  const [y2, m2, d2] = fin.split("-").map(Number);
  let cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  let g = 0;
  while (cur <= end && g < 366) {
    dias.push(cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0"));
    cur.setDate(cur.getDate() + 1); g++;
  }
  return dias;
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function labelPrioridad(p) { return { alta: "Alta", media: "Media", baja: "Baja" }[p] || "Media"; }
function labelEstado(e) { return { pendiente: "Pendiente", "en-proceso": "En proceso", completada: "Completada" }[e] || "Pendiente"; }
function setSync(cls, txt) { const el = $("#syncStatus"); el.className = "sync-status " + cls; el.textContent = txt; }

/* ---- API (solo GET) ---- */
async function apiGetEvents() {
  const r = await fetch(API.events);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).events || [];
}
async function apiGetEvent(id) {
  const r = await fetch(API.event(id));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).event;
}

/* ---- Permitir enlace directo: ver.html?evento=<id>&responsable=<nombre> ---- */
function getParams() {
  const p = new URLSearchParams(location.search);
  return { evento: p.get("evento"), responsable: p.get("responsable") };
}

async function init() {
  bind();
  setSync("saving", "Cargando…");
  try {
    state.eventsIndex = await apiGetEvents();
    setSync("ok", "Conectado ☁️");
  } catch (e) {
    setSync("error", "Sin conexión");
    state.eventsIndex = [];
  }

  const params = getParams();
  renderEventSelect();

  if (state.eventsIndex.length) {
    const target = params.evento && state.eventsIndex.some((e) => e.id === params.evento)
      ? params.evento
      : state.eventsIndex[0].id;
    await selectEvent(target);
    $("#eventSelect").value = target;
    if (params.responsable) {
      // aplicar tras poblar el filtro
      pendingResponsable = params.responsable;
    }
  }
  renderAll();
}

let pendingResponsable = null;

async function selectEvent(id) {
  state.currentId = id;
  try { state.event = await apiGetEvent(id); }
  catch (e) { state.event = null; }
}

function renderEventSelect() {
  const sel = $("#eventSelect");
  sel.innerHTML = "";
  if (!state.eventsIndex.length) {
    sel.innerHTML = '<option>— Sin eventos —</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  state.eventsIndex
    .slice()
    .sort((a, b) => (a.fechaInicio || "").localeCompare(b.fechaInicio || ""))
    .forEach((e) => {
      const o = document.createElement("option");
      o.value = e.id; o.textContent = e.nombre;
      sel.appendChild(o);
    });
}

function renderAll() {
  const has = !!state.event;
  $("#eventHeader").hidden = !has;
  renderResponsables();
  renderDiaFilter();
  renderHeader();
  renderDays();
}

function renderResponsables() {
  const fr = $("#filtroResponsable");
  const prev = fr.value;
  fr.innerHTML = '<option value="">Todos</option>';
  if (!state.event) return;
  const nombres = [...new Set((state.event.tareas || []).map((t) => t.responsable).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  nombres.forEach((n) => {
    const o = document.createElement("option");
    o.value = n; o.textContent = n;
    fr.appendChild(o);
  });
  if (pendingResponsable && nombres.includes(pendingResponsable)) {
    fr.value = pendingResponsable;
    pendingResponsable = null;
  } else {
    fr.value = prev;
  }
}

function renderDiaFilter() {
  const fd = $("#filtroDia");
  const prev = fd.value;
  fd.innerHTML = '<option value="">Todos</option>';
  if (!state.event) return;
  rangoDias(state.event.fechaInicio, state.event.fechaFin).forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d; o.textContent = "Día " + (i + 1) + " · " + fmtFechaCorta(d);
    fd.appendChild(o);
  });
  fd.value = prev;
}

function renderHeader() {
  if (!state.event) return;
  $("#eventTitle").textContent = state.event.nombre;
  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  $("#eventDates").textContent = dias.length === 1
    ? fmtFecha(state.event.fechaInicio)
    : fmtFechaCorta(state.event.fechaInicio) + " → " + fmtFechaCorta(state.event.fechaFin) + " (" + dias.length + " días)";

  const t = tareasFiltradas();
  const comp = t.filter((x) => x.estado === "completada").length;
  const pend = t.filter((x) => x.estado === "pendiente").length;
  const proc = t.filter((x) => x.estado === "en-proceso").length;
  $("#eventStats").innerHTML = `
    <span class="stat"><b>${t.length}</b> tareas</span>
    <span class="stat"><b>${pend}</b> pendientes</span>
    <span class="stat"><b>${proc}</b> en proceso</span>
    <span class="stat"><b>${comp}</b> completadas</span>
  `;
  const resp = $("#filtroResponsable").value;
  const note = $("#filterNote");
  if (resp) { note.hidden = false; note.textContent = "Mostrando solo las tareas de: " + resp; }
  else note.hidden = true;
}

function tareasFiltradas() {
  if (!state.event) return [];
  const fResp = $("#filtroResponsable").value;
  const fEst = $("#filtroEstado").value;
  const fDia = $("#filtroDia").value;
  return (state.event.tareas || []).filter((t) => {
    if (fResp && t.responsable !== fResp) return false;
    if (fEst && t.estado !== fEst) return false;
    if (fDia && !(t.dias || []).includes(fDia)) return false;
    return true;
  });
}

function renderDays() {
  const cont = $("#daysContainer");
  cont.innerHTML = "";
  const has = !!state.event;
  const tareas = tareasFiltradas();
  $("#emptyState").hidden = has && tareas.length > 0;
  if (!has) return;

  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  const fDia = $("#filtroDia").value;
  const diasMostrar = fDia ? dias.filter((d) => d === fDia) : dias;

  diasMostrar.forEach((dia) => {
    const numDia = dias.indexOf(dia) + 1;
    const delDia = tareas
      .filter((t) => (t.dias || []).includes(dia))
      .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));
    if (!delDia.length && (fDia || tareas.length)) {
      // ocultar días vacíos cuando hay filtro de responsable/estado activo para no ensuciar
      const fResp = $("#filtroResponsable").value, fEst = $("#filtroEstado").value;
      if (fResp || fEst) return;
    }

    const block = document.createElement("div");
    block.className = "day-block";
    block.innerHTML = `
      <div class="day-head">
        <h3>Día ${numDia} · ${fmtFecha(dia)}</h3>
        <span class="day-count">${delDia.length} tarea${delDia.length === 1 ? "" : "s"}</span>
      </div>
      <div class="day-body"></div>`;
    const body = block.querySelector(".day-body");
    if (!delDia.length) {
      body.innerHTML = `<div class="task-row"><div></div><div></div><div class="task-main"><span class="task-notas">Sin tareas para este día.</span></div><div></div></div>`;
    } else {
      delDia.forEach((t) => body.appendChild(renderTaskRow(t)));
    }
    cont.appendChild(block);
  });
}

function renderTaskRow(t) {
  const row = document.createElement("div");
  row.className = "task-row" + (t.estado === "completada" ? " done" : "");
  const multi = (t.dias || []).length > 1 ? ` <span class="badge badge-cat">×${t.dias.length} días</span>` : "";
  row.innerHTML = `
    <div class="task-check">${t.estado === "completada" ? "✅" : "⬜"}</div>
    <div class="task-time ${t.hora ? "" : "empty"}">${t.hora || "—"}</div>
    <div class="task-main">
      <div class="task-desc">${escapeHtml(t.descripcion)}${multi}</div>
      <div class="task-meta">
        ${t.responsable ? `<span class="meta-item">👤 ${escapeHtml(t.responsable)}</span>` : ""}
        ${t.lugar ? `<span class="meta-item">📍 ${escapeHtml(t.lugar)}</span>` : ""}
        ${t.categoria ? `<span class="badge badge-cat">${escapeHtml(t.categoria)}</span>` : ""}
        <span class="badge badge-prio-${t.prioridad || "media"}">${labelPrioridad(t.prioridad)}</span>
        <span class="badge badge-estado-${t.estado || "pendiente"}">${labelEstado(t.estado)}</span>
      </div>
      ${t.notas ? `<div class="task-notas">${escapeHtml(t.notas)}</div>` : ""}
    </div>
    <div></div>`;
  return row;
}

function bind() {
  $("#eventSelect").addEventListener("change", async (e) => {
    await selectEvent(e.target.value);
    renderAll();
  });
  ["filtroResponsable", "filtroDia", "filtroEstado"].forEach((id) =>
    $("#" + id).addEventListener("change", () => { renderHeader(); renderDays(); }));
  $("#btnImprimir").addEventListener("click", () => window.print());
}

document.addEventListener("DOMContentLoaded", init);
