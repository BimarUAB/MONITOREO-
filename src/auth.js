const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET es obligatorio en producción'); })()
  : 'seguimiento-academico-secret-desarrollo');
const JWT_EXPIRES_IN = '8h';

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, username: usuario.username, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { JWT_SECRET, JWT_EXPIRES_IN, firmarToken, verificarToken };
