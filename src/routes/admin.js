const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  requireRole, requerirCampos, badRequest, noEncontrado, conflicto,
  asyncHandler, gestionActiva, esEnteroPositivo,
} = require('../middleware');

const router = express.Router();
router.use(['/usuarios', '/cursos', '/materias', '/admin/notificaciones'], requireRole('admin'));

const ROLES = ['admin', 'docente', 'tutor', 'estudiante', 'asistencia'];
function normalizarNombreMateria(nombre) {
  return String(nombre || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// ---------- GESTIÓN DE NOTIFICACIONES ----------
router.get('/admin/notificaciones', asyncHandler(async (req, res) => {
  const datos = db.prepare(`
    SELECT n.id, n.titulo, n.mensaje, n.tipo, n.leida, n.created_at,
           u.id AS usuario_id, u.nombres || ' ' || u.apellidos AS destinatario, u.rol
    FROM notificaciones n JOIN usuarios u ON u.id = n.usuario_id
    ORDER BY n.created_at DESC, n.id DESC LIMIT 300
  `).all();
  res.json(datos);
}));

router.post('/admin/notificaciones', asyncHandler(async (req, res) => {
  const { titulo, mensaje, tipo, destino, rol, usuario_id, curso_id } = req.body || {};
  requerirCampos({ titulo, mensaje, destino }, ['titulo', 'mensaje', 'destino']);
  const destinosValidos = ['todos', 'rol', 'usuario', 'curso'];
  if (!destinosValidos.includes(destino)) throw badRequest(`destino debe ser: ${destinosValidos.join(', ')}`);
  const rolesValidos = ['admin', 'docente', 'tutor', 'estudiante'];
  let usuarios;
  if (destino === 'todos') {
    usuarios = db.prepare('SELECT id FROM usuarios WHERE activo = 1').all();
  } else if (destino === 'rol') {
    if (!rolesValidos.includes(rol)) throw badRequest('rol inválido');
    usuarios = db.prepare('SELECT id FROM usuarios WHERE activo = 1 AND rol = ?').all(rol);
  } else if (destino === 'usuario') {
    if (!esEnteroPositivo(usuario_id)) throw badRequest('usuario_id inválido');
    const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').get(usuario_id);
    if (!usuario) throw noEncontrado('Usuario destinatario no encontrado');
    usuarios = [usuario];
  } else {
    if (!esEnteroPositivo(curso_id)) throw badRequest('curso_id inválido');
    const curso = db.prepare('SELECT id FROM cursos WHERE id = ?').get(curso_id);
    if (!curso) throw noEncontrado('Curso no encontrado');
    usuarios = db.prepare(`
      SELECT DISTINCT u.id FROM usuarios u
      LEFT JOIN tutor_estudiante te ON te.tutor_id = u.id
      LEFT JOIN estudiantes e ON e.id = te.estudiante_id
      LEFT JOIN asignaciones a ON a.docente_id = u.id AND a.curso_id = ?
      WHERE u.activo = 1 AND ((u.rol = 'tutor' AND e.curso_id = ?) OR (u.rol = 'docente' AND a.id IS NOT NULL))
    `).all(curso_id, curso_id);
  }
  if (!usuarios.length) throw badRequest('No hay destinatarios activos para ese filtro');
  const insertar = db.prepare('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?,?,?,?)');
  db.tx(() => usuarios.forEach((usuario) => insertar.run(usuario.id, String(titulo).trim(), String(mensaje).trim(), tipo || 'administrativa')));
  res.status(201).json({ mensaje: 'Notificación enviada correctamente', destinatarios: usuarios.length });
}));

router.delete('/admin/notificaciones/:id', asyncHandler(async (req, res) => {
  const resultado = db.prepare('DELETE FROM notificaciones WHERE id = ?').run(req.params.id);
  if (!resultado.changes) throw noEncontrado('Notificación no encontrada');
  res.json({ mensaje: 'Notificación eliminada correctamente' });
}));

// ---------- USUARIOS ----------
router.get('/usuarios', asyncHandler(async (req, res) => {
  const { rol } = req.query;
  let sql = 'SELECT id, username, rol, nombres, apellidos, email, telefono, activo, created_at FROM usuarios';
  const params = [];
  if (rol) {
    if (!ROLES.includes(rol)) throw badRequest('Rol inválido');
    sql += ' WHERE rol = ?';
    params.push(rol);
  }
  sql += ' ORDER BY apellidos, nombres';
  res.json(db.prepare(sql).all(...params));
}));

router.post('/usuarios', asyncHandler(async (req, res) => {
  const { username, password, rol, nombres, apellidos, email, telefono } = req.body || {};
  requerirCampos({ username, password, rol, nombres, apellidos }, ['username', 'password', 'rol', 'nombres', 'apellidos']);
  if (!ROLES.includes(rol)) throw badRequest('Rol inválido');
  const existe = db.prepare('SELECT id FROM usuarios WHERE username = ?').get(username);
  if (existe) throw conflicto('El nombre de usuario ya existe');
  if (String(password).length < 6) throw badRequest('La contraseña debe tener al menos 6 caracteres');
  const hash = await bcrypt.hash(String(password), 10);
  const r = db.prepare('INSERT INTO usuarios (username, password_hash, rol, nombres, apellidos, email, telefono) VALUES (?,?,?,?,?,?,?)')
    .run(username, hash, rol, nombres, apellidos, email || null, telefono || null);
  res.status(201).json({ id: Number(r.lastInsertRowid), username, rol, nombres, apellidos });
}));

router.put('/usuarios/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) throw noEncontrado('Usuario no encontrado');
  const { nombres, apellidos, email, telefono, password, rol, activo, username } = req.body || {};
  // Un admin no puede desactivarse ni cambiarse de rol a sí mismo (quedaría sin acceso)
  if (Number(id) === req.usuario.id) {
    if (activo !== undefined && !activo) throw badRequest('No puede desactivarse a sí mismo');
    if (rol && rol !== usuario.rol) throw badRequest('No puede cambiar su propio rol');
  }
  if (username && username !== usuario.username) {
    const existe = db.prepare('SELECT id FROM usuarios WHERE username = ? AND id != ?').get(username, id);
    if (existe) throw conflicto('El nombre de usuario ya existe');
  }
  if (rol && !ROLES.includes(rol)) throw badRequest('Rol inválido');
  let hash = usuario.password_hash;
  if (password) {
    if (String(password).length < 6) throw badRequest('La contraseña debe tener al menos 6 caracteres');
    hash = await bcrypt.hash(String(password), 10);
  }
  db.prepare('UPDATE usuarios SET username=?, nombres=?, apellidos=?, email=?, telefono=?, password_hash=?, rol=?, activo=? WHERE id=?')
    .run(
      username || usuario.username,
      nombres || usuario.nombres,
      apellidos || usuario.apellidos,
      email !== undefined ? email : usuario.email,
      telefono !== undefined ? telefono : usuario.telefono,
      hash,
      rol || usuario.rol,
      activo !== undefined ? (activo ? 1 : 0) : usuario.activo,
      id
    );
  res.json({ mensaje: 'Usuario actualizado correctamente' });
}));

