const express = require('express');
const db = require('../db');
const {
  requireRole, requerirCampos, badRequest, noEncontrado, conflicto,
  asyncHandler, gestionActiva, esEnteroPositivo,
} = require('../middleware');

const router = express.Router();
router.use(['/asignaciones', '/vinculos'], requireRole('admin'));

// ---------- ASIGNACIONES ----------
router.get('/asignaciones', asyncHandler(async (req, res) => {
  const { docente_id, curso_id, gestion } = req.query;
  let sql = `SELECT a.*, u.nombres || ' ' || u.apellidos AS docente, m.nombre AS materia,
                    c.nombre AS curso, g.anio AS gestion_anio
             FROM asignaciones a
             JOIN usuarios u ON u.id = a.docente_id
             JOIN materias m ON m.id = a.materia_id
             JOIN cursos c ON c.id = a.curso_id
             JOIN gestiones g ON g.id = a.gestion_id`;
  const cond = [], params = [];
  if (docente_id) {
    if (!esEnteroPositivo(docente_id)) throw badRequest('docente_id inválido');
    cond.push('a.docente_id = ?'); params.push(Number(docente_id));
  }
  if (curso_id) {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    cond.push('a.curso_id = ?'); params.push(Number(curso_id));
  }
  if (gestion) {
    cond.push('g.anio = ?'); params.push(Number(gestion));
  }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY g.anio DESC, c.nombre, m.nombre';
  res.json(db.prepare(sql).all(...params));
}));

router.post('/asignaciones', asyncHandler(async (req, res) => {
  const { docente_id, materia_id, curso_id, gestion_id } = req.body || {};
  requerirCampos({ docente_id, materia_id, curso_id }, ['docente_id', 'materia_id', 'curso_id']);
  for (const [k, v] of Object.entries({ docente_id, materia_id, curso_id })) {
    if (!esEnteroPositivo(v)) throw badRequest(`${k} inválido`);
  }
  const docente = db.prepare("SELECT id FROM usuarios WHERE id = ? AND rol = 'docente'").get(docente_id);
  if (!docente) throw badRequest('El docente no existe');
  const materia = db.prepare('SELECT id FROM materias WHERE id = ?').get(materia_id);
  if (!materia) throw noEncontrado('La materia no existe');
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(curso_id);
  if (!curso) throw noEncontrado('El curso no existe');

  let gid;
  if (gestion_id) {
    if (!esEnteroPositivo(gestion_id)) throw badRequest('gestion_id inválido');
    const g = db.prepare('SELECT id FROM gestiones WHERE id = ?').get(gestion_id);
    if (!g) throw noEncontrado('La gestión no existe');
    gid = Number(gestion_id);
  } else {
    const g = gestionActiva();
    if (!g) throw badRequest('No hay una gestión activa');
    gid = g.id;
  }
  const existe = db.prepare('SELECT id FROM asignaciones WHERE docente_id=? AND materia_id=? AND curso_id=? AND gestion_id=?')
    .get(docente_id, materia_id, curso_id, gid);
  if (existe) throw conflicto('Esa asignación ya existe');
  const r = db.prepare('INSERT INTO asignaciones (docente_id, materia_id, curso_id, gestion_id) VALUES (?,?,?,?)')
    .run(docente_id, materia_id, curso_id, gid);
  res.status(201).json({ id: Number(r.lastInsertRowid), docente_id, materia_id, curso_id, gestion_id: gid });
}));

router.delete('/asignaciones/:id', asyncHandler(async (req, res) => {
  const a = db.prepare('SELECT * FROM asignaciones WHERE id = ?').get(req.params.id);
  if (!a) throw noEncontrado('Asignación no encontrada');
  db.prepare('DELETE FROM asignaciones WHERE id = ?').run(a.id);
  res.json({ mensaje: 'Asignación eliminada correctamente' });
}));

// ---------- VÍNCULOS TUTOR-ESTUDIANTE ----------
router.get('/vinculos', asyncHandler(async (req, res) => {
  const { tutor_id } = req.query;
  let sql = `SELECT te.id, te.tutor_id, te.estudiante_id,
                    u.nombres || ' ' || u.apellidos AS tutor,
                    e.nombres || ' ' || e.apellidos AS estudiante, e.rude
             FROM tutor_estudiante te
             JOIN usuarios u ON u.id = te.tutor_id
             JOIN estudiantes e ON e.id = te.estudiante_id`;
  const params = [];
  if (tutor_id) {
    if (!esEnteroPositivo(tutor_id)) throw badRequest('tutor_id inválido');
    sql += ' WHERE te.tutor_id = ?';
    params.push(Number(tutor_id));
  }
  res.json(db.prepare(sql).all(...params));
}));

router.post('/vinculos', asyncHandler(async (req, res) => {
  const { tutor_id, estudiante_id } = req.body || {};
  requerirCampos({ tutor_id, estudiante_id }, ['tutor_id', 'estudiante_id']);
  if (!esEnteroPositivo(tutor_id) || !esEnteroPositivo(estudiante_id)) throw badRequest('IDs inválidos');
  const tutor = db.prepare("SELECT id FROM usuarios WHERE id = ? AND rol = 'tutor'").get(tutor_id);
  if (!tutor) throw badRequest('El tutor no existe');
  const est = db.prepare('SELECT id FROM estudiantes WHERE id = ?').get(estudiante_id);
  if (!est) throw noEncontrado('El estudiante no existe');
  const existe = db.prepare('SELECT id FROM tutor_estudiante WHERE tutor_id=? AND estudiante_id=?').get(tutor_id, estudiante_id);
  if (existe) throw conflicto('El vínculo ya existe');
  const r = db.prepare('INSERT INTO tutor_estudiante (tutor_id, estudiante_id) VALUES (?,?)').run(tutor_id, estudiante_id);
  res.status(201).json({ id: Number(r.lastInsertRowid), tutor_id, estudiante_id });
}));

router.delete('/vinculos/:id', asyncHandler(async (req, res) => {
  const v = db.prepare('SELECT * FROM tutor_estudiante WHERE id = ?').get(req.params.id);
  if (!v) throw noEncontrado('Vínculo no encontrado');
  db.prepare('DELETE FROM tutor_estudiante WHERE id = ?').run(v.id);
  res.json({ mensaje: 'Vínculo eliminado correctamente' });
}));

module.exports = router;
