const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { MAX_NOTAS, promedioTrimestre } = require('../helpers');
const {
  requireRole, requerirCampos, badRequest, noEncontrado, conflicto, prohibido,
  asyncHandler, notificarTutores, esEnteroPositivo,
} = require('../middleware');

const router = express.Router();
router.use(['/docente', '/notas', '/tareas', '/entregas', '/observaciones', '/materiales', '/comunicados'], requireRole('docente', 'admin'));
router.use(['/asistencias', '/asistencia'], requireRole('docente', 'admin', 'asistencia'));

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.mp4'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!permitidos.includes(ext)) return cb(badRequest('Tipo de archivo no permitido (PDF, imágenes u Office)'));
    cb(null, true);
  },
});

// El docente solo opera sobre sus propias asignaciones; admin sobre cualquiera
function obtenerAsignacion(asignacionId, usuario) {
  const a = db.prepare(`
    SELECT a.*, m.nombre AS materia, c.nombre AS curso
    FROM asignaciones a
    JOIN materias m ON m.id = a.materia_id
    JOIN cursos c ON c.id = a.curso_id
    WHERE a.id = ?
  `).get(asignacionId);
  if (!a) throw noEncontrado('Asignación no encontrada');
  if (usuario.rol === 'docente' && a.docente_id !== usuario.id) throw prohibido('No tiene asignado ese curso/materia');
  return a;
}

// ¿El docente tiene la materia asignada en el curso del estudiante (gestión activa o dada)?
function docenteTieneMateriaEnCurso(docenteId, materiaId, cursoId, gestionId) {
  return db.prepare(`
    SELECT a.id FROM asignaciones a
    JOIN cursos c ON c.id = a.curso_id
    WHERE a.docente_id = ? AND a.materia_id = ? AND a.curso_id = ? AND a.gestion_id = ?
  `).get(docenteId, materiaId, cursoId, gestionId);
}

function cursoDelEstudiante(estudianteId) {
  return db.prepare(`
    SELECT e.*, c.id AS curso_id, c.nombre AS curso, c.gestion_id
    FROM estudiantes e JOIN cursos c ON c.id = e.curso_id WHERE e.id = ?
  `).get(estudianteId);
}

// ---------- MIS ASIGNACIONES ----------
router.get('/docente/asignaciones', asyncHandler(async (req, res) => {
  const params = [];
  let sql = `SELECT a.id, m.nombre AS materia, m.id AS materia_id, c.nombre AS curso, c.id AS curso_id,
                    g.anio AS gestion, g.id AS gestion_id,
                    (SELECT COUNT(*) FROM estudiantes e WHERE e.curso_id = a.curso_id) AS total_estudiantes,
                    (SELECT COUNT(*) FROM entregas en JOIN tareas t ON t.id = en.tarea_id WHERE t.asignacion_id = a.id AND en.revisada = 1) AS tareas_revisadas,
                    (SELECT COUNT(*) FROM entregas en JOIN tareas t ON t.id = en.tarea_id WHERE t.asignacion_id = a.id AND en.estado = 'completada' AND en.revisada = 0) AS tareas_pendientes
             FROM asignaciones a
             JOIN materias m ON m.id = a.materia_id
             JOIN cursos c ON c.id = a.curso_id
             JOIN gestiones g ON g.id = a.gestion_id`;
  if (req.usuario.rol === 'docente') {
    sql += ' WHERE a.docente_id = ?';
    params.push(req.usuario.id);
  }
  sql += ' ORDER BY g.anio DESC, c.nombre, m.nombre';
  res.json(db.prepare(sql).all(...params));
}));

router.get('/asistencia/cursos', asyncHandler(async (req, res) => {
  const gestion = db.prepare('SELECT id FROM gestiones WHERE activa = 1 LIMIT 1').get();
  if (!gestion) return res.json([]);
  const cursos = db.prepare(`
    SELECT c.id, c.nombre, c.capacidad_max,
           (SELECT COUNT(*) FROM estudiantes e WHERE e.curso_id = c.id) AS total_estudiantes,
           GROUP_CONCAT(DISTINCT u.nombres || ' ' || u.apellidos) AS docentes
    FROM cursos c
    LEFT JOIN asignaciones a ON a.curso_id = c.id AND a.gestion_id = c.gestion_id
    LEFT JOIN usuarios u ON u.id = a.docente_id
    WHERE c.gestion_id = ? GROUP BY c.id ORDER BY c.nombre
  `).all(gestion.id);
  res.json(cursos);
}));