router.delete('/usuarios/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (Number(id) === req.usuario.id) throw badRequest('No puede desactivarse a sí mismo');
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) throw noEncontrado('Usuario no encontrado');
  // Desactivar en lugar de borrar para preservar integridad histórica
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);
  res.json({ mensaje: 'Usuario desactivado correctamente' });
}));

// ---------- CURSOS ----------
router.get('/cursos', asyncHandler(async (req, res) => {
  const { gestion } = req.query;
  let sql = `SELECT c.*, g.anio AS gestion, (SELECT COUNT(*) FROM estudiantes e WHERE e.curso_id = c.id) AS total_estudiantes
             FROM cursos c JOIN gestiones g ON g.id = c.gestion_id`;
  const params = [];
  if (gestion) { sql += ' WHERE g.anio = ?'; params.push(Number(gestion)); }
  sql += ' ORDER BY c.nombre';
  res.json(db.prepare(sql).all(...params));
}));

router.post('/cursos', asyncHandler(async (req, res) => {
  const { nombre, gestion_id, nivel, capacidad_max } = req.body || {};
  requerirCampos({ nombre, gestion_id }, ['nombre', 'gestion_id']);
  if (!esEnteroPositivo(gestion_id)) throw badRequest('gestion_id inválido');
  const cap = capacidad_max !== undefined ? Number(capacidad_max) : 40;
  if (!Number.isInteger(cap) || cap < 1 || cap > 40) throw badRequest('La capacidad máxima debe estar entre 1 y 40');
  const gestion = db.prepare('SELECT * FROM gestiones WHERE id = ?').get(gestion_id);
  if (!gestion) throw noEncontrado('Gestión no encontrada');
  const existe = db.prepare('SELECT id FROM cursos WHERE gestion_id = ? AND nombre = ?').get(gestion_id, nombre);
  if (existe) throw conflicto('Ya existe un curso con ese nombre en esta gestión');
  const r = db.prepare('INSERT INTO cursos (gestion_id, nombre, nivel, capacidad_max) VALUES (?,?,?,?)')
    .run(gestion_id, nombre, nivel || 'Secundaria', cap);
  res.status(201).json({ id: Number(r.lastInsertRowid), nombre, gestion_id, capacidad_max: cap });
}));

