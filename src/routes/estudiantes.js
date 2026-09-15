const express = require('express');
const multer = require('multer');
const db = require('../db');
const {
  requireRole, requerirCampos, badRequest, noEncontrado, conflicto,
  asyncHandler, esEnteroPositivo,
} = require('../middleware');

const router = express.Router();
router.use(['/estudiantes'], requireRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function generarRude(cursoId) {
  const curso = db.prepare('SELECT c.*, g.anio FROM cursos c JOIN gestiones g ON g.id = c.gestion_id WHERE c.id = ?').get(cursoId);
  if (!curso) throw noEncontrado('Curso no encontrado');
  const letra = curso.nombre.charAt(0); // ej. "1° Secundaria" -> "1"
  const n = curso.nombre.toUpperCase().includes('SECUNDARIA') ? 'S' : 'P';
  const prefijo = `${curso.anio}-${letra}${n}`;
  const ultimo = db.prepare("SELECT rude FROM estudiantes WHERE rude LIKE ? ORDER BY rude DESC LIMIT 1").get(`${prefijo}-%`);
  const corr = ultimo ? Number(ultimo.rude.slice(-3)) + 1 : 1;
  return `${prefijo}-${String(corr).padStart(3, '0')}`;
}

function cursoTieneCupo(cursoId) {
  const curso = db.prepare('SELECT capacidad_max FROM cursos WHERE id = ?').get(cursoId);
  if (!curso) throw noEncontrado('Curso no encontrado');
  const total = db.prepare('SELECT COUNT(*) AS n FROM estudiantes WHERE curso_id = ?').get(cursoId).n;
  if (total >= curso.capacidad_max) throw conflicto('El curso alcanzó su capacidad máxima (40 estudiantes)');
}

router.get('/estudiantes', asyncHandler(async (req, res) => {
  const { curso_id } = req.query;
  let sql = `SELECT e.*, c.nombre AS curso, g.anio AS gestion, u.username
             FROM estudiantes e
             JOIN cursos c ON c.id = e.curso_id
             JOIN gestiones g ON g.id = c.gestion_id
             LEFT JOIN usuarios u ON u.id = e.usuario_id`;
  const params = [];
  if (curso_id) {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    sql += ' WHERE e.curso_id = ?';
    params.push(Number(curso_id));
  }
  sql += ' ORDER BY e.apellidos, e.nombres';
  res.json(db.prepare(sql).all(...params));
}));

router.post('/estudiantes', asyncHandler(async (req, res) => {
  const { nombres, apellidos, fecha_nacimiento, curso_id, rude } = req.body || {};
  requerirCampos({ nombres, apellidos, curso_id }, ['nombres', 'apellidos', 'curso_id']);
  if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(curso_id);
  if (!curso) throw noEncontrado('Curso no encontrado');
  cursoTieneCupo(curso_id);
  let rudeFinal = rude;
  if (rudeFinal) {
    const existe = db.prepare('SELECT id FROM estudiantes WHERE rude = ?').get(rudeFinal);
    if (existe) throw conflicto('El RUDE ya está registrado');
  } else {
    rudeFinal = generarRude(curso_id);
  }
  const r = db.prepare('INSERT INTO estudiantes (rude, nombres, apellidos, fecha_nacimiento, curso_id) VALUES (?,?,?,?,?)')
    .run(rudeFinal, nombres, apellidos, fecha_nacimiento || null, curso_id);
  res.status(201).json({ id: Number(r.lastInsertRowid), rude: rudeFinal, nombres, apellidos, curso_id });
}));

router.put('/estudiantes/:id', asyncHandler(async (req, res) => {
  const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(req.params.id);
  if (!est) throw noEncontrado('Estudiante no encontrado');
  const { nombres, apellidos, fecha_nacimiento, curso_id, rude, usuario_id } = req.body || {};
  if (curso_id && Number(curso_id) !== est.curso_id) {
    const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(curso_id);
    if (!curso) throw noEncontrado('Curso no encontrado');
    cursoTieneCupo(curso_id);
  }
  if (rude && rude !== est.rude) {
    const existe = db.prepare('SELECT id FROM estudiantes WHERE rude = ? AND id != ?').get(rude, est.id);
    if (existe) throw conflicto('El RUDE ya está registrado');
  }
  if (usuario_id) {
    const u = db.prepare("SELECT id FROM usuarios WHERE id = ? AND rol = 'estudiante'").get(usuario_id);
    if (!u) throw badRequest('usuario_id debe ser un usuario con rol estudiante');
    const vinculado = db.prepare('SELECT id FROM estudiantes WHERE usuario_id = ? AND id != ?').get(usuario_id, est.id);
    if (vinculado) throw conflicto('Ese usuario ya está vinculado a otro estudiante');
  }
  db.prepare('UPDATE estudiantes SET nombres=?, apellidos=?, fecha_nacimiento=?, curso_id=?, rude=?, usuario_id=? WHERE id=?')
    .run(
      nombres || est.nombres,
      apellidos || est.apellidos,
      fecha_nacimiento !== undefined ? fecha_nacimiento : est.fecha_nacimiento,
      curso_id || est.curso_id,
      rude || est.rude,
      usuario_id !== undefined ? usuario_id : est.usuario_id,
      est.id
    );
  res.json({ mensaje: 'Estudiante actualizado correctamente' });
}));

router.delete('/estudiantes/:id', asyncHandler(async (req, res) => {
  const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(req.params.id);
  if (!est) throw noEncontrado('Estudiante no encontrado');
  db.prepare('DELETE FROM estudiantes WHERE id = ?').run(est.id);
  res.json({ mensaje: 'Estudiante eliminado correctamente' });
}));

// ---------- IMPORT / EXPORT CSV ----------
function parseCsv(texto) {
  const filas = [];
  let campo = '', fila = [], enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((f) => f !== '')) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); if (fila.some((f) => f !== '')) filas.push(fila); }
  return filas;
}

