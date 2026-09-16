const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const db = require('./src/db');

const XLSX_DIR = process.env.XLSX_DIR || 'C:\\Users\\BIMAR\\Desktop\\UAB 2.2026\\PRACTICA EMPRESARIAL\\SECUNDARIA';

function normalizar(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function seccionPorArchivo(filePath) {
  const nombre = normalizar(path.basename(filePath, path.extname(filePath)));
  const niveles = [
    ['PRIMERO', '1'], ['SEGUNDO', '2'], ['TERCERO', '3'],
    ['CUARTO', '4'], ['QUINTO', '5'], ['SEXTO', '6'],
  ];
  const nivel = niveles.find(([palabra]) => nombre.includes(palabra))?.[1];
  const grupo = ['A', 'B'].find((letra) => new RegExp(`\\b${letra}\\b`).test(nombre));
  if (!nivel || !grupo) throw new Error(`No se pudo identificar la sección en ${path.basename(filePath)}`);
  return `${nivel}${grupo}`;
}

function texto(value) {
  return String(value ?? '').trim();
}

const gestion = db.prepare('SELECT id, anio FROM gestiones WHERE activa = 1 LIMIT 1').get();
if (!gestion) throw new Error('No hay una gestión activa en la base de datos.');

const files = fs.readdirSync(XLSX_DIR)
  .filter((name) => path.extname(name).toLowerCase() === '.xlsx')
  .sort((a, b) => a.localeCompare(b, 'es'));
if (!files.length) throw new Error(`No se encontraron archivos XLSX en ${XLSX_DIR}`);

const courseIds = new Map();
for (let grade = 1; grade <= 6; grade++) {
  for (const group of ['A', 'B']) {
    const name = `${grade}° Secundaria ${group}`;
    db.prepare('INSERT OR IGNORE INTO cursos (gestion_id, nombre, nivel, capacidad_max) VALUES (?, ?, ?, 40)')
      .run(gestion.id, name, 'Secundaria');
    const course = db.prepare('SELECT id FROM cursos WHERE gestion_id = ? AND nombre = ?').get(gestion.id, name);
    courseIds.set(`${grade}${group}`, course.id);
  }
}

let created = 0;
let updated = 0;
let skipped = 0;
const summary = [];

for (const file of files) {
  const filePath = path.join(XLSX_DIR, file);
  const section = seccionPorArchivo(filePath);
  const courseId = courseIds.get(section);
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: true,
  });
  let courseCreated = 0;
  let courseUpdated = 0;

  for (let index = 4; index < rows.length; index++) {
    const row = rows[index] || [];
    const paternal = texto(row[1]);
    const maternal = texto(row[2]);
    const names = texto(row[3]);
    if (!paternal && !maternal && !names) continue;
    if (!names) {
      skipped++;
      continue;
    }
    const surnames = [paternal, maternal].filter(Boolean).join(' ');
    const keyNames = normalizar(names);
    const keySurnames = normalizar(surnames);
    const existing = db.prepare('SELECT id, nombres, apellidos FROM estudiantes WHERE curso_id = ?').all(courseId)
      .find((student) => normalizar(student.nombres) === keyNames && normalizar(student.apellidos) === keySurnames);

    if (existing) {
      if (existing.nombres !== names || existing.apellidos !== surnames) {
        db.prepare('UPDATE estudiantes SET nombres = ?, apellidos = ? WHERE id = ?')
          .run(names, surnames, existing.id);
      }
      updated++;
      courseUpdated++;
      continue;
    }

    const oldCourse = db.prepare('SELECT id FROM cursos WHERE gestion_id = ? AND nombre = ?')
      .get(gestion.id, `${section[0]}° Secundaria`);
    const legacy = oldCourse
      ? db.prepare('SELECT id, nombres, apellidos FROM estudiantes WHERE curso_id = ?').all(oldCourse.id)
        .find((student) => normalizar(student.nombres) === keyNames && normalizar(student.apellidos) === keySurnames)
      : null;
    if (legacy) {
      db.prepare('UPDATE estudiantes SET nombres = ?, apellidos = ?, curso_id = ? WHERE id = ?')
        .run(names, surnames, courseId, legacy.id);
      updated++;
      courseUpdated++;
      continue;
    }

    const number = Number(row[0]) || courseCreated + 1;
    let sequence = number;
    let rude = `${gestion.anio}-${section}-${String(sequence).padStart(3, '0')}`;
    while (db.prepare('SELECT 1 FROM estudiantes WHERE rude = ?').get(rude)) {
      sequence++;
      rude = `${gestion.anio}-${section}-${String(sequence).padStart(3, '0')}`;
    }
    db.prepare('INSERT INTO estudiantes (rude, nombres, apellidos, curso_id) VALUES (?, ?, ?, ?)')
      .run(rude, names, surnames, courseId);
    created++;
    courseCreated++;
  }
  summary.push({ section, created: courseCreated, updated: courseUpdated });
}

console.log(JSON.stringify({
  message: 'IMPORTACIÓN COMPLETADA',
  files: files.length,
  created,
  updated,
  skipped,
  summary,
}, null, 2));
