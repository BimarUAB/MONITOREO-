const db = require('./db');
const { verificarToken } = require('./auth');

// Errores con status HTTP consistente
class ApiError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const badRequest = (msg) => new ApiError(400, msg);
const noAutorizado = (msg = 'No autorizado') => new ApiError(401, msg);
const prohibido = (msg = 'Acceso prohibido') => new ApiError(403, msg);
const noEncontrado = (msg = 'Recurso no encontrado') => new ApiError(404, msg);
const conflicto = (msg) => new ApiError(409, msg);

// Autenticación JWT
function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(noAutorizado('Token de autenticación requerido'));
  try {
    const payload = verificarToken(token);
    const usuario = db.prepare('SELECT id, username, rol, nombres, apellidos, email, telefono, activo FROM usuarios WHERE id = ?').get(payload.id);
    if (!usuario || !usuario.activo) return next(noAutorizado('Usuario inactivo o inexistente'));
    req.usuario = usuario;
    next();
  } catch (e) {
    next(noAutorizado('Token inválido o expirado'));
  }
}

// Autorización por roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario) return next(noAutorizado());
    if (!roles.includes(req.usuario.rol)) return next(prohibido('No tiene permisos para esta acción'));
    next();
  };
}

function requerirCampos(obj, campos) {
  for (const c of campos) {
    if (obj[c] === undefined || obj[c] === null || obj[c] === '') {
      throw badRequest(`El campo '${c}' es obligatorio`);
    }
  }
}

function esEnteroPositivo(v) {
  return Number.isInteger(Number(v)) && Number(v) > 0;
}

// Envuelve handlers async para el middleware de errores
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Gestión activa actual
function gestionActiva() {
  return db.prepare('SELECT * FROM gestiones WHERE activa = 1').get();
}

// Buscar usuario del rol 'estudiante' vinculado a un estudiante
function estudianteDeUsuario(usuarioId) {
  return db.prepare('SELECT * FROM estudiantes WHERE usuario_id = ?').get(usuarioId);
}

// ¿Puede este usuario ver el expediente del estudiante?
function puedeVerExpediente(usuario, estudianteId) {
  if (usuario.rol === 'admin') return true;
  if (usuario.rol === 'docente') {
    const permiso = db.prepare(`
      SELECT a.id
      FROM estudiantes e
      JOIN cursos c ON c.id = e.curso_id
      JOIN asignaciones a ON a.curso_id = c.id AND a.gestion_id = c.gestion_id
      WHERE e.id = ? AND a.docente_id = ?
    `).get(estudianteId, usuario.id);
    return !!permiso;
  }
  if (usuario.rol === 'tutor') {
    const v = db.prepare('SELECT id FROM tutor_estudiante WHERE tutor_id = ? AND estudiante_id = ?').get(usuario.id, estudianteId);
    return !!v;
  }
  if (usuario.rol === 'estudiante') {
    const est = estudianteDeUsuario(usuario.id);
    return est && est.id === Number(estudianteId);
  }
  return false;
}

// Crea notificación para un usuario
function notificar(usuarioId, titulo, mensaje, tipo) {
  db.prepare('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?,?,?,?)')
    .run(usuarioId, titulo, mensaje, tipo || null);
}

// Notifica a todos los tutores vinculados a un estudiante
function notificarTutores(estudianteId, titulo, mensaje, tipo) {
  const tutores = db.prepare(`
    SELECT tutor_id FROM tutor_estudiante WHERE estudiante_id = ?
  `).all(estudianteId);
  for (const t of tutores) notificar(t.tutor_id, titulo, mensaje, tipo);
}

// Middleware de errores consistente
function manejarErrores(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const mensaje = err.status ? err.message : 'Error interno del servidor';
  if (!err.status) console.error(err);
  res.status(status).json({ error: mensaje });
}

module.exports = {
  ApiError,
  badRequest,
  noAutorizado,
  prohibido,
  noEncontrado,
  conflicto,
  autenticar,
  requireRole,
  requerirCampos,
  esEnteroPositivo,
  asyncHandler,
  gestionActiva,
  estudianteDeUsuario,
  puedeVerExpediente,
  notificar,
  notificarTutores,
  manejarErrores,
};