router.get('/asistencia/estudiantes', asyncHandler(async (req, res) => {
  const { curso_id } = req.query;
  if (curso_id !== undefined && !esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
  const busqueda = String(req.query.q || '').trim();
  if (busqueda.length < 2) return res.json({ estudiantes: [] });
  const patron = `%${busqueda.toUpperCase()}%`;
  const estudiantes = db.prepare(`
    SELECT e.id, e.rude, e.nombres, e.apellidos, c.id AS curso_id, c.nombre AS curso
    FROM estudiantes e JOIN cursos c ON c.id = e.curso_id
    WHERE (UPPER(e.nombres) LIKE ? OR UPPER(e.apellidos) LIKE ? OR UPPER(e.rude) LIKE ?)
    ${curso_id ? 'AND e.curso_id = ?' : ''}
    ORDER BY e.apellidos, e.nombres
    LIMIT 50
  `).all(...(curso_id ? [patron, patron, patron, curso_id] : [patron, patron, patron]));
  res.json({ estudiantes });
}));

// ---------- ESTUDIANTES DEL CURSO DE UNA ASIGNACIÓN ----------
router.get('/docente/estudiantes', asyncHandler(async (req, res) => {
  const { asignacion_id, trimestre } = req.query;
  if (!esEnteroPositivo(asignacion_id)) throw badRequest('asignacion_id es obligatorio');
  const a = obtenerAsignacion(Number(asignacion_id), req.usuario);
  let tri = null;
  if (trimestre !== undefined) {
    tri = Number(trimestre);
    if (![1, 2, 3].includes(tri)) throw badRequest('trimestre debe ser 1..3');
  }
  const estudiantes = db.prepare(`
    SELECT e.id, e.rude, e.nombres, e.apellidos FROM estudiantes e WHERE e.curso_id = ? ORDER BY e.apellidos, e.nombres
  `).all(a.curso_id);
  // Solo notas de estudiantes de ESTE curso (gestión implícita en el curso del estudiante)
  const notas = db.prepare(`
    SELECT n.* FROM notas n
    JOIN estudiantes e ON e.id = n.estudiante_id
    WHERE n.materia_id = ? AND e.curso_id = ?
  `).all(a.materia_id, a.curso_id);
  const calificaciones = db.prepare(`
    SELECT estudiante_id, trimestre, SUM(COALESCE(ser, 0)) AS ser,
           SUM(COALESCE(saber, 0)) AS saber, SUM(COALESCE(hacer, 0)) AS hacer
    FROM calificaciones_tareas
    WHERE materia_id = ? GROUP BY estudiante_id, trimestre
  `).all(a.materia_id);
  const porEst = {};
  const acumuladoPorEst = {};
  for (const n of notas) {
    (porEst[n.estudiante_id] = porEst[n.estudiante_id] || {})[n.trimestre] = n;
  }
  for (const c of calificaciones) {
    (acumuladoPorEst[c.estudiante_id] = acumuladoPorEst[c.estudiante_id] || {})[c.trimestre] = {
      ser: Number(c.ser), saber: Number(c.saber), hacer: Number(c.hacer),
    };
  }
  const resultado = estudiantes.map((e) => {
    const notasEst = porEst[e.id] || {};
    const item = { ...e, notas: notasEst, acumulado_tareas: acumuladoPorEst[e.id] || {} };
    if (tri !== null) {
      const n = notasEst[tri];
      item.nota_trimestre = n
        ? { ...n, promedio: promedioTrimestre(n), cualitativo: require('../helpers').cualitativo(promedioTrimestre(n)) }
        : null;
    }
    return item;
  });
  res.json({ asignacion: { id: a.id, materia: a.materia, materia_id: a.materia_id, curso: a.curso }, estudiantes: resultado });
}));

// ---------- NOTAS ----------
router.put('/notas', asyncHandler(async (req, res) => {
  const { estudiante_id, materia_id, trimestre, ser, saber, hacer, decidir } = req.body || {};
  requerirCampos({ estudiante_id, materia_id, trimestre }, ['estudiante_id', 'materia_id', 'trimestre']);
  if (!esEnteroPositivo(estudiante_id)) throw badRequest('estudiante_id inválido');
  if (!esEnteroPositivo(materia_id)) throw badRequest('materia_id inválido');
  const tri = Number(trimestre);
  if (![1, 2, 3].includes(tri)) throw badRequest('trimestre debe ser 1..3');
  const valores = { ser: ser ?? 0, saber: saber ?? 0, hacer: hacer ?? 0, decidir: decidir ?? 0 };
  for (const [k, v] of Object.entries(valores)) {
    const num = Number(v);
    if (!Number.isFinite(num) || num < 0 || num > MAX_NOTAS[k]) {
      throw badRequest(`'${k}' debe estar entre 0 y ${MAX_NOTAS[k]}`);
    }
    valores[k] = num;
  }
  const est = cursoDelEstudiante(estudiante_id);
  if (!est) throw noEncontrado('Estudiante no encontrado');
  if (req.usuario.rol === 'docente') {
    const asig = docenteTieneMateriaEnCurso(req.usuario.id, materia_id, est.curso_id, est.gestion_id);
    if (!asig) throw prohibido('No tiene esta materia asignada en el curso del estudiante');
  }
  const existe = db.prepare('SELECT id FROM notas WHERE estudiante_id=? AND materia_id=? AND trimestre=?')
    .get(estudiante_id, materia_id, tri);
  if (existe) {
    db.prepare('UPDATE notas SET ser=?, saber=?, hacer=?, decidir=? WHERE id=?')
      .run(valores.ser, valores.saber, valores.hacer, valores.decidir, existe.id);
  } else {
    db.prepare('INSERT INTO notas (estudiante_id, materia_id, trimestre, ser, saber, hacer, decidir) VALUES (?,?,?,?,?,?,?)')
      .run(estudiante_id, materia_id, tri, valores.ser, valores.saber, valores.hacer, valores.decidir);
  }
  const materia = db.prepare('SELECT nombre FROM materias WHERE id = ?').get(materia_id);
  notificarTutores(estudiante_id, `Nuevas notas de ${materia.nombre} — Trimestre ${tri}`,
    `${est.nombres} ${est.apellidos} tiene nuevas notas registradas en ${materia.nombre} (Trimestre ${tri}).`, 'notas');
  res.json({ mensaje: 'Nota guardada correctamente', estudiante_id, materia_id, trimestre: tri, ...valores });
}));

// ---------- TAREAS ----------
router.post('/tareas', upload.single('archivo'), asyncHandler(async (req, res) => {
  const { asignacion_id, titulo, descripcion, tipo, fecha_entrega, trimestre, link } = req.body || {};
  requerirCampos({ asignacion_id, titulo }, ['asignacion_id', 'titulo']);
  if (!esEnteroPositivo(asignacion_id)) throw badRequest('asignacion_id inválido');
  const tipos = ['tarea', 'actividad', 'trabajo_practico', 'examen'];
  if (tipo && !tipos.includes(tipo)) throw badRequest(`tipo debe ser: ${tipos.join(', ')}`);
  const tri = trimestre === undefined ? 1 : Number(trimestre);
  if (![1, 2, 3].includes(tri)) throw badRequest('trimestre debe ser 1..3');
  const a = obtenerAsignacion(Number(asignacion_id), req.usuario);
  const archivoPath = req.file ? req.file.filename : null;
  const r = db.prepare(`INSERT INTO tareas (asignacion_id, titulo, descripcion, tipo, fecha_entrega, trimestre, archivo_path, link)
                        VALUES (?,?,?,?,?,?,?,?)`)
    .run(a.id, titulo, descripcion || null, tipo || 'tarea', fecha_entrega || null, tri, archivoPath, link || null);
  const tareaId = Number(r.lastInsertRowid);
  const estudiantes = db.prepare('SELECT id, nombres, apellidos FROM estudiantes WHERE curso_id = ?').all(a.curso_id);
  const ins = db.prepare("INSERT INTO entregas (tarea_id, estudiante_id, estado) VALUES (?,?,'pendiente')");
  for (const e of estudiantes) {
    ins.run(tareaId, e.id);
    notificarTutores(e.id, `Nueva tarea de ${a.materia}`,
      `Se publicó "${titulo}" (${tipo || 'tarea'}) para ${e.nombres} ${e.apellidos}. Fecha de entrega: ${fecha_entrega || 'sin definir'}.`, 'tarea');
  }
  res.status(201).json({ id: tareaId, asignacion_id: a.id, titulo, tipo: tipo || 'tarea', trimestre: tri });
}));

router.get('/tareas', asyncHandler(async (req, res) => {
  const { asignacion_id } = req.query;
  let sql = `SELECT t.*, m.nombre AS materia, c.nombre AS curso, a.docente_id
             FROM tareas t
             JOIN asignaciones a ON a.id = t.asignacion_id
             JOIN materias m ON m.id = a.materia_id
             JOIN cursos c ON c.id = a.curso_id`;
  const cond = [], params = [];
  if (asignacion_id) {
    if (!esEnteroPositivo(asignacion_id)) throw badRequest('asignacion_id inválido');
    cond.push('t.asignacion_id = ?'); params.push(Number(asignacion_id));
  }
  if (req.usuario.rol === 'docente') { cond.push('a.docente_id = ?'); params.push(req.usuario.id); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY t.fecha_publicacion DESC';
  const tareas = db.prepare(sql).all(...params);
  const contar = db.prepare('SELECT estado, COUNT(*) AS n FROM entregas WHERE tarea_id = ? GROUP BY estado');
  res.json(tareas.map((t) => {
    const estados = { pendiente: 0, completada: 0 };
    for (const row of contar.all(t.id)) estados[row.estado] = row.n;
    return { ...t, tiene_archivo: !!t.archivo_path, entregas: estados };
  }));
}));

function obtenerTarea(tareaId, usuario) {
  const t = db.prepare(`
    SELECT t.*, a.docente_id, a.curso_id, m.nombre AS materia
    FROM tareas t JOIN asignaciones a ON a.id = t.asignacion_id JOIN materias m ON m.id = a.materia_id
    WHERE t.id = ?
  `).get(tareaId);
  if (!t) throw noEncontrado('Tarea no encontrada');
  if (usuario.rol === 'docente' && t.docente_id !== usuario.id) throw prohibido('No puede gestionar tareas de otro docente');
  return t;
}

router.put('/tareas/:id', upload.single('archivo'), asyncHandler(async (req, res) => {
  const t = obtenerTarea(req.params.id, req.usuario);
  const { asignacion_id, titulo, descripcion, tipo, fecha_entrega, trimestre, link } = req.body || {};
  const tipos = ['tarea', 'actividad', 'trabajo_practico', 'examen'];
  if (tipo && !tipos.includes(tipo)) throw badRequest(`tipo debe ser: ${tipos.join(', ')}`);
  const tri = trimestre === undefined ? t.trimestre : Number(trimestre);
  if (![1, 2, 3].includes(tri)) throw badRequest('trimestre debe ser 1..3');
  const asignacion = asignacion_id === undefined
    ? { id: t.asignacion_id }
    : obtenerAsignacion(Number(asignacion_id), req.usuario);
  if (req.file && t.archivo_path) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, t.archivo_path)); } catch (_) { /* archivo ya no existe */ }
  }
  db.prepare('UPDATE tareas SET asignacion_id=?, titulo=?, descripcion=?, tipo=?, fecha_entrega=?, trimestre=?, link=?, archivo_path=? WHERE id=?')
    .run(
      asignacion.id,
      titulo || t.titulo,
      descripcion !== undefined ? descripcion : t.descripcion,
      tipo || t.tipo,
      fecha_entrega !== undefined ? fecha_entrega : t.fecha_entrega,
      tri,
      link !== undefined ? link : t.link,
      req.file ? req.file.filename : t.archivo_path,
      t.id
    );
  res.json({ mensaje: 'Tarea actualizada correctamente' });
}));