function aCsv(filas) {
  return filas.map((f) => f.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

router.post('/estudiantes/import', upload.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest("Debe adjuntar un archivo CSV en el campo 'archivo'");
  const texto = req.file.buffer.toString('utf-8');
  const filas = parseCsv(texto);
  if (filas.length < 2) throw badRequest('El CSV está vacío o no tiene datos');
  const cabeceras = filas[0].map((h) => h.trim().toLowerCase());
  const idx = {
    nombres: cabeceras.indexOf('nombres'),
    apellidos: cabeceras.indexOf('apellidos'),
    fecha_nacimiento: cabeceras.indexOf('fecha_nacimiento'),
    curso_id: cabeceras.indexOf('curso_id'),
    rude: cabeceras.indexOf('rude'),
  };
  if (idx.nombres === -1 || idx.apellidos === -1 || idx.curso_id === -1) {
    throw badRequest("El CSV debe tener las columnas: nombres,apellidos,fecha_nacimiento,curso_id,rude");
  }
  let creados = 0;
  const errores = [];
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const n = i + 1; // número de línea
    try {
      const nombres = (f[idx.nombres] || '').trim();
      const apellidos = (f[idx.apellidos] || '').trim();
      const fecha = idx.fecha_nacimiento >= 0 ? (f[idx.fecha_nacimiento] || '').trim() || null : null;
      const cursoId = Number((f[idx.curso_id] || '').trim());
      const rude = idx.rude >= 0 ? (f[idx.rude] || '').trim() || null : null;
      if (!nombres || !apellidos) throw new Error('nombres/apellidos vacíos');
      if (!esEnteroPositivo(cursoId)) throw new Error('curso_id inválido');
      const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(cursoId);
      if (!curso) throw new Error('curso no existe');
      const total = db.prepare('SELECT COUNT(*) AS n FROM estudiantes WHERE curso_id = ?').get(cursoId).n;
      if (total >= curso.capacidad_max) throw new Error('curso sin cupo');
      let rudeFinal = rude;
      if (rudeFinal) {
        if (db.prepare('SELECT id FROM estudiantes WHERE rude = ?').get(rudeFinal)) throw new Error('RUDE duplicado');
      } else {
        rudeFinal = generarRude(cursoId);
      }
      db.prepare('INSERT INTO estudiantes (rude, nombres, apellidos, fecha_nacimiento, curso_id) VALUES (?,?,?,?,?)')
        .run(rudeFinal, nombres, apellidos, fecha, cursoId);
      creados++;
    } catch (e) {
      errores.push({ linea: n, error: e.message });
    }
  }
  res.status(201).json({ creados, errores });
}));

router.get('/estudiantes/export', asyncHandler(async (req, res) => {
  const { curso_id } = req.query;
  let sql = `SELECT e.rude, e.nombres, e.apellidos, e.fecha_nacimiento, e.curso_id, c.nombre AS curso
             FROM estudiantes e JOIN cursos c ON c.id = e.curso_id`;
  const params = [];
  if (curso_id) {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    sql += ' WHERE e.curso_id = ?';
    params.push(Number(curso_id));
  }
  sql += ' ORDER BY e.curso_id, e.apellidos, e.nombres';
  const datos = db.prepare(sql).all(...params);
  const filas = [['rude', 'nombres', 'apellidos', 'fecha_nacimiento', 'curso_id', 'curso']];
  for (const d of datos) filas.push([d.rude, d.nombres, d.apellidos, d.fecha_nacimiento || '', d.curso_id, d.curso]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="estudiantes${curso_id ? `-curso-${curso_id}` : ''}.csv"`);
  res.send('﻿' + aCsv(filas));
}));

module.exports = router;
