const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { firmarToken } = require('../auth');
const { ApiError, autenticar, requerirCampos, badRequest, noAutorizado, noEncontrado, asyncHandler, estudianteDeUsuario } = require('../middleware');

const router = express.Router();
const intentos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 10;

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  requerirCampos({ username, password }, ['username', 'password']);
  const nombre = String(username).trim();
  const claveIntento = `${req.ip}:${nombre.toLowerCase()}`;
  const ahora = Date.now();
  const registro = intentos.get(claveIntento);
  if (registro && ahora - registro.inicio < VENTANA_MS && registro.cantidad >= MAX_INTENTOS) {
    throw new ApiError(429, 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.');
  }
  if (registro && ahora - registro.inicio >= VENTANA_MS) intentos.delete(claveIntento);
  const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(nombre);
  if (!usuario || !usuario.activo) {
    const actual = intentos.get(claveIntento) || { inicio: ahora, cantidad: 0 };
    intentos.set(claveIntento, { inicio: actual.inicio, cantidad: actual.cantidad + 1 });
    throw noAutorizado('Usuario o contraseña incorrectos');
  }
  const ok = await bcrypt.compare(String(password), usuario.password_hash);
  if (!ok) {
    const actual = intentos.get(claveIntento) || { inicio: ahora, cantidad: 0 };
    intentos.set(claveIntento, { inicio: actual.inicio, cantidad: actual.cantidad + 1 });
    throw noAutorizado('Usuario o contraseña incorrectos');
  }
  intentos.delete(claveIntento);
  const token = firmarToken(usuario);
  res.json({
    token,
    user: {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
    },
  });
}));

router.get('/me', autenticar, asyncHandler(async (req, res) => {
  const u = req.usuario;
  const perfil = {
    id: u.id,
    username: u.username,
    rol: u.rol,
    nombres: u.nombres,
    apellidos: u.apellidos,
    email: u.email,
    telefono: u.telefono,
  };
  if (u.rol === 'tutor') {
    perfil.hijos = db.prepare(`
      SELECT e.id, e.rude, e.nombres, e.apellidos, e.fecha_nacimiento, c.nombre AS curso
      FROM tutor_estudiante te
      JOIN estudiantes e ON e.id = te.estudiante_id
      JOIN cursos c ON c.id = e.curso_id
      WHERE te.tutor_id = ?
    `).all(u.id);
  }
  if (u.rol === 'estudiante') {
    const est = estudianteDeUsuario(u.id);
    perfil.estudiante_id = est ? est.id : null;
  }
  res.json(perfil);
}));

module.exports = router;
