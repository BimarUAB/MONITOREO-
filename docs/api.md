# API — Módulo de Seguimiento Académico

**Unidad Educativa "JESÚS MARÍA FE Y ALEGRÍA" — El Alto, Bolivia**

Backend REST con Node.js 24 + Express 4 + SQLite (`node:sqlite`). Todas las rutas viven bajo el prefijo `/api` y devuelven/aceptan JSON en español. Los errores siguen siempre el formato:

```json
{ "error": "mensaje descriptivo en español" }
```

Códigos usados: `200` OK · `201` creado · `400` datos inválidos · `401` no autenticado · `403` sin permisos · `404` no encontrado · `409` conflicto (duplicados).

## Autenticación

Todas las rutas (salvo `POST /api/auth/login`) requieren header:

```
Authorization: Bearer <token JWT>
```

El token JWT expira en **8 horas**. Roles: `admin`, `docente`, `tutor`, `estudiante`, `asistencia` (control de atrasos, permisos y faltas).

### Credenciales de demostración (después de `npm run seed`)

| Usuario | Contraseña | Rol | Detalle |
|---|---|---|---|
| `admin` | `admin123` | admin | Acceso total |
| `docente1` | `docente123` | docente | Matemática, 1° Secundaria |
| `docente2` … `docente8` | `docente123` | docente | Otras materias/cursos |
| `tutor1` | `tutor123` | tutor | 2 hijos en 1° Secundaria |
| `tutor2` | `tutor123` | tutor | 1 hijo en 4° Secundaria |
| `estudiante1` | `est123` | estudiante | 1° Secundaria (tiene usuario propio) |

## Reglas de privacidad

- **tutor**: solo ve datos (expediente, asistencias, tareas, notificaciones, comunicados) de sus estudiantes **vinculados** (tabla `tutor_estudiante`).
- **estudiante**: solo ve su propio expediente (vía `usuario_id` en la tabla `estudiantes`).
- **docente**: solo gestiona materias/cursos que tiene **asignados** en la gestión activa.
- **admin**: acceso total.
- `uploads/` **no** se sirve públicamente; los archivos solo se descargan por API autenticada (`GET /api/materiales/archivo/:id`).

---

