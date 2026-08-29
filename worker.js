/**
 * Comisario Principal — Worker
 *
 * Sirve el frontend estático desde /public y expone una API simple
 * para guardar/leer los datos en Workers KV.
 *
 * Modelo de datos en KV:
 *   - "index"          -> JSON: [{ id, nombre, fechaInicio, fechaFin, actualizado }]  (lista de eventos)
 *   - "event:<id>"     -> JSON: { id, nombre, fechaInicio, fechaFin, tareas: [...], actualizado }
 *
 * La app funciona sin login. El acceso se controla por conocer el enlace.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function bad(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ---- API ----
    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, pathname);
      } catch (err) {
        return bad("Error interno: " + (err && err.message ? err.message : String(err)), 500);
      }
    }

    // ---- Frontend estático ----
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, pathname) {
  const kv = env.COMISARIO_KV;
  if (!kv) return bad("KV no configurado en el Worker.", 500);

  // GET /api/events  -> lista de eventos (índice)
  if (pathname === "/api/events" && request.method === "GET") {
    const idx = await kv.get("index", "json");
    return json({ ok: true, events: Array.isArray(idx) ? idx : [] });
  }

  // GET /api/event/:id  -> un evento completo con sus tareas
  const eventMatch = pathname.match(/^\/api\/event\/([A-Za-z0-9_-]+)$/);
  if (eventMatch && request.method === "GET") {
    const id = eventMatch[1];
    const ev = await kv.get("event:" + id, "json");
    if (!ev) return bad("Evento no encontrado.", 404);
    return json({ ok: true, event: ev });
  }

  // PUT /api/event/:id  -> crear/actualizar un evento completo
  if (eventMatch && request.method === "PUT") {
    const id = eventMatch[1];
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Cuerpo inválido.");

    const event = {
      id,
      nombre: String(body.nombre || "Evento sin nombre"),
      fechaInicio: body.fechaInicio || null,
      fechaFin: body.fechaFin || null,
      tareas: Array.isArray(body.tareas) ? body.tareas : [],
      actualizado: new Date().toISOString(),
    };

    await kv.put("event:" + id, JSON.stringify(event));

    // Actualizar el índice
    const idx = (await kv.get("index", "json")) || [];
    const entry = {
      id,
      nombre: event.nombre,
      fechaInicio: event.fechaInicio,
      fechaFin: event.fechaFin,
      actualizado: event.actualizado,
    };
    const pos = idx.findIndex((e) => e.id === id);
    if (pos >= 0) idx[pos] = entry;
    else idx.push(entry);
    await kv.put("index", JSON.stringify(idx));

    return json({ ok: true, event });
  }

  // DELETE /api/event/:id  -> eliminar evento
  if (eventMatch && request.method === "DELETE") {
    const id = eventMatch[1];
    await kv.delete("event:" + id);
    const idx = (await kv.get("index", "json")) || [];
    const next = idx.filter((e) => e.id !== id);
    await kv.put("index", JSON.stringify(next));
    return json({ ok: true });
  }

  return bad("Ruta no encontrada.", 404);
}
