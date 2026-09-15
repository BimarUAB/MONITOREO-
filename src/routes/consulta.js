const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const {
  promedioBimestre, cualitativo, promedioAnual, semaforo, aprobado,
  puntosNecesarios, porcentajeBimestresRegistrados, resumenAsistencia,
} = require('../helpers');
const {
  requerirCampos, badRequest, noEncontrado, prohibido,
  asyncHandler, puedeVerExpediente, estudianteDeUsuario, esEnteroPositivo,
} = require('../middleware');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const uploadEntrega = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip'];
    if (!permitidos.includes(path.extname(file.originalname).toLowerCase())) return cb(new Error('Tipo de archivo no permitido'));
    cb(null, true);
  },
});

// ---------- HIJOS (tutor) ----------
router.get('/hijos', asyncHandler(async (req, res) => {
  if (req.usuario.rol !== 'tutor') throw prohibido('Solo los tutores pueden listar hijos');
  res.json(db.prepare(`
    SELECT e.id, e.rude, e.nombres, e.apellidos, e.fecha_nacimiento, c.nombre AS curso, g.anio AS gestion
    FROM tutor_estudiante te
    JOIN estudiantes e ON e.id = te.estudiante_id
    JOIN cursos c ON c.id = e.curso_id
    JOIN gestiones g ON g.id = c.gestion_id
    WHERE te.tutor_id = ? ORDER BY e.apellidos, e.nombres
  `).all(req.usuario.id));
}));

function expedienteDe(estudianteId) {
  const est = db.prepare(`
    SELECT e.*, c.nombre AS curso, c.id AS curso_id, c.gestion_id, g.anio AS gestion
    FROM estudiantes e JOIN cursos c ON c.id = e.curso_id JOIN gestiones g ON g.id = c.gestion_id
    WHERE e.id = ?
  `).get(estudianteId);
  if (!est) return null;

  // Materias del curso del estudiante (por asignaciones de su gestión) + notas de 4 bimestres
  const asignaciones = db.prepare(`
    SELECT a.id AS asignacion_id, m.id AS materia_id, m.nombre AS materia, u.nombres || ' ' || u.apellidos AS docente
    FROM asignaciones a
    JOIN materias m ON m.id = a.materia_id
    JOIN usuarios u ON u.id = a.docente_id
    WHERE a.curso_id = ? AND a.gestion_id = ?
    ORDER BY m.nombre
  `).all(est.curso_id, est.gestion_id);

  const filasNotas = db.prepare(`
    SELECT n.* FROM notas n
    JOIN estudiantes e ON e.id = n.estudiante_id
    JOIN cursos c ON c.id = e.curso_id
    WHERE n.estudiante_id = ? AND c.gestion_id = ?
  `).all(estudianteId, est.gestion_id);
  const notasPorMateria = {};
  for (const n of filasNotas) {
    (notasPorMateria[n.materia_id] = notasPorMateria[n.materia_id] || {})[n.bimestre] = n;
  }

  // Promedio general del curso por materia (gestión del estudiante)
  const promediosCurso = db.prepare(`
    SELECT n.materia_id, AVG(n.ser + n.saber + n.hacer + n.decidir) AS promedio
    FROM notas n
    JOIN estudiantes e ON e.id = n.estudiante_id
    JOIN cursos c ON c.id = e.curso_id
    WHERE c.id = ? AND c.gestion_id = ? AND e.curso_id = ?
    GROUP BY n.materia_id
  `).all(est.curso_id, est.gestion_id, est.curso_id);
  const promedioCursoPorMateria = {};
  for (const p of promediosCurso) promedioCursoPorMateria[p.materia_id] = Math.round(p.promedio * 100) / 100;

  const materias = asignaciones.map((a) => {
    const porBimestre = [];
    const proms = [];
    for (let b = 1; b <= 4; b++) {
      const n = (notasPorMateria[a.materia_id] || {})[b];
      if (n) {
        const prom = promedioBimestre(n);
        porBimestre.push({ bimestre: b, ser: n.ser, saber: n.saber, hacer: n.hacer, decidir: n.decidir, promedio: prom, cualitativo: cualitativo(prom) });
        proms.push(prom);
      } else {
        porBimestre.push({ bimestre: b, ser: null, saber: null, hacer: null, decidir: null, promedio: null, cualitativo: null });
      }
    }
    const anual = promedioAnual(proms);
    return {
      asignacion_id: a.asignacion_id,
      materia_id: a.materia_id,
      materia: a.materia,
      docente: a.docente,
      bimestres: porBimestre,
      promedio_anual: anual,
      cualitativo_anual: anual !== null ? cualitativo(anual) : null,
      semaforo: semaforo(anual),
      aprobado: aprobado(anual),
      puntos_necesarios: puntosNecesarios(proms),
      porcentaje_registrado: porcentajeBimestresRegistrados(proms),
      promedio_curso: promedioCursoPorMateria[a.materia_id] ?? null,
    };
  });

  // Tareas del estudiante (entregas del curso en la gestión)
  const tareas = db.prepare(`
        SELECT t.id AS tarea_id, t.titulo, t.descripcion, t.tipo, t.fecha_publicacion, t.fecha_entrega, t.link,
          m.nombre AS materia, en.id AS entrega_id, en.estado, en.fecha_entrega AS fecha_entregada,
           en.revisada, en.revision_comentario, en.revision_fecha, en.archivo_path,
           en.nombre_original, en.comentario_estudiante, en.enviada_at, en.es_tardia
    FROM entregas en
    JOIN tareas t ON t.id = en.tarea_id
    JOIN asignaciones a ON a.id = t.asignacion_id
    JOIN materias m ON m.id = a.materia_id
    JOIN cursos c ON c.id = a.curso_id
    WHERE en.estudiante_id = ? AND c.gestion_id = ?
    ORDER BY t.fecha_publicacion DESC
  `).all(estudianteId, est.gestion_id);

  const asistencias = db.prepare('SELECT estado, fecha FROM asistencias WHERE estudiante_id = ?').all(estudianteId);
  const resumenAsis = resumenAsistencia(asistencias);

  const observaciones = db.prepare(`
    SELECT o.id, o.tipo, o.descripcion, o.fecha, u.nombres || ' ' || u.apellidos AS docente, m.nombre AS materia
    FROM observaciones o
    JOIN usuarios u ON u.id = o.docente_id
    LEFT JOIN asignaciones a ON a.id = o.asignacion_id
    LEFT JOIN materias m ON m.id = a.materia_id
    WHERE o.estudiante_id = ? ORDER BY o.fecha DESC
  `).all(estudianteId);

  return {
    estudiante: { id: est.id, rude: est.rude, nombres: est.nombres, apellidos: est.apellidos, fecha_nacimiento: est.fecha_nacimiento },
    curso: { id: est.curso_id, nombre: est.curso },
    gestion: est.gestion,
    materias,
    tareas,
    asistencia: resumenAsis,
    observaciones,
  };
}