## Auth

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | público | `{username, password}` → `{token, user:{id,username,rol,nombres,apellidos}}`. `401` si falla. |
| GET | `/api/auth/me` | autenticado | Perfil del usuario. Si es tutor incluye `hijos[]`; si es estudiante incluye `estudiante_id`. |

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tutor1","password":"tutor123"}'
```

## Admin (rol `admin`)

| Método | Ruta | Body / Query | Response |
|---|---|---|---|
| GET | `/api/usuarios` | `?rol=` opcional | Lista de usuarios |
| POST | `/api/usuarios` | `{username, password, rol, nombres, apellidos, email?, telefono?}` | `201` usuario creado. `409` si el username existe. |
| PUT | `/api/usuarios/:id` | `{nombres?, apellidos?, email?, telefono?, password? (reset), rol?, activo?, username?}` | Usuario actualizado / desactivado |
| DELETE | `/api/usuarios/:id` | — | Desactiva (no borra, preserva historial) |
| GET | `/api/cursos` | `?gestion=` (año) | Cursos con total de estudiantes |
| POST | `/api/cursos` | `{nombre, gestion_id, nivel?, capacidad_max? (≤40)}` | `201`. `409` nombre duplicado por gestión. |
| PUT | `/api/cursos/:id` | `{nombre?, nivel?, capacidad_max?}` | Actualizado (valida ≤40) |
| DELETE | `/api/cursos/:id` | — | Elimina el curso |
| GET | `/api/materias` | — | Lista |
| GET | `/api/materias/catalogo` | — | Lista de materias actualmente registradas |
| POST | `/api/materias` | `{nombre, descripcion?}` | `201`. Permite nombres libres; `409` si el nombre existe. |
| PUT | `/api/materias/:id` | `{nombre?, descripcion?}` | Actualizado |
| DELETE | `/api/materias/:id` | — | Eliminado |
| GET | `/api/estudiantes` | `?curso_id=` | Lista con curso y username |
| POST | `/api/estudiantes` | `{nombres, apellidos, curso_id, fecha_nacimiento?, rude?}` | `201`. `rude` autogenerado (ej. `2026-1S-001`) si no se envía. Valida cupo ≤40. |
| PUT | `/api/estudiantes/:id` | `{nombres?, apellidos?, fecha_nacimiento?, curso_id?, rude?, usuario_id?}` | Actualizado |
| DELETE | `/api/estudiantes/:id` | — | Eliminado |
| POST | `/api/estudiantes/import` | multipart, campo `archivo` = CSV | `{creados, errores:[{linea, error}]}` |
| GET | `/api/estudiantes/export` | `?curso_id=` | CSV descargable (`Content-Type: text/csv`) |
| GET | `/api/asignaciones` | `?docente_id= &curso_id= &gestion=` | Lista con nombres |
| POST | `/api/asignaciones` | `{docente_id, materia_id, curso_id, gestion_id?}` (gestión activa por defecto) | `201`. `409` si ya existe. |
| DELETE | `/api/asignaciones/:id` | — | Eliminada |
| GET | `/api/vinculos` | `?tutor_id=` | Vínculos tutor–estudiante |
| POST | `/api/vinculos` | `{tutor_id, estudiante_id}` | `201`. `409` si ya existe. |
| DELETE | `/api/vinculos/:id` | — | Eliminado |
| GET | `/api/asistencia/cursos` | — | Cursos de la gestión activa con cantidad de estudiantes y docentes responsables. Rol `asistencia`. |
| GET | `/api/asistencia/estudiantes` | `?curso_id=` | Lista completa del curso para registrar asistencia. Rol `asistencia`. |
| GET | `/api/asistencias/curso-global` | `?fecha=YYYY-MM-DD` | Novedades de asistencia de todos los estudiantes para esa fecha. Rol `asistencia`. |
| POST | `/api/asistencias/justificacion` | multipart: `estudiante_id`, `fecha`, `motivo`, `archivo` | Guarda un permiso con justificación y archivo adjunto. |
| GET | `/api/asistencias/:id/justificacion` | — | Descarga el archivo adjunto de una justificación. |
| GET | `/api/admin/notificaciones` | — | Historial de notificaciones enviadas, con destinatario y rol |
| POST | `/api/admin/notificaciones` | `{titulo, mensaje, tipo?, destino: todos\|rol\|usuario\|curso, rol?, usuario_id?, curso_id?}` | Envía la notificación a todos, un rol, un usuario o docentes/tutores de un curso |
| DELETE | `/api/admin/notificaciones/:id` | — | Elimina una notificación del historial |

**CSV de importación** (primera fila = encabezados):

```csv
nombres,apellidos,fecha_nacimiento,curso_id,rude
Carlos,Paredes,2011-05-14,1,
Ana,Rojas,2011-08-02,1,2026-1S-999
```

`rude` es opcional (se autogenera). Errores por línea se reportan sin abortar el lote.

## Docente (rol `docente` sobre **sus** asignaciones; `admin` también)

| Método | Ruta | Body / Query | Response |
|---|---|---|---|
| GET | `/api/docente/asignaciones` | — | Mis materias/cursos con total de estudiantes |
| GET | `/api/docente/estudiantes` | `?asignacion_id=` obligatorio, `?trimestre=1..3` opcional | Estudiantes del curso + notas trimestrales; con `trimestre` incluye `nota_trimestre` (promedio y cualitativo) |
| PUT | `/api/notas` | `{estudiante_id, materia_id, trimestre:1..3, ser (≤10), saber (≤45), hacer (≤40), decidir (≤5)}` | Upsert. Valida máximos y que el docente tenga la materia en el curso del estudiante. El componente `decidir` es la autoevaluación del estudiante. **Notifica a los tutores**. |
| PUT | `/api/entregas/:id/calificar` | `{ser?, saber?, hacer?}` | Guarda o actualiza las dimensiones de la calificación de una entrega. Límites: Ser 10, Saber 45, Hacer 40. |
| POST | `/api/tareas` | multipart o JSON `{asignacion_id, titulo, descripcion?, tipo?, fecha_entrega?, link?, archivo?}` | `201`. Crea entregas `pendiente` para cada estudiante del curso y **notifica a tutores**. `tipo`: `tarea\|actividad\|trabajo_practico\|examen` |
| GET | `/api/tareas` | `?asignacion_id=` | Tareas con conteo de entregas pendientes/completadas |
| PUT | `/api/tareas/:id` | multipart o JSON (mismos campos) | Actualizada |
| DELETE | `/api/tareas/:id` | — | Eliminada (borra su archivo) |
| PUT | `/api/entregas/:id` | `{estado: pendiente\|completada}` | Marca entrega (docente dueño de la tarea) |
| POST | `/api/asistencias` | `{fecha: YYYY-MM-DD, registros:[{estudiante_id, estado, motivo?}]}` | `201` `{guardados, errores}`. El rol `asistencia` registra solo `tarde` o `licencia`; `licencia` exige `motivo`. |
| GET | `/api/asistencias` | `?curso_id= &fecha=` | Registro de asistencia de ese día |
| POST | `/api/observaciones` | `{estudiante_id, asignacion_id?, tipo: academica\|conductual, descripcion}` | `201`. **Notifica a tutores**. |
| GET | `/api/observaciones` | `?estudiante_id= \| ?curso_id=` | Lista (docente: solo sus cursos) |
| DELETE | `/api/observaciones/:id` | — | Eliminada |
| POST | `/api/materiales` | multipart `{asignacion_id, titulo, descripcion?, archivo? \| link}` | `201`. Requiere archivo o link. Máx 10 MB. |
| GET | `/api/materiales` | `?asignacion_id=` | Lista (`tiene_archivo`, `link`) |
| DELETE | `/api/materiales/:id` | — | Eliminado (borra su archivo) |
| GET | `/api/materiales/archivo/:id` | — | Descarga del archivo subido (rol `docente`/`admin`, autenticado) |
| POST | `/api/comunicados` | `{titulo, mensaje, dirigido_a: todos\|padres\|docentes, curso_id?}` | `201`. Notifica a los destinatarios. |

> `tipo` de tarea y estados de asistencia (`presente|ausente|tarde|licencia`) están validados; valores fuera de lista → `400`.

## Consulta (tutor/estudiante; admin/docente también)

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/api/hijos` | tutor | Estudiantes vinculados con curso y gestión |
| GET | `/api/expediente/:estudiante_id` | tutor vinculado, el propio estudiante, docente, admin | Expediente completo (ver abajo) |
| GET | `/api/expediente/:estudiante_id/asistencias` | igual que expediente | `?desde= &hasta=` (YYYY-MM-DD) detalle por fecha |
| PUT | `/api/entregas/marcar` | tutor (vinculado) o el propio estudiante | `{tarea_id, estudiante_id, estado: completada\|pendiente}` |
| GET | `/api/notificaciones` | autenticado | `?pagina= &por_pagina=` (default 20). Incluye `no_leidas`. |
| PUT | `/api/notificaciones/leer` | autenticado | `{ids:[...]}` marca varias como leídas |
| PUT | `/api/notificaciones/:id/leer` | autenticado | Marca una como leída |
| GET | `/api/comunicados` | autenticado | Visibles según rol: `todos`, `padres` (tutores), `docentes`, y por curso del hijo/estudiante |

