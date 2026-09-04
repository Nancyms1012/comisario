/* ===== Comisario Principal — app principal (edición) ===== */

const LS_KEY = "comisario_v1";
const API = {
  events: "/api/events",
  event: (id) => "/api/event/" + id,
};

// Estado en memoria
let state = {
  eventsIndex: [],   // [{id, nombre, fechaInicio, fechaFin, actualizado}]
  currentId: null,   // id del evento seleccionado
  event: null,       // evento completo cargado { id, nombre, fechaInicio, fechaFin, tareas: [] }
  online: true,      // si la API en la nube responde
};

const CATEGORIAS = ["Reunión", "Briefing", "Control técnico", "Seguridad", "Cronometraje", "Logística", "Premiación", "Otro"];

/* ---------- Utilidades ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtFecha(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtFechaCorta(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es-CR", { weekday: "short", day: "numeric", month: "short" });
}

// Devuelve array de fechas ISO (YYYY-MM-DD) entre inicio y fin, inclusive
function rangoDias(inicio, fin) {
  const dias = [];
  if (!inicio || !fin) return dias;
  const [y1, m1, d1] = inicio.split("-").map(Number);
  const [y2, m2, d2] = fin.split("-").map(Number);
  let cur = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  let guard = 0;
  while (cur <= end && guard < 366) {
    const iso = cur.getFullYear() + "-" + String(cur.getMonth() + 1).padStart(2, "0") + "-" + String(cur.getDate()).padStart(2, "0");
    dias.push(iso);
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return dias;
}

function toast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2600);
}

function setSync(status) {
  const el = $("#syncStatus");
  el.className = "sync-status " + (status.cls || "");
  el.textContent = status.txt;
}

/* ---------- Persistencia local (fallback / caché) ---------- */
function saveLocal() {
  try {
    const data = { eventsIndex: state.eventsIndex, currentId: state.currentId };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    if (state.event) localStorage.setItem(LS_KEY + ":ev:" + state.event.id, JSON.stringify(state.event));
  } catch (e) { /* almacenamiento lleno o bloqueado */ }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.eventsIndex = data.eventsIndex || [];
      state.currentId = data.currentId || null;
    }
  } catch (e) { /* ignore */ }
}
function loadLocalEvent(id) {
  try {
    const raw = localStorage.getItem(LS_KEY + ":ev:" + id);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ---------- API nube ---------- */
async function apiGetEvents() {
  const r = await fetch(API.events);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return j.events || [];
}
async function apiGetEvent(id) {
  const r = await fetch(API.event(id));
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return j.event;
}
async function apiPutEvent(ev) {
  const r = await fetch(API.event(ev.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ev),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return j.event;
}
async function apiDeleteEvent(id) {
  const r = await fetch(API.event(id), { method: "DELETE" });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

/* ---------- Guardado del evento actual ---------- */
async function persistEvent() {
  if (!state.event) return;
  state.event.actualizado = new Date().toISOString();
  // actualizar índice local
  const entry = {
    id: state.event.id,
    nombre: state.event.nombre,
    fechaInicio: state.event.fechaInicio,
    fechaFin: state.event.fechaFin,
    actualizado: state.event.actualizado,
  };
  const pos = state.eventsIndex.findIndex((e) => e.id === entry.id);
  if (pos >= 0) state.eventsIndex[pos] = entry; else state.eventsIndex.push(entry);
  saveLocal();

  setSync({ cls: "saving", txt: "Guardando…" });
  try {
    await apiPutEvent(state.event);
    state.online = true;
    setSync({ cls: "ok", txt: "Guardado ☁️" });
  } catch (e) {
    state.online = false;
    setSync({ cls: "error", txt: "Sin conexión (local)" });
  }
}

/* ---------- Carga inicial ---------- */
async function init() {
  loadLocal();
  bindEvents();

  setSync({ cls: "saving", txt: "Cargando…" });
  try {
    const cloud = await apiGetEvents();
    state.eventsIndex = cloud;
    state.online = true;
    setSync({ cls: "ok", txt: "Conectado ☁️" });
  } catch (e) {
    state.online = false;
    setSync({ cls: "error", txt: "Sin conexión (local)" });
  }
  saveLocal();

  // Seleccionar evento
  if (state.eventsIndex.length) {
    const exists = state.eventsIndex.some((e) => e.id === state.currentId);
    if (!exists) state.currentId = state.eventsIndex[0].id;
    await selectEvent(state.currentId);
  } else {
    state.currentId = null;
    state.event = null;
  }
  renderAll();
}

async function selectEvent(id) {
  state.currentId = id;
  if (!id) { state.event = null; return; }
  let ev = null;
  if (state.online) {
    try { ev = await apiGetEvent(id); } catch (e) { ev = null; }
  }
  if (!ev) ev = loadLocalEvent(id);
  if (!ev) {
    // reconstruir desde índice si no hay tareas guardadas
    const idx = state.eventsIndex.find((e) => e.id === id);
    ev = idx ? { ...idx, tareas: [] } : null;
  }
  state.event = ev;
  saveLocal();
}

/* ---------- Render ---------- */
function renderAll() {
  renderEventSelect();
  const hasEvents = state.eventsIndex.length > 0;
  $("#emptyState").hidden = hasEvents;
  $("#eventHeader").hidden = !hasEvents || !state.event;
  $("#taskToolbar").hidden = !hasEvents || !state.event;
  renderEventHeader();
  renderFilters();
  renderDays();
}

function renderEventSelect() {
  const sel = $("#eventSelect");
  sel.innerHTML = "";
  if (!state.eventsIndex.length) {
    const o = document.createElement("option");
    o.textContent = "— Sin eventos —";
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  state.eventsIndex
    .slice()
    .sort((a, b) => (a.fechaInicio || "").localeCompare(b.fechaInicio || ""))
    .forEach((e) => {
      const o = document.createElement("option");
      o.value = e.id;
      o.textContent = e.nombre;
      if (e.id === state.currentId) o.selected = true;
      sel.appendChild(o);
    });
}

function renderEventHeader() {
  if (!state.event) return;
  $("#eventTitle").textContent = state.event.nombre;
  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  const rango = dias.length === 1
    ? fmtFecha(state.event.fechaInicio)
    : fmtFechaCorta(state.event.fechaInicio) + " → " + fmtFechaCorta(state.event.fechaFin) + "  (" + dias.length + " días)";
  $("#eventDates").textContent = rango;

  const tareas = state.event.tareas || [];
  const total = tareas.length;
  const comp = tareas.filter((t) => t.estado === "completada").length;
  const pend = tareas.filter((t) => t.estado === "pendiente").length;
  const proc = tareas.filter((t) => t.estado === "en-proceso").length;
  $("#eventStats").innerHTML = `
    <span class="stat"><b>${total}</b> tareas</span>
    <span class="stat"><b>${pend}</b> pendientes</span>
    <span class="stat"><b>${proc}</b> en proceso</span>
    <span class="stat"><b>${comp}</b> completadas</span>
  `;
}

function renderFilters() {
  if (!state.event) return;
  // Filtro por día
  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  const fd = $("#filtroDia");
  const prevDia = fd.value;
  fd.innerHTML = '<option value="">Todos</option>';
  dias.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d;
    o.textContent = "Día " + (i + 1) + " · " + fmtFechaCorta(d);
    fd.appendChild(o);
  });
  fd.value = prevDia;

  // Filtro por categoría
  const fc = $("#filtroCategoria");
  const prevCat = fc.value;
  fc.innerHTML = '<option value="">Todas</option>';
  CATEGORIAS.forEach((c) => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    fc.appendChild(o);
  });
  fc.value = prevCat;
}

function tareasFiltradas() {
  if (!state.event) return [];
  const fDia = $("#filtroDia").value;
  const fEst = $("#filtroEstado").value;
  const fCat = $("#filtroCategoria").value;
  return (state.event.tareas || []).filter((t) => {
    if (fEst && t.estado !== fEst) return false;
    if (fCat && t.categoria !== fCat) return false;
    if (fDia && !(t.dias || []).includes(fDia)) return false;
    return true;
  });
}

function renderDays() {
  const cont = $("#daysContainer");
  cont.innerHTML = "";
  if (!state.event) return;

  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  const fDia = $("#filtroDia").value;
  const diasMostrar = fDia ? dias.filter((d) => d === fDia) : dias;
  const tareas = tareasFiltradas();

  diasMostrar.forEach((dia, idxGlobal) => {
    const numDia = dias.indexOf(dia) + 1;
    const delDia = tareas
      .filter((t) => (t.dias || []).includes(dia))
      .sort((a, b) => (a.hora || "99:99").localeCompare(b.hora || "99:99"));

    const block = document.createElement("div");
    block.className = "day-block";
    block.innerHTML = `
      <div class="day-head">
        <h3>Día ${numDia} · ${fmtFecha(dia)}</h3>
        <span class="day-count">${delDia.length} tarea${delDia.length === 1 ? "" : "s"}</span>
      </div>
      <div class="day-body"></div>
    `;
    const body = block.querySelector(".day-body");

    if (!delDia.length) {
      const empty = document.createElement("div");
      empty.className = "task-row";
      empty.innerHTML = `<div></div><div></div><div class="task-main"><span class="task-notas">Sin tareas para este día.</span></div><div></div>`;
      body.appendChild(empty);
    } else {
      delDia.forEach((t) => body.appendChild(renderTaskRow(t)));
    }
    cont.appendChild(block);
  });
}

function renderTaskRow(t) {
  const row = document.createElement("div");
  row.className = "task-row" + (t.estado === "completada" ? " done" : "");

  const multi = (t.dias || []).length > 1 ? ` <span class="badge badge-cat" title="Tarea en varios días">×${t.dias.length} días</span>` : "";

  row.innerHTML = `
    <div class="task-check">
      <input type="checkbox" ${t.estado === "completada" ? "checked" : ""} data-check="${t.id}" title="Marcar como completada" />
    </div>
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
    <div class="task-actions no-print">
      <button class="icon-btn" data-edit="${t.id}" title="Editar">✏️</button>
      <button class="icon-btn" data-del="${t.id}" title="Eliminar">🗑️</button>
    </div>
  `;
  return row;
}

function labelPrioridad(p) { return { alta: "Alta", media: "Media", baja: "Baja" }[p] || "Media"; }
function labelEstado(e) { return { pendiente: "Pendiente", "en-proceso": "En proceso", completada: "Completada" }[e] || "Pendiente"; }

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* ---------- Modal Evento ---------- */
let editandoEvento = false;

function abrirModalEvento(edit) {
  editandoEvento = !!edit;
  $("#modalEventoTitle").textContent = edit ? "Editar evento" : "Nuevo evento";
  if (edit && state.event) {
    $("#evNombre").value = state.event.nombre;
    $("#evInicio").value = state.event.fechaInicio || "";
    $("#evFin").value = state.event.fechaFin || "";
  } else {
    $("#formEvento").reset();
  }
  openModal("modalEvento");
}

async function submitEvento(e) {
  e.preventDefault();
  const nombre = $("#evNombre").value.trim();
  const inicio = $("#evInicio").value;
  const fin = $("#evFin").value;
  if (!nombre || !inicio || !fin) return;
  if (fin < inicio) { toast("La fecha de fin no puede ser anterior al inicio.", true); return; }

  if (editandoEvento && state.event) {
    state.event.nombre = nombre;
    state.event.fechaInicio = inicio;
    state.event.fechaFin = fin;
    // limpiar días de tareas que quedaron fuera del nuevo rango
    const dias = rangoDias(inicio, fin);
    (state.event.tareas || []).forEach((t) => {
      t.dias = (t.dias || []).filter((d) => dias.includes(d));
    });
    await persistEvent();
  } else {
    const ev = { id: uid(), nombre, fechaInicio: inicio, fechaFin: fin, tareas: [] };
    state.event = ev;
    state.currentId = ev.id;
    await persistEvent();
  }
  closeModal("modalEvento");
  renderAll();
  toast("Evento guardado.");
}

async function eliminarEvento() {
  if (!state.event) return;
  if (!confirm(`¿Eliminar el evento "${state.event.nombre}" y todas sus tareas?`)) return;
  const id = state.event.id;
  state.eventsIndex = state.eventsIndex.filter((e) => e.id !== id);
  try { localStorage.removeItem(LS_KEY + ":ev:" + id); } catch (e) {}
  if (state.online) { try { await apiDeleteEvent(id); } catch (e) {} }
  state.currentId = state.eventsIndex[0]?.id || null;
  await selectEvent(state.currentId);
  saveLocal();
  renderAll();
  toast("Evento eliminado.");
}

/* ---------- Modal Tarea ---------- */
function renderDaysPicker(seleccionados) {
  const cont = $("#tDiasChecks");
  cont.innerHTML = "";
  if (!state.event) {
    cont.innerHTML = '<p class="hint" style="color:#d32f2f">Primero creá un evento con sus fechas.</p>';
    return;
  }
  const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
  if (!dias.length) {
    cont.innerHTML = '<p class="hint" style="color:#d32f2f">Este evento no tiene fechas válidas. Editá el evento y poné fecha de inicio y fin.</p>';
    return;
  }
  dias.forEach((d, i) => {
    const id = "dia_" + i;
    const wrap = document.createElement("label");
    wrap.className = "day-check" + (seleccionados.includes(d) ? " checked" : "");
    wrap.innerHTML = `<input type="checkbox" value="${d}" id="${id}" ${seleccionados.includes(d) ? "checked" : ""}/> Día ${i + 1} · ${fmtFechaCorta(d)}`;
    const cb = wrap.querySelector("input");
    cb.addEventListener("change", () => wrap.classList.toggle("checked", cb.checked));
    cont.appendChild(wrap);
  });
}

function diasSeleccionados() {
  return $$("#tDiasChecks input:checked").map((c) => c.value);
}

function abrirModalTarea(tarea) {
  $("#modalTareaTitle").textContent = tarea ? "Editar tarea" : "Nueva tarea";
  $("#formTarea").reset();
  $("#tId").value = tarea ? tarea.id : "";
  if (tarea) {
    $("#tDescripcion").value = tarea.descripcion || "";
    $("#tResponsable").value = tarea.responsable || "";
    $("#tHora").value = tarea.hora || "";
    $("#tLugar").value = tarea.lugar || "";
    $("#tCategoria").value = tarea.categoria || "Reunión";
    $("#tPrioridad").value = tarea.prioridad || "media";
    $("#tEstado").value = tarea.estado || "pendiente";
    $("#tNotas").value = tarea.notas || "";
    renderDaysPicker(tarea.dias || []);
  } else {
    // por defecto marcar el día del filtro, o el primer día
    const fDia = $("#filtroDia").value;
    const dias = rangoDias(state.event.fechaInicio, state.event.fechaFin);
    renderDaysPicker(fDia ? [fDia] : (dias.length === 1 ? [dias[0]] : []));
  }
  openModal("modalTarea");
}

async function submitTarea(e) {
  e.preventDefault();
  const dias = diasSeleccionados();
  if (!dias.length) { toast("Seleccioná al menos un día.", true); return; }
  const desc = $("#tDescripcion").value.trim();
  if (!desc) return;

  const id = $("#tId").value;
  const datos = {
    descripcion: desc,
    responsable: $("#tResponsable").value.trim(),
    hora: $("#tHora").value,
    lugar: $("#tLugar").value.trim(),
    categoria: $("#tCategoria").value,
    prioridad: $("#tPrioridad").value,
    estado: $("#tEstado").value,
    notas: $("#tNotas").value.trim(),
    dias,
  };

  if (id) {
    const t = state.event.tareas.find((x) => x.id === id);
    if (t) Object.assign(t, datos);
  } else {
    state.event.tareas.push({ id: uid(), ...datos });
  }
  await persistEvent();
  closeModal("modalTarea");
  renderAll();
  toast(id ? "Tarea actualizada." : "Tarea agregada.");
}

async function toggleCompletada(id, checked) {
  const t = state.event.tareas.find((x) => x.id === id);
  if (!t) return;
  t.estado = checked ? "completada" : "pendiente";
  await persistEvent();
  renderAll();
}

async function eliminarTarea(id) {
  const t = state.event.tareas.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`¿Eliminar la tarea "${t.descripcion}"?`)) return;
  state.event.tareas = state.event.tareas.filter((x) => x.id !== id);
  await persistEvent();
  renderAll();
  toast("Tarea eliminada.");
}

