const path = require('path');
const fs = require('fs');
const express = require('express');

const db = require('./src/db');
const { autenticar, requireRole, manejarErrores, asyncHandler } = require('./src/middleware');
const { realizarBackup } = require('./src/backup');

const app = express();
const PORT = process.env.PORT || 3000;

// Seguridad de headers (sin dependencias extra)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rutas públicas
app.use('/api/auth', require('./src/routes/auth'));

// Rutas protegidas
app.use('/api', autenticar, require('./src/routes/admin'));
app.use('/api', autenticar, require('./src/routes/estudiantes'));
app.use('/api', autenticar, require('./src/routes/asignaciones'));
app.use('/api', autenticar, require('./src/routes/consulta'));
app.use('/api', autenticar, require('./src/routes/docente'));
app.use('/api', autenticar, require('./src/routes/reportes'));

// Backup (solo admin)
app.get('/api/backup', autenticar, requireRole('admin'), asyncHandler(async (req, res) => {
  const archivo = realizarBackup();
  res.json({ archivo: `backups/${archivo}` });
}));

// SPA estática desde public/ (si existe)
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// 404 para rutas API desconocidas
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Middleware de errores consistente
app.use(manejarErrores);

app.listen(PORT, () => {
  console.log(`Servidor de Seguimiento Académico en http://localhost:${PORT}`);
});