router.delete('/tareas/:id', asyncHandler(async (req, res) => {
  const t = obtenerTarea(req.params.id, req.usuario);
  if (t.archivo_path) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, t.archivo_path)); } catch (_) { /* archivo ya no existe */ }
  }
  db.prepare('DELETE FROM tareas WHERE id = ?').run(t.id);
  res.json({ mensaje: 'Tarea eliminada correctamente' });
}));

// ---------- REVISIÓN DE ENTREGAS ----------
router.get('/entregas', asyncHandler(async (req, res) => {
  const { tarea_id } = req.query;
  if (!esEnteroPositivo(tarea_id)) throw badRequest('tarea_id es obligatorio');
  const tarea = obtenerTarea(Number(tarea_id), req.usuario);
  const entregas = db.prepare(`
    SELECT en.id, en.tarea_id, en.estudiante_id, en.estado, en.fecha_entrega, en.archivo_path,
           en.revisada, en.revision_comentario, en.revision_fecha,
           ct.ser AS calificacion_ser, ct.saber AS calificacion_saber, ct.hacer AS calificacion_hacer,
           e.nombres, e.apellidos, e.rude
    FROM entregas en JOIN estudiantes e ON e.id = en.estudiante_id
    LEFT JOIN calificaciones_tareas ct ON ct.entrega_id = en.id
    WHERE en.tarea_id = ? ORDER BY e.apellidos, e.nombres
  `).all(tarea.id);
  res.json({ tarea: { id: tarea.id, titulo: tarea.titulo, materia: tarea.materia }, entregas });
}));