// ---------- EXPEDIENTE ----------
router.get('/expediente/:estudiante_id', asyncHandler(async (req, res) => {
  const estudianteId = Number(req.params.estudiante_id);
  if (!esEnteroPositivo(estudianteId)) throw badRequest('estudiante_id inválido');
  if (!puedeVerExpediente(req.usuario, estudianteId)) throw prohibido('No tiene permiso para ver este expediente');
  const data = expedienteDe(estudianteId);
  if (!data) throw noEncontrado('Estudiante no encontrado');
  res.json(data);
}));

router.get('/expediente/:estudiante_id/asistencias', asyncHandler(async (req, res) => {
  const estudianteId = Number(req.params.estudiante_id);
  if (!esEnteroPositivo(estudianteId)) throw badRequest('estudiante_id inválido');
  if (!puedeVerExpediente(req.usuario, estudianteId)) throw prohibido('No tiene permiso para ver este expediente');
  const { desde, hasta } = req.query;
  let sql = 'SELECT fecha, estado FROM asistencias WHERE estudiante_id = ?';
  const params = [estudianteId];
  if (desde) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw badRequest('desde debe tener formato YYYY-MM-DD');
    sql += ' AND fecha >= ?'; params.push(desde);
  }
  if (hasta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw badRequest('hasta debe tener formato YYYY-MM-DD');
    sql += ' AND fecha <= ?'; params.push(hasta);
  }
  sql += ' ORDER BY fecha';
  res.json({ estudiante_id: estudianteId, desde: desde || null, hasta: hasta || null, asistencias: db.prepare(sql).all(...params) });
}));

function puedeGestionarEntrega(usuario, estudianteId) {
  if (usuario.rol === 'admin') return true;
  if (usuario.rol === 'tutor') return !!db.prepare('SELECT id FROM tutor_estudiante WHERE tutor_id=? AND estudiante_id=?').get(usuario.id, estudianteId);
  if (usuario.rol === 'estudiante') { const est = estudianteDeUsuario(usuario.id); return !!est && est.id === Number(estudianteId); }
  return false;
}