router.put('/cursos/:id', asyncHandler(async (req, res) => {
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(req.params.id);
  if (!curso) throw noEncontrado('Curso no encontrado');
  const { nombre, nivel, capacidad_max } = req.body || {};
  const cap = capacidad_max !== undefined ? Number(capacidad_max) : curso.capacidad_max;
  if (!Number.isInteger(cap) || cap < 1 || cap > 40) throw badRequest('La capacidad máxima debe estar entre 1 y 40');
  if (nombre && nombre !== curso.nombre) {
    const existe = db.prepare('SELECT id FROM cursos WHERE gestion_id = ? AND nombre = ? AND id != ?').get(curso.gestion_id, nombre, curso.id);
    if (existe) throw conflicto('Ya existe un curso con ese nombre en esta gestión');
  }
  db.prepare('UPDATE cursos SET nombre=?, nivel=?, capacidad_max=? WHERE id=?')
    .run(nombre || curso.nombre, nivel || curso.nivel, cap, curso.id);
  res.json({ mensaje: 'Curso actualizado correctamente' });
}));

router.delete('/cursos/:id', asyncHandler(async (req, res) => {
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(req.params.id);
  if (!curso) throw noEncontrado('Curso no encontrado');
  db.prepare('DELETE FROM cursos WHERE id = ?').run(curso.id);
  res.json({ mensaje: 'Curso eliminado correctamente' });
}));

// ---------- MATERIAS ----------
router.get('/materias/catalogo', asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT nombre FROM materias ORDER BY nombre').all().map((materia) => materia.nombre));
}));

router.get('/materias', asyncHandler(async (req, res) => {
  res.json(db.prepare('SELECT * FROM materias ORDER BY nombre').all());
}));

router.post('/materias', asyncHandler(async (req, res) => {
  const { nombre, descripcion } = req.body || {};
  requerirCampos({ nombre }, ['nombre']);
  const nombreFinal = normalizarNombreMateria(nombre);
  const existe = db.prepare('SELECT id FROM materias WHERE nombre = ?').get(nombreFinal);
  if (existe) throw conflicto('Ya existe una materia con ese nombre');
  const r = db.prepare('INSERT INTO materias (nombre, descripcion) VALUES (?,?)').run(nombreFinal, descripcion || null);
  res.status(201).json({ id: Number(r.lastInsertRowid), nombre: nombreFinal });
}));

router.put('/materias/:id', asyncHandler(async (req, res) => {
  const materia = db.prepare('SELECT * FROM materias WHERE id = ?').get(req.params.id);
  if (!materia) throw noEncontrado('Materia no encontrada');
  const { nombre, descripcion } = req.body || {};
  const nombreFinal = nombre ? normalizarNombreMateria(nombre) : materia.nombre;
  if (nombreFinal !== materia.nombre) {
    const existe = db.prepare('SELECT id FROM materias WHERE nombre = ? AND id != ?').get(nombreFinal, materia.id);
    if (existe) throw conflicto('Ya existe una materia con ese nombre');
  }
  db.prepare('UPDATE materias SET nombre=?, descripcion=? WHERE id=?')
    .run(nombreFinal, descripcion !== undefined ? descripcion : materia.descripcion, materia.id);
  res.json({ mensaje: 'Materia actualizada correctamente' });
}));

router.delete('/materias/:id', asyncHandler(async (req, res) => {
  const materia = db.prepare('SELECT * FROM materias WHERE id = ?').get(req.params.id);
  if (!materia) throw noEncontrado('Materia no encontrada');
  db.prepare('DELETE FROM materias WHERE id = ?').run(materia.id);
  res.json({ mensaje: 'Materia eliminada correctamente' });
}));

module.exports = router;
