const express = require('express');
const db = require('../db');
const { cualitativo, promedioBimestre } = require('../helpers');
const { requireRole, badRequest, noEncontrado, prohibido, asyncHandler, puedeVerExpediente, esEnteroPositivo } = require('../middleware');

const router = express.Router();
router.use(['/reportes'], requireRole('admin', 'docente'));

function cursoPermitido(usuario, cursoId) {
  if (usuario.rol === 'admin') return true;
  const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(usuario.id, cursoId);
  return !!perm;
}

// ---------- RENDIMIENTO POR CURSO ----------
router.get('/reportes/rendimiento', asyncHandler(async (req, res) => {
  const { curso_id, gestion } = req.query;
  if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id es obligatorio');
  if (!cursoPermitido(req.usuario, Number(curso_id))) throw prohibido('No tiene ese curso asignado');
  const curso = db.prepare('SELECT c.*, g.anio FROM cursos c JOIN gestiones g ON g.id = c.gestion_id WHERE c.id = ?').get(curso_id);
  if (!curso) throw noEncontrado('Curso no encontrado');

  let gestionId = curso.gestion_id;
  let gestionAnio = curso.anio;
  if (gestion) {
    const g = db.prepare('SELECT * FROM gestiones WHERE anio = ?').get(Number(gestion));
    if (!g) throw noEncontrado('Gestión no encontrada');
    gestionId = g.id;
    gestionAnio = g.anio;
  }

  const asignaciones = db.prepare(`
    SELECT a.materia_id, m.nombre AS materia
    FROM asignaciones a JOIN materias m ON m.id = a.materia_id
    WHERE a.curso_id = ? AND a.gestion_id = ?
    ORDER BY m.nombre
  `).all(curso_id, gestionId);

  const notas = db.prepare(`
    SELECT n.materia_id, n.ser, n.saber, n.hacer, n.decidir
    FROM notas n
    JOIN estudiantes e ON e.id = n.estudiante_id
    JOIN cursos c ON c.id = e.curso_id
    WHERE e.curso_id = ? AND c.gestion_id = ?
  `).all(curso_id, gestionId);

  const porMateria = {};
  for (const n of notas) {
    const prom = promedioBimestre(n);
    (porMateria[n.materia_id] = porMateria[n.materia_id] || []).push(prom);
  }

  const totalEstudiantes = db.prepare('SELECT COUNT(*) AS n FROM estudiantes WHERE curso_id = ?').get(curso_id).n;

  const resultado = asignaciones.map((a) => {
    const proms = porMateria[a.materia_id] || [];
    const promCurso = proms.length ? Math.round((proms.reduce((x, y) => x + y, 0) / proms.length) * 100) / 100 : null;
    const enRiesgo = proms.filter((p) => p < 50).length;
    const distribucion = { Domina: 0, Sobresaliente: 0, Distinguido: 0, Bueno: 0, Suficiente: 0, Insuficiente: 0 };
    for (const p of proms) {
      const cat = cualitativo(p);
      if (cat) distribucion[cat]++;
    }
    return {
      materia_id: a.materia_id,
      materia: a.materia,
      promedio_curso: promCurso,
      total_notas: proms.length,
      total_estudiantes: totalEstudiantes,
      en_riesgo: enRiesgo,
      porcentaje_riesgo: proms.length ? Math.round((enRiesgo / proms.length) * 10000) / 100 : null,
      distribucion_cualitativa: distribucion,
    };
  });

  res.json({ curso: { id: curso.id, nombre: curso.nombre }, gestion: gestionAnio, materias: resultado });
}));

// ---------- ESTUDIANTES EN RIESGO ----------
router.get('/reportes/riesgo', asyncHandler(async (req, res) => {
  const { curso_id } = req.query;
  if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id es obligatorio');
  if (!cursoPermitido(req.usuario, Number(curso_id))) throw prohibido('No tiene ese curso asignado');
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(curso_id);
  if (!curso) throw noEncontrado('Curso no encontrado');

  // Trimestre "actual": el mayor trimestre con notas registradas en el curso
  const bimActual = db.prepare(`
    SELECT MAX(n.bimestre) AS b FROM notas n JOIN estudiantes e ON e.id = n.estudiante_id
    WHERE e.curso_id = ?
  `).get(curso_id).b || 0;

  const estudiantes = db.prepare('SELECT id, rude, nombres, apellidos FROM estudiantes WHERE curso_id = ? ORDER BY apellidos').all(curso_id);
  const enRiesgo = [];
  for (const e of estudiantes) {
    const notas = db.prepare('SELECT n.*, m.nombre AS materia FROM notas n JOIN materias m ON m.id = n.materia_id WHERE n.estudiante_id = ?').all(e.id);
    const porMateria = {};
    for (const n of notas) {
      const acc = (porMateria[n.materia_id] = porMateria[n.materia_id] || { materia: n.materia, bimestres: [] });
      acc.bimestres[n.bimestre] = promedioBimestre(n);
    }
    const materiasRiesgo = [];
    for (const [mid, acc] of Object.entries(porMateria)) {
      const regs = acc.bimestres.filter((x) => x !== undefined);
      const anual = regs.length ? regs.reduce((a, b) => a + b, 0) / regs.length : null;
      const promActual = bimActual > 0 ? (acc.bimestres[bimActual] ?? null) : null;
      if ((promActual !== null && promActual < 50) || (anual !== null && anual < 51)) {
        materiasRiesgo.push({
          materia_id: Number(mid),
          materia: acc.materia,
          promedio_bimestre_actual: promActual,
          promedio_anual: Math.round(anual * 100) / 100,
        });
      }
    }
    if (materiasRiesgo.length) {
      enRiesgo.push({ estudiante: e, trimestre_actual: bimActual, materias_en_riesgo: materiasRiesgo });
    }
  }
  res.json({ curso: { id: curso.id, nombre: curso.nombre }, trimestre_actual: bimActual, estudiantes: enRiesgo });
}));

// ---------- HISTORIAL POR ESTUDIANTE (todas las gestiones) ----------
router.get('/reportes/historial/:estudiante_id', asyncHandler(async (req, res) => {
  const estudianteId = Number(req.params.estudiante_id);
  if (!esEnteroPositivo(estudianteId)) throw badRequest('estudiante_id inválido');
  const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
  if (!est) throw noEncontrado('Estudiante no encontrado');
  if (req.usuario.rol === 'docente' && !puedeVerExpediente(req.usuario, estudianteId)) {
    const perm = db.prepare('SELECT id FROM asignaciones WHERE docente_id = ? AND curso_id = ?').get(req.usuario.id, est.curso_id);
    if (!perm) throw prohibido('No tiene permiso para ver el historial de este estudiante');
  }
  const notas = db.prepare(`
    SELECT n.*, m.nombre AS materia, c.nombre AS curso, g.anio
    FROM notas n
    JOIN estudiantes e ON e.id = n.estudiante_id
    JOIN cursos c ON c.id = e.curso_id
    JOIN gestiones g ON g.id = c.gestion_id
    JOIN materias m ON m.id = n.materia_id
    WHERE n.estudiante_id = ? ORDER BY g.anio, m.nombre, n.bimestre
  `).all(estudianteId);
  res.json({
    estudiante: { id: est.id, rude: est.rude, nombres: est.nombres, apellidos: est.apellidos },
    notas: notas.map((n) => ({ ...n, promedio: promedioBimestre(n), cualitativo: cualitativo(promedioBimestre(n)) })),
  });
}));

module.exports = router;
