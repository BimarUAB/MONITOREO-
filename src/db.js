const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','docente','tutor','estudiante')),
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS gestiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anio INTEGER UNIQUE NOT NULL,
  activa INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cursos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gestion_id INTEGER NOT NULL REFERENCES gestiones(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  nivel TEXT NOT NULL DEFAULT 'Secundaria',
  capacidad_max INTEGER NOT NULL DEFAULT 40 CHECK (capacidad_max <= 40),
  UNIQUE (gestion_id, nombre)
);

CREATE TABLE IF NOT EXISTS materias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS estudiantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
  rude TEXT UNIQUE NOT NULL,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  fecha_nacimiento TEXT,
  curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tutor_estudiante (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tutor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  UNIQUE (tutor_id, estudiante_id)
);

CREATE TABLE IF NOT EXISTS asignaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  docente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  curso_id INTEGER NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  gestion_id INTEGER NOT NULL REFERENCES gestiones(id) ON DELETE CASCADE,
  UNIQUE (docente_id, materia_id, curso_id, gestion_id)
);

CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  bimestre INTEGER NOT NULL CHECK (bimestre BETWEEN 1 AND 3),
  ser REAL NOT NULL DEFAULT 0,
  saber REAL NOT NULL DEFAULT 0,
  hacer REAL NOT NULL DEFAULT 0,
  decidir REAL NOT NULL DEFAULT 0,
  UNIQUE (estudiante_id, materia_id, bimestre)
);

CREATE TABLE IF NOT EXISTS calificaciones_tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entrega_id INTEGER NOT NULL UNIQUE REFERENCES entregas(id) ON DELETE CASCADE,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  materia_id INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  componente TEXT NOT NULL CHECK (componente IN ('ser','saber','hacer')),
  valor REAL NOT NULL CHECK (valor >= 0),
  docente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asignacion_id INTEGER NOT NULL REFERENCES asignaciones(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL DEFAULT 'tarea' CHECK (tipo IN ('tarea','actividad','trabajo_practico','examen')),
  fecha_publicacion TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  fecha_entrega TEXT,
  archivo_path TEXT,
  link TEXT
);

CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','completada')),
  fecha_entrega TEXT,
  UNIQUE (tarea_id, estudiante_id)
);

CREATE TABLE IF NOT EXISTS asistencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('presente','ausente','tarde','licencia')),
  UNIQUE (estudiante_id, fecha)
);

CREATE TABLE IF NOT EXISTS observaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
  asignacion_id INTEGER REFERENCES asignaciones(id) ON DELETE SET NULL,
  docente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('academica','conductual')),
  descripcion TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS comunicados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  dirigido_a TEXT NOT NULL CHECK (dirigido_a IN ('todos','padres','docentes')),
  curso_id INTEGER REFERENCES cursos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  tipo TEXT,
  leida INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS materiales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asignacion_id INTEGER NOT NULL REFERENCES asignaciones(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  archivo_path TEXT,
  link TEXT
);

CREATE INDEX IF NOT EXISTS idx_estudiantes_curso ON estudiantes(curso_id);
CREATE INDEX IF NOT EXISTS idx_notas_estudiante ON notas(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_notas_materia ON notas(materia_id);
CREATE INDEX IF NOT EXISTS idx_calificaciones_tareas_estudiante ON calificaciones_tareas(estudiante_id, materia_id, trimestre);
CREATE INDEX IF NOT EXISTS idx_tutor_estudiante_tutor ON tutor_estudiante(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_estudiante_est ON tutor_estudiante(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_docente ON asignaciones(docente_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_curso ON asignaciones(curso_id);
CREATE INDEX IF NOT EXISTS idx_entregas_tarea ON entregas(tarea_id);
CREATE INDEX IF NOT EXISTS idx_entregas_estudiante ON entregas(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_estudiante ON asistencias(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha ON asistencias(fecha);
CREATE INDEX IF NOT EXISTS idx_observaciones_estudiante ON observaciones(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_materiales_asignacion ON materiales(asignacion_id);
`);

// Migraciones pequeñas para bases creadas con versiones anteriores.
const columnasEntregas = db.prepare('PRAGMA table_info(entregas)').all().map((columna) => columna.name);
if (!columnasEntregas.includes('revisada')) db.exec('ALTER TABLE entregas ADD COLUMN revisada INTEGER NOT NULL DEFAULT 0');
if (!columnasEntregas.includes('revision_comentario')) db.exec('ALTER TABLE entregas ADD COLUMN revision_comentario TEXT');
if (!columnasEntregas.includes('revision_fecha')) db.exec('ALTER TABLE entregas ADD COLUMN revision_fecha TEXT');
if (!columnasEntregas.includes('revision_docente_id')) db.exec('ALTER TABLE entregas ADD COLUMN revision_docente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL');
if (!columnasEntregas.includes('archivo_path')) db.exec('ALTER TABLE entregas ADD COLUMN archivo_path TEXT');
if (!columnasEntregas.includes('nombre_original')) db.exec('ALTER TABLE entregas ADD COLUMN nombre_original TEXT');
if (!columnasEntregas.includes('mime_type')) db.exec('ALTER TABLE entregas ADD COLUMN mime_type TEXT');
if (!columnasEntregas.includes('archivo_size')) db.exec('ALTER TABLE entregas ADD COLUMN archivo_size INTEGER');
if (!columnasEntregas.includes('comentario_estudiante')) db.exec('ALTER TABLE entregas ADD COLUMN comentario_estudiante TEXT');
if (!columnasEntregas.includes('enviada_at')) db.exec('ALTER TABLE entregas ADD COLUMN enviada_at TEXT');
if (!columnasEntregas.includes('es_tardia')) db.exec('ALTER TABLE entregas ADD COLUMN es_tardia INTEGER NOT NULL DEFAULT 0');

module.exports = db;

// Transacción manual (node:sqlite no incluye helper de transacciones)
db.tx = function (fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