router.post('/entregas/:id/enviar', uploadEntrega.single('archivo'), asyncHandler(async (req, res) => {
  const entrega = db.prepare(`
    SELECT en.*, t.titulo, t.fecha_entrega, e.nombres, e.apellidos
    FROM entregas en JOIN tareas t ON t.id=en.tarea_id JOIN estudiantes e ON e.id=en.estudiante_id
    WHERE en.id=?
  `).get(req.params.id);
  if (!entrega) throw noEncontrado('Entrega no encontrada');
  if (!puedeGestionarEntrega(req.usuario, entrega.estudiante_id)) throw prohibido('No puede enviar esta entrega');
  if (!req.file && !req.body.comentario) throw badRequest('Adjunta un archivo o escribe un comentario');
  const anterior = entrega.archivo_path ? path.join(UPLOAD_DIR, entrega.archivo_path) : null;
  const archivo = req.file ? path.basename(req.file.path) : entrega.archivo_path;
  const fechaEntrega = new Date();
  const limite = entrega.fecha_entrega ? new Date(`${entrega.fecha_entrega}T23:59:59`) : null;
  const tardia = limite && fechaEntrega > limite ? 1 : 0;
  db.prepare(`UPDATE entregas SET estado='completada', fecha_entrega=?, enviada_at=?, archivo_path=?, nombre_original=?, mime_type=?, archivo_size=?, comentario_estudiante=?, es_tardia=?, revisada=0, revision_comentario=NULL, revision_fecha=NULL, revision_docente_id=NULL WHERE id=?`)
    .run(fechaEntrega.toISOString().slice(0, 10), fechaEntrega.toISOString(), archivo, req.file?.originalname || entrega.nombre_original, req.file?.mimetype || entrega.mime_type, req.file?.size || entrega.archivo_size, req.body.comentario?.trim() || entrega.comentario_estudiante, tardia, entrega.id);
  if (anterior && req.file && anterior !== path.join(UPLOAD_DIR, archivo)) { try { fs.unlinkSync(anterior); } catch (_) {} }
  res.json({ mensaje: 'Entrega enviada correctamente', estado: 'completada', es_tardia: !!tardia, tiene_archivo: !!archivo });
}));

router.get('/entregas/:id/archivo', asyncHandler(async (req, res) => {
  const entrega = db.prepare(`SELECT en.*, e.nombres, e.apellidos, a.docente_id
    FROM entregas en JOIN estudiantes e ON e.id=en.estudiante_id
    JOIN tareas t ON t.id=en.tarea_id JOIN asignaciones a ON a.id=t.asignacion_id
    WHERE en.id=?`).get(req.params.id);
  const accesoDocente = req.usuario.rol === 'docente' && entrega?.docente_id === req.usuario.id;
  if (!entrega || (!puedeGestionarEntrega(req.usuario, entrega.estudiante_id) && !accesoDocente)) throw prohibido('No puede descargar esta evidencia');
  if (!entrega.archivo_path) throw noEncontrado('La entrega no tiene archivo');
  const archivo = path.join(UPLOAD_DIR, path.basename(entrega.archivo_path));
  if (!fs.existsSync(archivo)) throw noEncontrado('El archivo ya no existe');
  res.download(archivo, entrega.nombre_original || path.basename(archivo));
}));