router.put('/entregas/:id/calificar', asyncHandler(async (req, res) => {
  const entrega = db.prepare(`
    SELECT en.id, en.estudiante_id, t.trimestre, a.materia_id, a.docente_id
    FROM entregas en JOIN tareas t ON t.id = en.tarea_id JOIN asignaciones a ON a.id = t.asignacion_id
    WHERE en.id = ?
  `).get(req.params.id);
  if (!entrega) throw noEncontrado('Entrega no encontrada');
  if (req.usuario.rol === 'docente' && entrega.docente_id !== req.usuario.id) throw prohibido('No puede calificar entregas ajenas');
  const valores = {};
  for (const componente of ['ser', 'saber', 'hacer']) {
    if (req.body?.[componente] !== undefined && req.body[componente] !== null && req.body[componente] !== '') {
      const valor = Number(req.body[componente]);
      if (!Number.isFinite(valor) || valor < 0 || valor > MAX_NOTAS[componente]) throw badRequest(`${componente} debe estar entre 0 y ${MAX_NOTAS[componente]}`);
      valores[componente] = valor;
    }
  }
  if (!Object.keys(valores).length) throw badRequest('Debe registrar al menos una calificación: ser, saber o hacer');
  const existente = db.prepare('SELECT id FROM calificaciones_tareas WHERE entrega_id = ?').get(entrega.id);
  if (existente) {
    db.prepare('UPDATE calificaciones_tareas SET ser=COALESCE(?, ser), saber=COALESCE(?, saber), hacer=COALESCE(?, hacer), componente=?, valor=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .run(valores.ser ?? null, valores.saber ?? null, valores.hacer ?? null, Object.keys(valores)[0], valores[Object.keys(valores)[0]], existente.id);
  } else {
    const componente = Object.keys(valores)[0];
    db.prepare(`INSERT INTO calificaciones_tareas (entrega_id, estudiante_id, materia_id, trimestre, componente, valor, ser, saber, hacer, docente_id)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(entrega.id, entrega.estudiante_id, entrega.materia_id, entrega.trimestre, componente, valores[componente], valores.ser ?? null, valores.saber ?? null, valores.hacer ?? null, req.usuario.id);
  }
  res.json({ mensaje: 'Calificación guardada correctamente', entrega_id: entrega.id, trimestre: entrega.trimestre, ...valores });
}));

router.put('/entregas/:id/revisar', asyncHandler(async (req, res) => {
  const { comentario, componente, valor, trimestre } = req.body || {};
  const entrega = db.prepare(`
    SELECT en.*, t.titulo, a.docente_id, e.usuario_id
    FROM entregas en
    JOIN tareas t ON t.id = en.tarea_id
    JOIN asignaciones a ON a.id = t.asignacion_id
    JOIN estudiantes e ON e.id = en.estudiante_id
    WHERE en.id = ?
  `).get(req.params.id);
  if (!entrega) throw noEncontrado('Entrega no encontrada');
  if (req.usuario.rol === 'docente' && entrega.docente_id !== req.usuario.id) throw prohibido('No puede revisar entregas ajenas');
  const texto = comentario === undefined || comentario === null ? null : String(comentario).trim().slice(0, 1000);
  db.prepare("UPDATE entregas SET revisada=1, revision_comentario=?, revision_fecha=datetime('now','localtime'), revision_docente_id=? WHERE id=?")
    .run(texto || null, req.usuario.id, entrega.id);
  if (entrega.usuario_id) {
    db.prepare('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?,?,?,?)')
      .run(entrega.usuario_id, 'Tarea revisada', `Tu tarea "${entrega.titulo}" fue revisada por el docente.`, 'tarea_revisada');
  }
  if (componente !== undefined || valor !== undefined) {
    if (!['ser', 'saber', 'hacer'].includes(componente)) throw badRequest('componente debe ser ser, saber o hacer');
    const nota = Number(valor);
    if (!Number.isFinite(nota) || nota < 0 || nota > MAX_NOTAS[componente]) throw badRequest(`${componente} debe estar entre 0 y ${MAX_NOTAS[componente]}`);
    const tri = trimestre === undefined ? db.prepare('SELECT trimestre FROM tareas WHERE id = (SELECT tarea_id FROM entregas WHERE id = ?)').get(entrega.id).trimestre : Number(trimestre);
    if (![1, 2, 3].includes(tri)) throw badRequest('trimestre debe ser 1..3');
    const existente = db.prepare('SELECT id FROM calificaciones_tareas WHERE entrega_id = ?').get(entrega.id);
    if (existente) {
      db.prepare(`UPDATE calificaciones_tareas SET trimestre=?, componente=?, valor=?, ${componente}=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(tri, componente, nota, nota, existente.id);
    } else {
      const materia = db.prepare('SELECT a.materia_id FROM tareas t JOIN asignaciones a ON a.id = t.asignacion_id WHERE t.id = ?').get(entrega.tarea_id);
      db.prepare(`INSERT INTO calificaciones_tareas (entrega_id, estudiante_id, materia_id, trimestre, componente, valor, ${componente}, docente_id)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(entrega.id, entrega.estudiante_id, materia.materia_id, tri, componente, nota, nota, req.usuario.id);
    }
  }
  res.json({ mensaje: 'Entrega revisada correctamente', revisada: true, comentario: texto, calificada: componente !== undefined || valor !== undefined });
}));

// Marcar entrega (docente/admin)
router.put('/entregas/:id', asyncHandler(async (req, res) => {
  const { estado } = req.body || {};
  if (!['pendiente', 'completada'].includes(estado)) throw badRequest("estado debe ser 'pendiente' o 'completada'");
  const ent = db.prepare(`
    SELECT en.*, t.titulo, a.docente_id, e.id AS est_id
    FROM entregas en JOIN tareas t ON t.id = en.tarea_id
    JOIN asignaciones a ON a.id = t.asignacion_id
    JOIN estudiantes e ON e.id = en.estudiante_id
    WHERE en.id = ?
  `).get(req.params.id);
  if (!ent) throw noEncontrado('Entrega no encontrada');
  if (req.usuario.rol === 'docente' && ent.docente_id !== req.usuario.id) throw prohibido('No puede gestionar entregas ajenas');
  db.prepare("UPDATE entregas SET estado=?, fecha_entrega=? WHERE id=?")
    .run(estado, estado === 'completada' ? new Date().toISOString().slice(0, 10) : null, ent.id);
  res.json({ mensaje: 'Entrega actualizada correctamente' });
}));

// ---------- ASISTENCIAS ----------
router.post('/asistencias', asyncHandler(async (req, res) => {
  const { fecha, registros } = req.body || {};
  requerirCampos({ fecha }, ['fecha']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw badRequest('fecha debe tener formato YYYY-MM-DD');
  if (!Array.isArray(registros) || registros.length === 0) throw badRequest('registros debe ser un arreglo no vacío');
  const estadosValidos = ['presente', 'ausente', 'tarde', 'licencia'];
  const cursosPermitidos = new Set();
  if (req.usuario.rol === 'docente') {
    const asigs = db.prepare('SELECT curso_id FROM asignaciones WHERE docente_id = ?').all(req.usuario.id);
    for (const a of asigs) cursosPermitidos.add(a.curso_id);
  }
  let guardados = 0;
  const errores = [];
  const upsert = db.prepare(`
    INSERT INTO asistencias (estudiante_id, fecha, estado, motivo) VALUES (?,?,?,?)
    ON CONFLICT(estudiante_id, fecha) DO UPDATE SET estado = excluded.estado, motivo = excluded.motivo
  `);
  db.tx(() => {
    for (const reg of registros) {
      const { estudiante_id, estado, motivo } = reg || {};
      if (!esEnteroPositivo(estudiante_id)) { errores.push({ estudiante_id, error: 'ID inválido' }); continue; }
      if (!estadosValidos.includes(estado)) { errores.push({ estudiante_id, error: 'estado inválido' }); continue; }
      if (req.usuario.rol === 'asistencia' && !['tarde', 'licencia'].includes(estado)) { errores.push({ estudiante_id, error: 'solo puede registrar atrasos o permisos' }); continue; }
      if (req.usuario.rol === 'asistencia' && estado === 'licencia' && !String(motivo || '').trim()) { errores.push({ estudiante_id, error: 'el permiso requiere una justificación' }); continue; }
      const est = cursoDelEstudiante(estudiante_id);
      if (!est) { errores.push({ estudiante_id, error: 'estudiante no existe' }); continue; }
      if (req.usuario.rol === 'docente' && !cursosPermitidos.has(est.curso_id)) {
        errores.push({ estudiante_id, error: 'estudiante fuera de sus cursos asignados' });
        continue;
      }
      upsert.run(estudiante_id, fecha, estado, String(motivo || '').trim() || null);
      guardados++;
    }
  });
  res.status(201).json({ guardados, errores });
}));

router.post('/asistencias/justificacion', upload.single('archivo'), asyncHandler(async (req, res) => {
  const { estudiante_id, fecha, motivo } = req.body || {};
  requerirCampos({ estudiante_id, fecha, motivo }, ['estudiante_id', 'fecha', 'motivo']);
  if (!esEnteroPositivo(estudiante_id)) throw badRequest('estudiante_id inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw badRequest('fecha debe tener formato YYYY-MM-DD');
  const estudiante = cursoDelEstudiante(estudiante_id);
  if (!estudiante) throw noEncontrado('Estudiante no encontrado');
  if (req.usuario.rol === 'docente') {
    const permiso = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, estudiante.curso_id);
    if (!permiso) throw prohibido('No tiene ese curso asignado');
  }
  if (req.usuario.rol !== 'asistencia' && !req.file) throw badRequest('Debe adjuntar un archivo para esta justificación');
  const actual = db.prepare('SELECT archivo_path FROM asistencias WHERE estudiante_id = ? AND fecha = ?').get(estudiante_id, fecha);
  const archivo = req.file ? req.file.filename : actual?.archivo_path || null;
  db.prepare(`
    INSERT INTO asistencias (estudiante_id, fecha, estado, motivo, archivo_path, nombre_original, mime_type)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(estudiante_id, fecha) DO UPDATE SET estado='licencia', motivo=excluded.motivo,
      archivo_path=excluded.archivo_path, nombre_original=excluded.nombre_original, mime_type=excluded.mime_type
  `).run(estudiante_id, fecha, 'licencia', String(motivo).trim(), archivo, req.file?.originalname || null, req.file?.mimetype || null);
  res.status(201).json({ mensaje: 'Justificación guardada correctamente', archivo_adjunto: !!archivo });
}));

router.get('/asistencias', asyncHandler(async (req, res) => {
  const { curso_id, fecha } = req.query;
  if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id es obligatorio');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw badRequest('fecha es obligatoria (YYYY-MM-DD)');
  if (req.usuario.rol === 'docente') {
    const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, curso_id);
    if (!perm) throw prohibido('No tiene ese curso asignado');
  }
  const datos = db.prepare(`
    SELECT a.*, e.nombres, e.apellidos, e.rude FROM asistencias a
    JOIN estudiantes e ON e.id = a.estudiante_id
    WHERE e.curso_id = ? AND a.fecha = ? ORDER BY e.apellidos, e.nombres
  `).all(curso_id, fecha);
  res.json(datos);
}));

router.get('/asistencias/curso-global', asyncHandler(async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '')) throw badRequest('fecha es obligatoria (YYYY-MM-DD)');
  res.json(db.prepare('SELECT * FROM asistencias WHERE fecha = ?').all(req.query.fecha));
}));

router.get('/asistencias/:id/justificacion', asyncHandler(async (req, res) => {
  const asistencia = db.prepare('SELECT archivo_path, nombre_original, mime_type FROM asistencias WHERE id = ? AND estado = \'licencia\'').get(req.params.id);
  if (!asistencia || !asistencia.archivo_path) throw noEncontrado('Archivo de justificación no encontrado');
  const archivo = path.join(UPLOAD_DIR, asistencia.archivo_path);
  if (!fs.existsSync(archivo)) throw noEncontrado('El archivo ya no existe en el servidor');
  res.type(asistencia.mime_type || path.extname(archivo)).download(archivo, asistencia.nombre_original || 'justificacion');
}));

// ---------- OBSERVACIONES ----------
router.post('/observaciones', asyncHandler(async (req, res) => {
  const { estudiante_id, asignacion_id, tipo, descripcion } = req.body || {};
  requerirCampos({ estudiante_id, tipo, descripcion }, ['estudiante_id', 'tipo', 'descripcion']);
  if (!['academica', 'conductual'].includes(tipo)) throw badRequest("tipo debe ser 'academica' o 'conductual'");
  if (!esEnteroPositivo(estudiante_id)) throw badRequest('estudiante_id inválido');
  const est = cursoDelEstudiante(estudiante_id);
  if (!est) throw noEncontrado('Estudiante no encontrado');
  let asignacionId = asignacion_id || null;
  if (asignacionId) {
    if (!esEnteroPositivo(asignacionId)) throw badRequest('asignacion_id inválido');
    const a = obtenerAsignacion(Number(asignacionId), req.usuario);
    if (a.curso_id !== est.curso_id) throw badRequest('La asignación no corresponde al curso del estudiante');
  } else if (req.usuario.rol === 'docente') {
    const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, est.curso_id);
    if (!perm) throw prohibido('No tiene ese curso asignado');
  }
  const docenteId = req.usuario.rol === 'docente' ? req.usuario.id : (req.body.docente_id || req.usuario.id);
  const r = db.prepare('INSERT INTO observaciones (estudiante_id, asignacion_id, docente_id, tipo, descripcion) VALUES (?,?,?,?,?)')
    .run(estudiante_id, asignacionId, docenteId, tipo, descripcion);
  notificarTutores(estudiante_id, `Nueva observación ${tipo === 'academica' ? 'académica' : 'conductual'}`,
    `${est.nombres} ${est.apellidos}: ${descripcion}`, 'observacion');
  res.status(201).json({ id: Number(r.lastInsertRowid), estudiante_id: Number(estudiante_id), tipo, descripcion });
}));

router.get('/observaciones', asyncHandler(async (req, res) => {
  const { estudiante_id, curso_id } = req.query;
  let sql = `SELECT o.*, e.nombres || ' ' || e.apellidos AS estudiante, u.nombres || ' ' || u.apellidos AS docente, m.nombre AS materia
             FROM observaciones o
             JOIN estudiantes e ON e.id = o.estudiante_id
             JOIN usuarios u ON u.id = o.docente_id
             LEFT JOIN asignaciones a ON a.id = o.asignacion_id
             LEFT JOIN materias m ON m.id = a.materia_id`;
  const cond = [], params = [];
  if (estudiante_id) {
    if (!esEnteroPositivo(estudiante_id)) throw badRequest('estudiante_id inválido');
    cond.push('o.estudiante_id = ?'); params.push(Number(estudiante_id));
  }
  if (req.usuario.rol === 'docente') {
    if (estudiante_id) {
      const est = cursoDelEstudiante(estudiante_id);
      if (est) {
        const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, est.curso_id);
        if (!perm) throw prohibido('No tiene ese curso asignado');
      }
    } else if (curso_id) {
      const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, curso_id);
      if (!perm) throw prohibido('No tiene ese curso asignado');
      cond.push('e.curso_id = ?'); params.push(Number(curso_id));
    } else {
      cond.push(`o.docente_id = ?`); params.push(req.usuario.id);
    }
  } else if (curso_id) {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    cond.push('e.curso_id = ?'); params.push(Number(curso_id));
  }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY o.fecha DESC';
  res.json(db.prepare(sql).all(...params));
}));

router.delete('/observaciones/:id', asyncHandler(async (req, res) => {
  const o = db.prepare('SELECT * FROM observaciones WHERE id = ?').get(req.params.id);
  if (!o) throw noEncontrado('Observación no encontrada');
  if (req.usuario.rol === 'docente' && o.docente_id !== req.usuario.id) throw prohibido('No puede eliminar observaciones ajenas');
  db.prepare('DELETE FROM observaciones WHERE id = ?').run(o.id);
  res.json({ mensaje: 'Observación eliminada correctamente' });
}));

// ---------- MATERIALES ----------
router.post('/materiales', upload.single('archivo'), asyncHandler(async (req, res) => {
  const { asignacion_id, titulo, descripcion, link } = req.body || {};
  requerirCampos({ asignacion_id, titulo }, ['asignacion_id', 'titulo']);
  if (!esEnteroPositivo(asignacion_id)) throw badRequest('asignacion_id inválido');
  if (!req.file && !link) throw badRequest('Debe adjuntar un archivo o proporcionar un enlace (link)');
  const a = obtenerAsignacion(Number(asignacion_id), req.usuario);
  const r = db.prepare('INSERT INTO materiales (asignacion_id, titulo, descripcion, archivo_path, link) VALUES (?,?,?,?,?)')
    .run(a.id, titulo, descripcion || null, req.file ? req.file.filename : null, link || null);
  res.status(201).json({ id: Number(r.lastInsertRowid), asignacion_id: a.id, titulo, tiene_archivo: !!req.file, link: link || null });
}));

router.get('/materiales', asyncHandler(async (req, res) => {
  const { asignacion_id } = req.query;
  let sql = `SELECT mt.*, m.nombre AS materia, c.nombre AS curso, a.docente_id, a.curso_id
             FROM materiales mt
             JOIN asignaciones a ON a.id = mt.asignacion_id
             JOIN materias m ON m.id = a.materia_id
             JOIN cursos c ON c.id = a.curso_id`;
  const cond = [], params = [];
  if (asignacion_id) {
    if (!esEnteroPositivo(asignacion_id)) throw badRequest('asignacion_id inválido');
    cond.push('mt.asignacion_id = ?'); params.push(Number(asignacion_id));
  }
  if (req.usuario.rol === 'docente') { cond.push('a.docente_id = ?'); params.push(req.usuario.id); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY mt.id DESC';
  const datos = db.prepare(sql).all(...params);
  res.json(datos.map((d) => ({ ...d, tiene_archivo: !!d.archivo_path })));
}));

function obtenerMaterial(id, usuario) {
  const mt = db.prepare(`
    SELECT mt.*, a.docente_id, m.nombre AS materia FROM materiales mt
    JOIN asignaciones a ON a.id = mt.asignacion_id JOIN materias m ON m.id = a.materia_id
    WHERE mt.id = ?
  `).get(id);
  if (!mt) throw noEncontrado('Material no encontrado');
  if (usuario.rol === 'docente' && mt.docente_id !== usuario.id) throw prohibido('No puede gestionar materiales ajenos');
  return mt;
}

router.delete('/materiales/:id', asyncHandler(async (req, res) => {
  const mt = obtenerMaterial(req.params.id, req.usuario);
  if (mt.archivo_path) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, mt.archivo_path)); } catch (_) { /* archivo ya no existe */ }
  }
  db.prepare('DELETE FROM materiales WHERE id = ?').run(mt.id);
  res.json({ mensaje: 'Material eliminado correctamente' });
}));

// Descarga autenticada (uploads/ NO se sirve públicamente)
router.get('/materiales/archivo/:id', asyncHandler(async (req, res) => {
  const mt = obtenerMaterial(req.params.id, req.usuario);
  if (!mt || !mt.archivo_path) throw noEncontrado('El material no tiene archivo adjunto');
  const ruta = path.join(UPLOAD_DIR, mt.archivo_path);
  if (!fs.existsSync(ruta)) throw noEncontrado('El archivo ya no existe en el servidor');
  res.download(ruta, `${mt.titulo}${path.extname(mt.archivo_path)}`);
}));

// ---------- COMUNICADOS (publicación) ----------
router.post('/comunicados', asyncHandler(async (req, res) => {
  const { titulo, mensaje, dirigido_a, curso_id } = req.body || {};
  requerirCampos({ titulo, mensaje, dirigido_a }, ['titulo', 'mensaje', 'dirigido_a']);
  if (!['todos', 'padres', 'docentes'].includes(dirigido_a)) throw badRequest("dirigido_a debe ser 'todos', 'padres' o 'docentes'");
  let cursoId = null;
  if (curso_id) {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(curso_id);
    if (!curso) throw noEncontrado('El curso no existe');
    cursoId = Number(curso_id);
  }
  const r = db.prepare('INSERT INTO comunicados (autor_id, titulo, mensaje, dirigido_a, curso_id) VALUES (?,?,?,?,?)')
    .run(req.usuario.id, titulo, mensaje, dirigido_a, cursoId);
  // Notificar destinatarios
  const destinatarios = new Set();
  const tutoresDeCurso = db.prepare(`
    SELECT DISTINCT te.tutor_id FROM tutor_estudiante te JOIN estudiantes e ON e.id = te.estudiante_id WHERE e.curso_id = ?
  `).all(cursoId || -1);
  if (dirigido_a === 'todos' || dirigido_a === 'padres') {
    if (cursoId) {
      for (const t of tutoresDeCurso) destinatarios.add(t.tutor_id);
    } else {
      for (const u of db.prepare("SELECT id FROM usuarios WHERE rol IN ('tutor','estudiante') AND activo = 1").all()) destinatarios.add(u.id);
    }
  }
  if (dirigido_a === 'todos' || dirigido_a === 'docentes') {
    for (const u of db.prepare("SELECT id FROM usuarios WHERE rol = 'docente' AND activo = 1").all()) destinatarios.add(u.id);
  }
  if (dirigido_a === 'todos' && cursoId) {
    // curso específico: también los estudiantes del curso
    for (const e of db.prepare('SELECT usuario_id FROM estudiantes WHERE curso_id = ? AND usuario_id IS NOT NULL').all(cursoId)) {
      if (e.usuario_id) destinatarios.add(e.usuario_id);
    }
  }
  for (const uid of destinatarios) {
    if (uid !== req.usuario.id) {
      db.prepare('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?,?,?,?)')
        .run(uid, `Comunicado: ${titulo}`, mensaje.slice(0, 200), 'comunicado');
    }
  }
  res.status(201).json({ id: Number(r.lastInsertRowid), titulo, dirigido_a, curso_id: cursoId });
}));

module.exports = router;