### Expediente (`GET /api/expediente/:estudiante_id`)

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tutor1","password":"tutor123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:3000/api/expediente/1 \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "estudiante": { "id": 1, "rude": "2026-1S-001", "nombres": "Juan", "apellidos": "Quispe", "fecha_nacimiento": "2013-01-10" },
  "curso": { "id": 1, "nombre": "1° Secundaria" },
  "gestion": 2026,
  "materias": [
    {
      "materia_id": 1, "materia": "Matemática", "docente": "Rosa Gutiérrez",
      "trimestres": [
        { "trimestre": 1, "ser": 15, "saber": 25.5, "hacer": 21.5, "decidir": 8.5, "promedio": 70.5, "cualitativo": "Distinguido" },
        { "trimestre": 2, "ser": null, "...": "..." }
      ],
      "promedio_anual": 68.25,
      "cualitativo_anual": "Bueno",
      "semaforo": "amarillo",
      "aprobado": true,
      "puntos_necesarios": 65.5,
      "porcentaje_registrado": 50,
      "promedio_curso": 78.5
    }
  ],
  "tareas": [ { "tarea_id": 1, "titulo": "Ejercicios de ecuaciones", "materia": "Matemática", "estado": "pendiente", "fecha_entrega": "2026-03-20" } ],
  "asistencia": { "total": 10, "presente": 8, "ausente": 1, "tarde": 1, "licencia": 0, "porcentaje_asistencia": 90 },
  "observaciones": [ { "id": 1, "tipo": "academica", "descripcion": "...", "docente": "Rosa Gutiérrez", "fecha": "2026-03-10 10:00:00" } ]
}
```

**Escala cualitativa:** 90–100 Domina · 80–89.99 Sobresaliente · 70–79.99 Distinguido · 60–69.99 Bueno · 50–59.99 Suficiente · 0–49.99 Insuficiente.
**Semáforo:** ≥80 verde · 50–79.99 amarillo · <50 rojo.
**Aprobación:** promedio anual (media de trimestres registrados, sobre 100) ≥ 51.
**Puntos necesarios:** `153 − Σ(trimestres registrados)` = puntos totales que faltan entre los trimestres restantes para llegar a 51×3.

## Reportes (rol `admin` y `docente` con curso asignado)

| Método | Ruta | Query | Response |
|---|---|---|---|
| GET | `/api/reportes/rendimiento` | `?curso_id=` obligatorio, `?gestion=` opcional | Por materia: promedio del curso, % en riesgo (<50), distribución cualitativa |
| GET | `/api/reportes/riesgo` | `?curso_id=` | Estudiantes con alguna materia con promedio del trimestre actual <50 o promedio anual <51, con detalle |
| GET | `/api/reportes/historial/:estudiante_id` | — | Notas de todas las gestiones (histórico) |

## Backup (rol `admin`)

| Método | Ruta | Response |
|---|---|---|
| GET | `/api/backup` | Copia `data/app.db` a `backups/backup-YYYYMMDD-HHmmss.db` → `{archivo: "backups/backup-...db"}` |

Lo mismo sin HTTP: `npm run backup`.

## Ejecutar

```bash
npm install
npm run seed     # crea/puebla data/app.db (idempotente: limpia y reinicia)
npm start        # http://localhost:3000 (PORT configurable por env)
npm run dev      # con --watch
```

## Notas de implementación

- `node:sqlite` (`DatabaseSync`), `PRAGMA foreign_keys = ON`, WAL, prepared statements en todas las consultas.
- CSV import/export implementado a mano (parser con soporte de comillas `"..."` y BOM en export).
- DELETE de usuarios es **baja lógica** (`activo = 0`) para preservar integridad histórica; al desactivar, el usuario no puede hacer login.
- Los archivos subidos (tareas, materiales) se guardan en `uploads/` con nombre aleatorio; solo accesibles vía API autenticada; se borran al eliminar el recurso.
- `public/` se sirve estáticamente si existe (la SPA se integra después); `GET /api/*` desconocida → `404 {error}`.
- Seguridad de headers manual: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`.
- JWT secret configurable con env `JWT_SECRET` (hay un valor por defecto solo para desarrollo).