// ---------- MARCAR ENTREGA (estudiante/tutor; admin/docente también) ----------
router.put('/entregas/marcar', asyncHandler(async (req, res) => {
  const { tarea_id, estudiante_id, estado } = req.body || {};
  requerirCampos({ tarea_id, estudiante_id, estado }, ['tarea_id', 'estudiante_id', 'estado']);
  if (!['completada', 'pendiente'].includes(estado)) throw badRequest("estado debe ser 'completada' o 'pendiente'");
  if (!esEnteroPositivo(tarea_id) || !esEnteroPositivo(estudiante_id)) throw badRequest('IDs inválidos');
  const u = req.usuario;
  if (u.rol === 'tutor') {
    const v = db.prepare('SELECT id FROM tutor_estudiante WHERE tutor_id = ? AND estudiante_id = ?').get(u.id, estudiante_id);
    if (!v) throw prohibido('No está vinculado a este estudiante');
  } else if (u.rol === 'estudiante') {
    const est = estudianteDeUsuario(u.id);
    if (!est || est.id !== Number(estudiante_id)) throw prohibido('Solo puede marcar sus propias tareas');
  } else if (u.rol === 'docente') {
    const permiso = db.prepare(`
      SELECT a.id FROM tareas t
      JOIN asignaciones a ON a.id = t.asignacion_id
      WHERE t.id = ? AND a.docente_id = ?
    `).get(tarea_id, u.id);
    if (!permiso) throw prohibido('No puede modificar entregas de otro docente');
  }
  const ent = db.prepare('SELECT * FROM entregas WHERE tarea_id = ? AND estudiante_id = ?').get(tarea_id, estudiante_id);
  if (!ent) throw noEncontrado('Entrega no encontrada (la tarea no está dirigida a este estudiante)');
  db.prepare(`UPDATE entregas SET estado=?, fecha_entrega=?, enviada_at=?, es_tardia=0,
    revisada=CASE WHEN ?='pendiente' THEN 0 ELSE revisada END,
    revision_comentario=CASE WHEN ?='pendiente' THEN NULL ELSE revision_comentario END,
    revision_fecha=CASE WHEN ?='pendiente' THEN NULL ELSE revision_fecha END,
    revision_docente_id=CASE WHEN ?='pendiente' THEN NULL ELSE revision_docente_id END
    WHERE id=?`).run(estado, estado === 'completada' ? new Date().toISOString().slice(0, 10) : null, estado === 'completada' ? new Date().toISOString() : null, estado, estado, estado, estado, ent.id);
  res.json({ mensaje: 'Entrega actualizada correctamente', estado });
}));

// ---------- NOTIFICACIONES ----------
router.get('/notificaciones', asyncHandler(async (req, res) => {
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(50, Math.max(1, Number(req.query.por_pagina) || 20));
  const total = db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ?').get(req.usuario.id).n;
  const datos = db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(req.usuario.id, porPagina, (pagina - 1) * porPagina);
  const noLeidas = db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida = 0').get(req.usuario.id).n;
  res.json({ total, pagina, por_pagina: porPagina, no_leidas: noLeidas, notificaciones: datos });
}));

router.put('/notificaciones/leer', asyncHandler(async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest('ids debe ser un arreglo de identificadores');
  const marcar = db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?');
  let marcadas = 0;
  for (const id of ids) {
    if (!esEnteroPositivo(id)) throw badRequest('ID de notificación inválido');
    marcadas += Number(marcar.run(id, req.usuario.id).changes);
  }
  res.json({ mensaje: 'Notificaciones marcadas como leídas', marcadas });
}));

router.put('/notificaciones/:id/leer', asyncHandler(async (req, res) => {
  if (!esEnteroPositivo(req.params.id)) throw badRequest('ID inválido');
  const r = db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
  if (!r.changes) throw noEncontrado('Notificación no encontrada');
  res.json({ mensaje: 'Notificación marcada como leída' });
}));

// ---------- COMUNICADOS (lectura, según rol) ----------
router.get('/comunicados', asyncHandler(async (req, res) => {
  const u = req.usuario;
  const filas = db.prepare(`
    SELECT cm.id, cm.titulo, cm.mensaje, cm.dirigido_a, cm.curso_id, cm.fecha,
           c.nombre AS curso, au.nombres || ' ' || au.apellidos AS autor
    FROM comunicados cm
    LEFT JOIN cursos c ON c.id = cm.curso_id
    JOIN usuarios au ON au.id = cm.autor_id
    ORDER BY cm.fecha DESC
  `).all();
  const visibles = filas.filter((cm) => {
    if (u.rol === 'admin') return true;
    if (u.rol === 'docente') return cm.dirigido_a === 'todos' || cm.dirigido_a === 'docentes';
    if (u.rol === 'tutor') {
      if (cm.dirigido_a === 'todos' && !cm.curso_id) return true;
      if (cm.dirigido_a === 'padres' || (cm.dirigido_a === 'todos' && cm.curso_id)) {
        if (!cm.curso_id) return cm.dirigido_a === 'padres';
        const hijo = db.prepare(`
          SELECT te.id FROM tutor_estudiante te JOIN estudiantes e ON e.id = te.estudiante_id
          WHERE te.tutor_id = ? AND e.curso_id = ?
        `).get(u.id, cm.curso_id);
        return !!hijo;
      }
      return false;
    }
    if (u.rol === 'estudiante') {
      if (cm.dirigido_a !== 'todos') return false;
      if (!cm.curso_id) return true;
      const est = estudianteDeUsuario(u.id);
      return est && est.curso_id === cm.curso_id;
    }
    return false;
  });
  res.json(visibles);
}));

module.exports = router;
