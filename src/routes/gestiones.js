const express = require('express');
const db = require('../db');
const { requireRole, requerirCampos, badRequest, noEncontrado, conflicto, asyncHandler } = require('../middleware');

const router = express.Router();
router.use(['/gestiones'], requireRole('admin'));

// ---------- GESTIONES (años escolares) ----------
router.get('/gestiones', asyncHandler(async (req, res) => {
  res.json(db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM cursos c WHERE c.gestion_id = g.id) AS total_cursos
    FROM gestiones g ORDER BY g.anio DESC
  `).all());
}));

router.post('/gestiones', asyncHandler(async (req, res) => {
  const { anio } = req.body || {};
  requerirCampos({ anio }, ['anio']);
  const valor = Number(anio);
  if (!Number.isInteger(valor) || valor < 2000 || valor > 2100) throw badRequest('anio inválido (2000-2100)');
  const existe = db.prepare('SELECT id FROM gestiones WHERE anio = ?').get(valor);
  if (existe) throw conflicto('Ya existe esa gestión');
  const r = db.prepare('INSERT INTO gestiones (anio, activa) VALUES (?,0)').run(valor);
  res.status(201).json({ id: Number(r.lastInsertRowid), anio: valor, activa: 0 });
}));

// Activar una gestión (y desactivar las demás, en una sola transacción)
router.put('/gestiones/:id/activar', asyncHandler(async (req, res) => {
  const g = db.prepare('SELECT * FROM gestiones WHERE id = ?').get(req.params.id);
  if (!g) throw noEncontrado('Gestión no encontrada');
  db.tx(() => {
    db.prepare('UPDATE gestiones SET activa = 0 WHERE activa = 1').run();
    db.prepare('UPDATE gestiones SET activa = 1 WHERE id = ?').run(g.id);
  });
  res.json({ mensaje: `Gestión ${g.anio} activada correctamente` });
}));

// Desactivar sin activar otra (permitido; el sistema exige gestión activa solo para ciertas acciones)
router.put('/gestiones/:id/desactivar', asyncHandler(async (req, res) => {
  const g = db.prepare('SELECT * FROM gestiones WHERE id = ?').get(req.params.id);
  if (!g) throw noEncontrado('Gestión no encontrada');
  db.prepare('UPDATE gestiones SET activa = 0 WHERE id = ?').run(g.id);
  res.json({ mensaje: `Gestión ${g.anio} desactivada` });
}));

module.exports = router;
