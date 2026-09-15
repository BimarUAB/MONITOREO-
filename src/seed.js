// Datos de demostración — Unidad Educativa "JESÚS MARÍA FE Y ALEGRÍA"
// Credenciales: admin/admin123, docente1/docente123, tutor1/tutor123, estudiante1/est123
const bcrypt = require('bcryptjs');
const db = require('./db');

const MATERIAS = ['Matemática', 'Física', 'Química', 'Biología', 'Lenguaje', 'Literatura', 'Inglés',
  'Historia', 'Geografía', 'Filosofía', 'Educación Física', 'Religión', 'Técnica', 'Artes Plásticas', 'Música'];

const NOMBRES_E = ['Juan', 'María', 'Pedro', 'Ana', 'Luis', 'Carmen', 'Diego', 'Lucía', 'Miguel', 'Sofía', 'Andrés', 'Valeria'];
const APELLIDOS_E = ['Quispe', 'Mamani', 'Condori', 'Apaza', 'Huanca', 'Paredes', 'Zurita', 'Vargas', 'Flores', 'Rojas', 'Calle', 'Torrez'];

function h(password) { return bcrypt.hashSync(password, 10); }

db.tx(() => {
  // Limpieza
  for (const t of ['notificaciones', 'comunicados', 'observaciones', 'asistencias', 'entregas', 'tareas',
    'materiales', 'notas', 'asignaciones', 'tutor_estudiante', 'estudiantes', 'cursos', 'materias',
    'gestiones', 'usuarios']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare("DELETE FROM sqlite_sequence").run(); // reinicia AUTOINCREMENT para re-semebras limpias

  // Gestión 2026 activa
  const gestionId = Number(db.prepare('INSERT INTO gestiones (anio, activa) VALUES (2026, 1)').run().lastInsertRowid);

  // Usuarios
  const insUsuario = db.prepare('INSERT INTO usuarios (username, password_hash, rol, nombres, apellidos, email, telefono) VALUES (?,?,?,?,?,?,?)');
  const adminId = Number(insUsuario.run('admin', h('admin123'), 'admin', 'Administrador', 'Del Sistema', 'admin@jmfa.edu.bo', '70000001').lastInsertRowid);

  const docentes = [];
  const nombresD = ['Rosa', 'Carlos', 'Elena', 'Jorge', 'Mirtha', 'Óscar', 'Patricia', 'Fernando'];
  const apellidosD = ['Gutiérrez', 'Salazar', 'Vega', 'Poma', 'Aliaga', 'Rivera', 'Cossío', 'Montaño'];
  for (let i = 0; i < 8; i++) {
    const id = Number(insUsuario.run(`docente${i + 1}`, h('docente123'), 'docente', nombresD[i], apellidosD[i],
      `docente${i + 1}@jmfa.edu.bo`, `7000001${i}`).lastInsertRowid);
    docentes.push(id);
  }
  const tutor1Id = Number(insUsuario.run('tutor1', h('tutor123'), 'tutor', 'Mario', 'Quispe', 'tutor1@mail.com', '71111111').lastInsertRowid);
  const tutor2Id = Number(insUsuario.run('tutor2', h('tutor123'), 'tutor', 'Teresa', 'Mamani', 'tutor2@mail.com', '72222222').lastInsertRowid);

  // Cursos 1° a 6° Secundaria
  const cursos = [];
  const insCurso = db.prepare("INSERT INTO cursos (gestion_id, nombre, nivel, capacidad_max) VALUES (?,?, 'Secundaria', 40)");
  for (let i = 1; i <= 6; i++) {
    cursos.push(Number(insCurso.run(gestionId, `${i}° Secundaria`).lastInsertRowid));
  }

  // Materias
  const insMateria = db.prepare('INSERT INTO materias (nombre, descripcion) VALUES (?,?)');
  const materias = {};
  for (const m of MATERIAS) {
    materias[m] = Number(insMateria.run(m, `Materia de ${m} - Nivel Secundaria`).lastInsertRowid);
  }

  // Estudiantes (12): 6 en 1° (curso[0]) y 6 en 4° (curso[3]); los 2 primeros con usuario propio
  const estudiantes = [];
  const insEst = db.prepare('INSERT INTO estudiantes (usuario_id, rude, nombres, apellidos, fecha_nacimiento, curso_id) VALUES (?,?,?,?,?,?)');
  const est1 = Number(insUsuario.run('estudiante1', h('est123'), 'estudiante', NOMBRES_E[0], APELLIDOS_E[0], 'estudiante1@mail.com', null).lastInsertRowid);
  const est2 = Number(insUsuario.run('estudiante2', h('est123'), 'estudiante', NOMBRES_E[1], APELLIDOS_E[1], 'estudiante2@mail.com', null).lastInsertRowid);
  for (let i = 0; i < 12; i++) {
    const cursoIdx = i < 6 ? 0 : 3;
    const gestionAnio = 2026;
    const rude = `${gestionAnio}-${cursoIdx === 0 ? '1' : '4'}S-${String(i + 1).padStart(3, '0')}`;
    const usuarioId = i === 0 ? est1 : (i === 1 ? est2 : null);
    estudiantes.push(Number(insEst.run(usuarioId, rude, NOMBRES_E[i], APELLIDOS_E[i], `201${3 - (i % 5)}-0${(i % 9) + 1}-1${i % 9}`, cursos[cursoIdx]).lastInsertRowid));
  }

  // Asignaciones: docente1 -> Matemática 1°, docente2 -> Lenguaje 1°, docente3 -> Matemática 4°, docente4 -> Historia 4°
  const insAsig = db.prepare('INSERT INTO asignaciones (docente_id, materia_id, curso_id, gestion_id) VALUES (?,?,?,?)');
  const asig1 = Number(insAsig.run(docentes[0], materias['Matemática'], cursos[0], gestionId).lastInsertRowid);
  const asig2 = Number(insAsig.run(docentes[1], materias['Lenguaje'], cursos[0], gestionId).lastInsertRowid);
  const asig3 = Number(insAsig.run(docentes[2], materias['Matemática'], cursos[3], gestionId).lastInsertRowid);
  const asig4 = Number(insAsig.run(docentes[3], materias['Historia'], cursos[3], gestionId).lastInsertRowid);
  insAsig.run(docentes[4], materias['Biología'], cursos[0], gestionId);
  insAsig.run(docentes[5], materias['Inglés'], cursos[3], gestionId);
  insAsig.run(docentes[6], materias['Educación Física'], cursos[0], gestionId);
  insAsig.run(docentes[7], materias['Física'], cursos[3], gestionId);

  // Notas bimestres 1 y 2 para todos (Matemática/Lenguaje 1° y Matemática/Historia 4°)
  const insNota = db.prepare('INSERT INTO notas (estudiante_id, materia_id, bimestre, ser, saber, hacer, decidir) VALUES (?,?,?,?,?,?,?)');
  const rand = (min, max) => Math.round((min + Math.random() * (max - min)) * 2) / 2;
  const plan = [
    { curso: 0, materia: materias['Matemática'] },
    { curso: 0, materia: materias['Lenguaje'] },
    { curso: 3, materia: materias['Matemática'] },
    { curso: 3, materia: materias['Historia'] },
  ];
  for (const p of plan) {
    for (const eid of estudiantes) {
      const cursoEst = db.prepare('SELECT curso_id FROM estudiantes WHERE id = ?').get(eid).curso_id;
      if (cursoEst !== cursos[p.curso]) continue;
      for (const bim of [1, 2]) {
        insNota.run(eid, p.materia, bim, rand(12, 19), rand(25, 38), rand(18, 28), rand(6, 10));
      }
    }
  }

  // Tareas con entregas pendientes
  const insTarea = db.prepare(`INSERT INTO tareas (asignacion_id, titulo, descripcion, tipo, fecha_entrega) VALUES (?,?,?,?,?)`);
  const insEntrega = db.prepare("INSERT INTO entregas (tarea_id, estudiante_id, estado) VALUES (?,?,'pendiente')");
  const t1 = Number(insTarea.run(asig1, 'Ejercicios de ecuaciones', 'Resolver los ejercicios 1 al 10 de la página 45', 'tarea', '2026-03-20').lastInsertRowid);
  const t2 = Number(insTarea.run(asig1, 'Práctico de geometría', 'Construcción de triángulos con regla y compás', 'trabajo_practico', '2026-03-27').lastInsertRowid);
  const t3 = Number(insTarea.run(asig3, 'Examen de funciones', 'Examen escrito de funciones lineales', 'examen', '2026-03-25').lastInsertRowid);
  const t4 = Number(insTarea.run(asig2, 'Lectura comprensiva', 'Leer el capítulo 3 y resumir', 'actividad', '2026-03-22').lastInsertRowid);
  for (const eid of estudiantes) {
    const cursoEst = db.prepare('SELECT curso_id FROM estudiantes WHERE id = ?').get(eid).curso_id;
    if (cursoEst === cursos[0]) { insEntrega.run(t1, eid); insEntrega.run(t2, eid); insEntrega.run(t4, eid); }
    if (cursoEst === cursos[3]) insEntrega.run(t3, eid);
  }

  // Asistencias: 2 semanas (lunes a viernes, 2026-03-02 .. 2026-03-13)
  const insAsis = db.prepare('INSERT INTO asistencias (estudiante_id, fecha, estado) VALUES (?,?,?)');
  const fechas = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06',
    '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'];
  for (const eid of estudiantes) {
    for (const f of fechas) {
      const r = Math.random();
      const estado = r < 0.85 ? 'presente' : (r < 0.92 ? 'tarde' : (r < 0.97 ? 'ausente' : 'licencia'));
      insAsis.run(eid, f, estado);
    }
  }

  // Observaciones
  const insObs = db.prepare('INSERT INTO observaciones (estudiante_id, asignacion_id, docente_id, tipo, descripcion, fecha) VALUES (?,?,?,?,?,?)');
  insObs.run(estudiantes[0], asig1, docentes[0], 'academica', 'Mejoró su participación en clase durante el segundo bimestre.', '2026-03-10 10:00:00');
  insObs.run(estudiantes[2], asig2, docentes[1], 'conductual', 'Llegó tarde 3 veces esta semana; se recomienda puntualidad.', '2026-03-11 09:30:00');
  insObs.run(estudiantes[8], asig3, docentes[2], 'academica', 'Necesita reforzar el tema de funciones cuadráticas.', '2026-03-12 11:00:00');

  // Comunicados
  const insCom = db.prepare('INSERT INTO comunicados (autor_id, titulo, mensaje, dirigido_a, curso_id, fecha) VALUES (?,?,?,?,?,?)');
  insCom.run(adminId, 'Bienvenida a la gestión 2026', 'Damos la bienvenida a todas las familias a la gestión escolar 2026.', 'todos', null, '2026-02-02 08:00:00');
  insCom.run(adminId, 'Reunión de padres 1° Secundaria', 'Reunión de padres de familia el viernes 20 de marzo a horas 15:00.', 'padres', cursos[0], '2026-03-13 12:00:00');
  insCom.run(adminId, 'Capacitación docente', 'Capacitación en evaluación por competencias el sábado 21 de marzo.', 'docentes', null, '2026-03-13 13:00:00');

  // Vínculos tutor-hijo
  const insVin = db.prepare('INSERT INTO tutor_estudiante (tutor_id, estudiante_id) VALUES (?,?)');
  insVin.run(tutor1Id, estudiantes[0]); // tutor1 -> 2 hijos en 1°
  insVin.run(tutor1Id, estudiantes[1]);
  insVin.run(tutor2Id, estudiantes[6]); // tutor2 -> 1 hijo en 4°

  // Notificaciones de ejemplo
  const insNotif = db.prepare('INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo) VALUES (?,?,?,?)');
  insNotif.run(tutor1Id, 'Nuevas notas de Matemática — Bimestre 2', 'Juan Quispe tiene nuevas notas registradas en Matemática (Bimestre 2).', 'notas');
  insNotif.run(tutor1Id, 'Comunicado: Reunión de padres 1° Secundaria', 'Reunión de padres de familia el viernes 20 de marzo a horas 15:00.', 'comunicado');
  insNotif.run(est1, 'Nueva tarea de Matemática', 'Se publicó "Ejercicios de ecuaciones" (tarea).', 'tarea');
});

console.log('Base de datos poblada con datos de demostración.');
console.log('Credenciales: admin/admin123 | docente1/docente123 | tutor1/tutor123 | estudiante1/est123');
