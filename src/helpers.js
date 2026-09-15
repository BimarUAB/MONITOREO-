// Cálculos académicos puros y testeables (sistema de evaluación CEI, Bolivia)

const ESCALA = [
  { min: 90, max: 100, label: 'Domina' },
  { min: 80, max: 89.99, label: 'Sobresaliente' },
  { min: 70, max: 79.99, label: 'Distinguido' },
  { min: 60, max: 69.99, label: 'Bueno' },
  { min: 50, max: 59.99, label: 'Suficiente' },
  { min: 0, max: 49.99, label: 'Insuficiente' },
];

// Observación: el brief escribe "Dominga" (90-100). Se usa el término oficial "Domina".
const MAX_NOTAS = { ser: 20, saber: 40, hacer: 30, decidir: 10 };
const UMBRAL_APROBACION = 51;
const BIMESTRES_POR_GESTION = 4;
const PUNTOS_APROBACION = UMBRAL_APROBACION * BIMESTRES_POR_GESTION; // 204

function redondear2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function cualitativo(promedio) {
  const p = Number(promedio);
  if (!Number.isFinite(p) || p < 0 || p > 100) return null;
  for (const r of ESCALA) {
    if (p >= r.min && p <= r.max) return r.label;
  }
  return null;
}

function promedioBimestre({ ser = 0, saber = 0, hacer = 0, decidir = 0 }) {
  return redondear2(ser + saber + hacer + decidir);
}

// Promedio anual sobre 100 = promedio de los bimestres registrados
function promedioAnual(bimestres) {
  const vals = bimestres.filter((b) => b !== null && b !== undefined).map(Number);
  if (vals.length === 0) return null;
  return redondear2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function semaforo(promedio) {
  if (promedio === null || promedio === undefined) return 'sin_datos';
  if (promedio >= 80) return 'verde';
  if (promedio >= 50) return 'amarillo';
  return 'rojo';
}

function aprobado(promedioAnual) {
  if (promedioAnual === null) return null;
  return promedioAnual >= UMBRAL_APROBACION;
}

// Puntos totales faltantes para llegar a 204, repartibles entre bimestres restantes
function puntosNecesarios(bimestres) {
  const registrados = bimestres.filter((b) => b !== null && b !== undefined).map(Number);
  const faltanBimestres = BIMESTRES_POR_GESTION - registrados.length;
  if (faltanBimestres === 0) {
    return promedioAnual(bimestres) >= UMBRAL_APROBACION ? 0 : 0;
  }
  const suma = registrados.reduce((a, b) => a + b, 0);
  return redondear2(Math.max(0, PUNTOS_APROBACION - suma));
}

function porcentajeBimestresRegistrados(bimestres) {
  const n = bimestres.filter((b) => b !== null && b !== undefined).length;
  return Math.round((n / BIMESTRES_POR_GESTION) * 100);
}

// Resumen de asistencia
function resumenAsistencia(asistencias) {
  const conteo = { presente: 0, ausente: 0, tarde: 0, licencia: 0 };
  for (const a of asistencias) {
    if (conteo[a.estado] !== undefined) conteo[a.estado]++;
  }
  const total = asistencias.length;
  const asistidos = conteo.presente + conteo.tarde + conteo.licencia;
  return {
    total,
    presente: conteo.presente,
    ausente: conteo.ausente,
    tarde: conteo.tarde,
    licencia: conteo.licencia,
    porcentaje_asistencia: total === 0 ? null : redondear2((asistidos / total) * 100),
  };
}

module.exports = {
  ESCALA,
  MAX_NOTAS,
  UMBRAL_APROBACION,
  BIMESTRES_POR_GESTION,
  PUNTOS_APROBACION,
  redondear2,
  cualitativo,
  promedioBimestre,
  promedioAnual,
  semaforo,
  aprobado,
  puntosNecesarios,
  porcentajeBimestresRegistrados,
  resumenAsistencia,
};
