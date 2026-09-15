const fs = require('fs');
const path = require('path');
const db = require('./db');

function realizarBackup() {
  const DATA_DIR = path.join(__dirname, '..', 'data');
  const BACKUP_DIR = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const origen = path.join(DATA_DIR, 'app.db');
  if (!fs.existsSync(origen)) throw new Error('No existe la base de datos data/app.db');
  db.exec('PRAGMA wal_checkpoint(FULL)');
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const nombre = `backup-${ahora.getFullYear()}${pad(ahora.getMonth() + 1)}${pad(ahora.getDate())}-${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}.db`;
  const destino = path.join(BACKUP_DIR, nombre);
  fs.copyFileSync(origen, destino);
  return nombre;
}

module.exports = { realizarBackup };

if (require.main === module) {
  try {
    const archivo = realizarBackup();
    console.log(`Copia de seguridad creada: backups/${archivo}`);
  } catch (e) {
    console.error('Error al crear la copia de seguridad:', e.message);
    process.exit(1);
  }
}