/* ---------- Modales helpers ---------- */
function openModal(id) { $("#" + id).hidden = false; }
function closeModal(id) { $("#" + id).hidden = true; }

/* ---------- Eventos DOM ---------- */
function bindEvents() {
  $("#eventSelect").addEventListener("change", async (e) => {
    await selectEvent(e.target.value);
    renderAll();
  });
  $("#btnNuevoEvento").addEventListener("click", () => abrirModalEvento(false));
  $("#btnCrearPrimero").addEventListener("click", () => abrirModalEvento(false));
  $("#btnEditarEvento").addEventListener("click", () => { if (state.event) abrirModalEvento(true); });
  $("#btnEliminarEvento").addEventListener("click", eliminarEvento);
  $("#formEvento").addEventListener("submit", submitEvento);

  $("#btnNuevaTarea").addEventListener("click", () => {
    if (!state.event) { toast("Primero creá un evento para poder agregar tareas.", true); return; }
    abrirModalTarea(null);
  });
  $("#formTarea").addEventListener("submit", submitTarea);
  $("#btnTodosDias").addEventListener("click", () => {
    $$("#tDiasChecks input").forEach((c) => { c.checked = true; c.closest(".day-check").classList.add("checked"); });
  });
  $("#btnNingunDia").addEventListener("click", () => {
    $$("#tDiasChecks input").forEach((c) => { c.checked = false; c.closest(".day-check").classList.remove("checked"); });
  });

  ["filtroDia", "filtroEstado", "filtroCategoria"].forEach((id) =>
    $("#" + id).addEventListener("change", renderDays));

  $("#btnImprimir").addEventListener("click", () => window.print());

  // Delegación para acciones de tareas
  $("#daysContainer").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    if (edit) {
      const t = state.event.tareas.find((x) => x.id === edit.dataset.edit);
      if (t) abrirModalTarea(t);
    } else if (del) {
      eliminarTarea(del.dataset.del);
    }
  });
  $("#daysContainer").addEventListener("change", (e) => {
    const chk = e.target.closest("[data-check]");
    if (chk) toggleCompletada(chk.dataset.check, chk.checked);
  });

  // Cerrar modales
  $$("[data-close-modal]").forEach((b) =>
    b.addEventListener("click", () => closeModal(b.dataset.closeModal)));
  $$(".modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.hidden = true; }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $$(".modal-backdrop").forEach((bd) => (bd.hidden = true));
  });
}

document.addEventListener("DOMContentLoaded", init);
