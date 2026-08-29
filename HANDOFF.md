# Comisario Principal — Organización de tareas de eventos

App para organizar las tareas cuando te toca el puesto de **comisario principal** en eventos de ciclismo. Soporta eventos de **uno o varios días**, con tareas que se pueden asignar a uno o varios días a la vez.

- **App principal (edición):** `https://<dominio>/`  → `index.html`
- **Vista de consulta (solo lectura, para el equipo):** `https://<dominio>/ver.html`

## Qué hace

### App principal (`index.html`)
- **Varios eventos** guardados por separado, con selector para cambiar entre ellos.
- Cada evento tiene **nombre, fecha de inicio y fecha de fin** (para un solo día, poné la misma fecha).
- **Tareas** con: descripción, responsable, **uno o varios días**, hora, lugar/ubicación, categoría (Reunión, Briefing, Control técnico, Seguridad, Cronometraje, Logística, Premiación, Otro), prioridad (alta/media/baja), estado (pendiente/en proceso/completada) y notas.
- **Tareas multi-día:** marcá varios días para tareas repetitivas (ej. "briefing 07:00" en los 3 días) sin digitarlas varias veces.
- **Vista agrupada por día** (Opción A), tareas ordenadas por hora.
- Marcar completada con un clic, editar, eliminar.
- Filtros por día, estado y categoría.
- **Imprimir / PDF** (botón que abre el diálogo de impresión del navegador → "Guardar como PDF").

### Vista de consulta (`ver.html`)
- **Solo lectura**: el equipo ve las tareas pero NO puede crear, editar ni eliminar.
- Filtro por **responsable** para que cada quien vea "las que le corresponden", más filtros por día y estado.
- Imprimible.
- Enlace directo con filtros aplicados:
  `ver.html?evento=<id>&responsable=<nombre>`
  (ej. mandarle a cada persona su propio enlace ya filtrado).

## Arquitectura

- **Cloudflare Worker + assets estáticos** (mismo patrón que la app de Horas Extra).
- Frontend estático en `/public` (HTML + CSS + JS, sin frameworks).
- **Workers KV** para guardar en la nube. Sin login (acceso por enlace).
- La app principal también guarda una copia en `localStorage` (clave `comisario_v1`) como respaldo/caché si se cae la conexión.

### Modelo de datos en KV
- `index` → lista de eventos: `[{ id, nombre, fechaInicio, fechaFin, actualizado }]`
- `event:<id>` → evento completo: `{ id, nombre, fechaInicio, fechaFin, tareas: [...], actualizado }`

### API del Worker
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/events` | Lista de eventos (índice) |
| GET | `/api/event/:id` | Un evento completo con sus tareas |
| PUT | `/api/event/:id` | Crear/actualizar un evento |
| DELETE | `/api/event/:id` | Eliminar un evento |

## Deploy (Cloudflare)

Igual que Horas Extra: **deploy directo con wrangler** (no la integración Git del dashboard).

### 1. Crear el namespace de KV (una sola vez)
```bash
npx wrangler@4.120.1 kv namespace create COMISARIO_KV
```
Copiá el `id` que devuelve y pegalo en `wrangler.toml` reemplazando `REEMPLAZAR_CON_ID_DEL_NAMESPACE`.

### 2. Desplegar
```bash
export CLOUDFLARE_API_TOKEN=tu_token
npx wrangler@4.120.1 deploy
```

### 3. Dominio personalizado (opcional)
Agregar un subdominio (ej. `comisario.raceclubhub.com`) al Worker desde el dashboard de Cloudflare (Workers → tu worker → Settings → Domains & Routes), o vía la API de Workers domains.

Datos de la cuenta:
- account_id: `410d32a609504b9993528287b839af0d`
- zona raceclubhub.com id: `1554a1aca6f759dbb844407f4f8b33b9`

## Estructura de archivos
```
comisario/
├── worker.js          # Worker: API KV + sirve assets
├── wrangler.toml      # Config (binding COMISARIO_KV, ASSETS)
├── HANDOFF.md         # Este documento
└── public/
    ├── index.html     # App principal (edición)
    ├── ver.html       # Vista de consulta (solo lectura)
    ├── styles.css     # Estilos (incluye @media print)
    ├── app.js         # Lógica de la app principal
    └── ver.js         # Lógica de la vista de consulta
```

## Pendientes / ideas futuras
- Login opcional si más adelante se quiere control de acceso (Supabase, como en Horas Extra).
- Exportar/importar respaldo en `.json`.
- Duplicar un evento como plantilla para reusar tareas típicas.
