const API = '/api';
const state = {
  token: localStorage.getItem('jmfa_token'),
  user: null,
  view: 'inicio',
  data: {},
};

const $ = (selector) => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const fecha = (value) => value ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium' }).format(new Date(`${String(value).replace(' ', 'T')}${String(value).length === 10 ? 'T12:00:00' : ''}`)) : 'Sin fecha';
const rolLabel = { admin: 'Administración', docente: 'Docente', tutor: 'Familia', estudiante: 'Estudiante', asistencia: 'Control de asistencia' };
const tipoLabel = { tarea: 'Tarea', actividad: 'Actividad', trabajo_practico: 'Trabajo práctico', examen: 'Examen' };
// Componentes de evaluación (resolución CEI): Ser /10, Saber /45, Hacer /40, Autoevaluación /5.
const COMPONENTES = [['ser', 'Ser', 10], ['saber', 'Saber', 45], ['hacer', 'Hacer', 40], ['decidir', 'Autoevaluación', 5]];

function mostrarError(error) {
  const mensaje = error?.message || 'No se pudo completar la operación';
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast toast-error">${esc(mensaje)}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 4200);
}
function showToast(message, kind = 'info') {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast ${kind}">${esc(message)}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 3200);
}
function clearSession() {
  localStorage.removeItem('jmfa_token');
  state.token = null;
  state.user = null;
  state.view = 'inicio';
  state.data = {};
  $('#notif-panel').hidden = true;
}

async function api(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && state.token) {
    clearSession();
    renderLogin();
  }
  if (!response.ok) throw new Error(body.error || 'Error de comunicación con el servidor');
  return body;
}

function cualitativoClass(value) {
  if (value === null || value === undefined) return 'chip-neutro';
  if (value >= 90) return 'chip-domina';
  if (value >= 80) return 'chip-sobresaliente';
  if (value >= 70) return 'chip-distinguido';
  if (value >= 60) return 'chip-bueno';
  if (value >= 50) return 'chip-suficiente';
  return 'chip-insuficiente';
}
function semaforo(value) {
  return value === null || value === undefined ? 'gris' : value >= 70 ? 'verde' : value >= 50 ? 'amarillo' : 'rojo';
}
function chip(value, label) { return `<span class="chip ${cualitativoClass(value)}">${esc(label || (value == null ? 'Pendiente' : String(value)))}</span>`; }
function loading(text = 'Cargando información...') { return `<div class="loading"><span class="spinner"></span>${esc(text)}</div>`; }
function empty(text) { return `<div class="empty"><strong>${esc(text)}</strong><span>La información aparecerá aquí cuando esté disponible.</span></div>`; }
function icon(name) {
  const icons = { home: '⌂', grades: '▣', tasks: '✓', users: '♙', report: '▥', settings: '⚙', calendar: '▦', notice: '!', back: '‹' };
  return icons[name] || '•';
}

function renderLogin() {
  document.body.className = 'logged-out';
  $('#app-header').hidden = true;
  $('#tabbar').hidden = true;
  $('#view').innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <div class="login-escudo" aria-hidden="true"><img src="img/logo.png" alt="Escudo UE Jesús María Fe y Alegría" /></div>
        <h1 class="login-titulo">Unidad Educativa<br>“JESÚS MARÍA FE Y ALEGRÍA”</h1>
        <p class="login-sub">El Alto, La Paz · Bolivia</p>
        <div class="login-bienvenida">Consulta el avance escolar de forma segura, desde donde estés.</div>
        <form id="login-form">
          <div class="campo"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" placeholder="Ingresa tu usuario" required></div>
          <div class="campo"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Ingresa tu contraseña" required></div>
          <button class="btn btn-primary btn-block" type="submit">Ingresar a mi cuenta</button>
        </form>
        <div class="login-demo"><strong>Accesos de demostración</strong><br>Familia: <code>tutor1 / tutor123</code><br>Docente: <code>docente1 / docente123</code><br>Dirección: <code>admin / admin123</code></div>
      </div>
    </section>`;
  $('#login-form').addEventListener('submit', login);
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    state.token = result.token;
    state.user = result.user;
    localStorage.setItem('jmfa_token', state.token);
    await iniciarApp();
  } catch (error) { mostrarError(error); } finally { button.disabled = false; }
}

function header() {
  $('#app-header').hidden = false;
  $('#user-chip').textContent = `${state.user.nombres} · ${rolLabel[state.user.rol]}`;
  $('#btn-logout').onclick = () => { clearSession(); renderLogin(); };
  $('#brand-link').onclick = (event) => { event.preventDefault(); navigate('inicio'); };
  $('#btn-notif').onclick = toggleNotifications;
}

async function toggleNotifications() {
  const panel = $('#notif-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  try {
    const result = await api('/notificaciones');
    panel.innerHTML = `<div class="notif-head"><h3>Notificaciones</h3><div class="action-row"><button class="btn btn-sm btn-gris" id="read-notifs">Marcar leídas</button><button class="btn btn-sm btn-outline" id="read-all-notifs">Todas</button></div></div>${result.notificaciones.length ? result.notificaciones.map((n) => `<button class="notif-item ${n.leida ? '' : 'no-leida'}" data-notif="${n.id}"><strong>${esc(n.titulo)}</strong><span>${esc(n.mensaje)}</span><small class="notif-fecha">${fecha(n.created_at)}</small></button>`).join('') : empty('No tienes notificaciones nuevas')}`;
    panel.hidden = false;
    $('#notif-badge').hidden = !result.no_leidas;
    $('#notif-badge').textContent = result.no_leidas;
    $('#read-notifs')?.addEventListener('click', async () => { const ids = result.notificaciones.filter((n) => !n.leida).map((n) => n.id); if (!ids.length) return; await api('/notificaciones/leer', { method: 'PUT', body: JSON.stringify({ ids }) }); panel.hidden = true; toggleNotifications(); });
    $('#read-all-notifs')?.addEventListener('click', async () => { await api('/notificaciones/leer-todas', { method: 'PUT' }); $('#notif-badge').hidden = true; panel.hidden = true; toggleNotifications(); });
    panel.querySelectorAll('[data-notif]').forEach((item) => item.addEventListener('click', async () => { await api(`/notificaciones/${item.dataset.notif}/leer`, { method: 'PUT' }); item.classList.remove('no-leida'); }));
  } catch (error) { mostrarError(error); }
}

function tabs() {
  const items = state.user.rol === 'tutor' || state.user.rol === 'estudiante'
    ? [['inicio', 'home', 'Resumen'], ['notas', 'grades', 'Notas'], ['tareas', 'tasks', 'Tareas'], ['asistencia', 'calendar', 'Asistencia'], ['comunicados', 'notice', 'Avisos']]
    : state.user.rol === 'docente'
      ? [['inicio', 'home', 'Inicio'], ['clases', 'grades', 'Mis clases'], ['tareas', 'tasks', 'Tareas'], ['asistencia', 'calendar', 'Asistencia'], ['comunicados', 'notice', 'Avisos']]
      : state.user.rol === 'asistencia'
        ? [['asistencia', 'calendar', 'Asistencia']]
      : [['inicio', 'home', 'Inicio'], ['usuarios', 'users', 'Usuarios'], ['estudiantes', 'users', 'Estudiantes'], ['familias', 'users', 'Familias'], ['academico', 'grades', 'Académico'], ['cursos', 'calendar', 'Cursos'], ['reportes', 'report', 'Reportes'], ['notificaciones', 'notice', 'Notificaciones']];
  $('#tabbar').hidden = false;
  $('#tabbar').innerHTML = items.map(([id, ico, label]) => `<button class="tab ${state.view === id ? 'active' : ''}" data-view="${id}"><span>${icon(ico)}</span><small>${label}</small></button>`).join('');
  $('#tabbar').querySelectorAll('[data-view]').forEach((button) => button.onclick = () => navigate(button.dataset.view));
}

async function navigate(view) { state.view = view; tabs(); $('#view').innerHTML = loading(); try { $('#view').innerHTML = await renderView(view); bindActions(); } catch (error) { $('#view').innerHTML = `<div class="card"><h2>No se pudo cargar esta vista</h2><p>${esc(error.message)}</p></div>`; mostrarError(error); } }

async function renderView(view) {
  if (state.user.rol === 'tutor' || state.user.rol === 'estudiante') return renderFamily(view);
  if (state.user.rol === 'docente') return renderTeacher(view);
  if (state.user.rol === 'asistencia') return renderAttendanceRole();
  return renderAdmin(view);
}

async function renderFamily(view) {
  if (state.user.rol === 'tutor' && !state.data.hijos) state.data.hijos = await api('/hijos');
  if (state.user.rol === 'estudiante' && !state.user.estudiante_id) return `<div class="page-title"><span class="eyebrow">Mi seguimiento</span><h1>Cuenta pendiente de vinculación</h1><p>La dirección aún no ha asociado esta cuenta con un estudiante.</p></div>`;
  if (state.user.rol === 'estudiante' && !state.data.hijo) state.data.hijo = await api(`/expediente/${state.user.estudiante_id}`);
  const hijos = state.user.rol === 'tutor' ? state.data.hijos : [{ id: state.user.estudiante_id, nombres: state.data.hijo.estudiante.nombres, apellidos: state.data.hijo.estudiante.apellidos, curso: state.data.hijo.curso.nombre }];
  if (!hijos.length) return `<div class="page-title"><span class="eyebrow">Familias</span><h1>Aún no hay estudiantes vinculados</h1><p>Solicita a la dirección que vincule a tus hijos con esta cuenta.</p></div>`;
  const selected = state.data.selectedChild || hijos[0].id;
  state.data.selectedChild = selected;
  if (!state.data.expedientes) state.data.expedientes = {};
  if (!state.data.expedientes[selected]) state.data.expedientes[selected] = await api(`/expediente/${selected}`);
  const expediente = state.data.expedientes[selected];
  const selector = hijos.length > 1 ? `<select id="child-select" class="child-select">${hijos.map((h) => `<option value="${h.id}" ${h.id === selected ? 'selected' : ''}>${esc(h.nombres)} ${esc(h.apellidos)} · ${esc(h.curso)}</option>`).join('')}</select>` : `<span class="tag">${esc(expediente.curso.nombre)}</span>`;
  const content = view === 'notas' ? familyGrades(expediente) : view === 'tareas' ? familyTasks(expediente) : view === 'asistencia' ? await familyAttendance(expediente) : view === 'comunicados' ? await familyNotices() : familyHome(expediente);
  return `<div class="page-title"><div><span class="eyebrow">${state.user.rol === 'tutor' ? 'Panel familiar' : 'Mi seguimiento'}</span><h1>Hola, ${esc(state.user.nombres)}</h1><p>Gestión ${expediente.gestion} · ${selector}</p></div></div>${content}`;
}

function familyHome(data) {
  const averages = data.materias.map((m) => m.promedio_anual).filter((n) => n !== null);
  const average = averages.length ? Math.round(averages.reduce((a, b) => a + b, 0) / averages.length) : null;
  const pending = data.tareas.filter((t) => t.estado === 'pendiente').length;
  return `<div class="student-hero"><div class="avatar">${esc(data.estudiante.nombres[0])}</div><div><h2>${esc(data.estudiante.nombres)} ${esc(data.estudiante.apellidos)}</h2><p>RUDE ${esc(data.estudiante.rude)} · ${esc(data.curso.nombre)}</p></div><div class="hero-score"><strong>${average ?? '—'}</strong><span>promedio anual</span></div></div>
    <div class="stats-grid"><div class="stat"><span class="stat-icon blue">${icon('grades')}</span><strong>${data.materias.length}</strong><small>materias</small></div><div class="stat"><span class="stat-icon yellow">${icon('tasks')}</span><strong>${pending}</strong><small>tareas pendientes</small></div><div class="stat"><span class="stat-icon green">${data.asistencia.porcentaje_asistencia ?? 0}%</span><strong>${data.asistencia.presente}</strong><small>asistencias</small></div></div>
    <section class="card"><div class="section-heading"><h2>Avance trimestral</h2><button class="text-button" data-action="notas">Ver notas</button></div>${[1, 2, 3].map((trimestre) => { const values = data.materias.map((m) => m.trimestres[trimestre - 1]?.promedio).filter((n) => n !== null && n !== undefined); const avg = values.length ? Math.round(values.reduce((a, n) => a + n, 0) / values.length) : null; return `<div class="progreso"><div class="progreso-info"><span>Trimestre ${trimestre}</span><span>${avg === null ? 'Pendiente' : `${avg}/100`}</span></div><div class="progreso-pista"><div class="progreso-relleno ${semaforo(avg)}" style="width:${avg || 0}%"></div></div></div>`; }).join('')}</section>
    <section class="card"><div class="section-heading"><h2>Actividad reciente</h2><button class="text-button" data-action="tareas">Ver tareas</button></div>${data.tareas.slice(0, 3).map(taskRow).join('') || empty('No hay tareas registradas')}</section>
    ${data.observaciones.length ? `<section class="card"><h2 class="card-titulo">Últimas observaciones</h2>${data.observaciones.slice(0, 2).map((o) => `<div class="notice-line"><span class="puntito ${o.tipo === 'conductual' ? 'amarillo' : 'verde'}"></span><div><strong>${esc(o.materia || 'Seguimiento general')}</strong><p>${esc(o.descripcion)}</p><small>${fecha(o.fecha)}</small></div></div>`).join('')}</section>` : ''}`;
}

function familyGrades(data) { const trimestres = (m) => m.trimestres; return `<section class="card"><div class="section-heading"><div><h2>Notas por materia</h2><p class="muted">Aprobación mínima: 51 puntos de promedio anual</p></div><span class="tag">${data.materias.length} materias</span></div>${data.materias.map((m) => { const puntosNecesarios = Math.ceil(m.puntos_necesarios || 0); const puntosFaltantes = Math.ceil(m.puntos_faltantes_aprobacion || 0); const estado = m.aprobado === null ? 'Pendiente de notas' : m.aprobado ? 'Aprobado' : m.porcentaje_registrado < 100 ? `Faltan ${puntosNecesarios} puntos acumulados para llegar a 51` : `Promedio final: faltan ${puntosFaltantes} puntos para 51`; return `<article class="grade-card"><div class="grade-head"><div><h3>${esc(m.materia)}</h3><small>${esc(m.docente)}</small></div><div class="grade-total"><strong>${m.promedio_anual ?? '—'}</strong><span>${m.cualitativo_anual || 'En proceso'}</span></div></div><div class="trimestre-grid">${trimestres(m).map((trimestre) => `<div class="trimestre"><strong>T${trimestre.trimestre}</strong><span>${trimestre.promedio ?? '—'}</span>${trimestre.promedio !== null ? chip(trimestre.promedio, trimestre.cualitativo) : '<em>Sin registro</em>'}</div>`).join('')}</div><div class="grade-foot"><span class="semaforo ${m.semaforo}">${estado}</span><span>${m.porcentaje_registrado}% registrado</span></div></article>`; }).join('')}</section>`; }
function taskRow(task) { return `<div class="task-row"><span class="task-check ${task.estado === 'completada' ? 'done' : ''}">${task.estado === 'completada' ? '✓' : ''}</span><div><strong>${esc(task.titulo)}</strong><small>${esc(task.materia)} · ${tipoLabel[task.tipo] || task.tipo}</small></div><time>${task.fecha_entrega ? fecha(task.fecha_entrega) : 'Sin fecha'}</time></div>`; }
function familyTasks(data) { return `<section class="card"><div class="section-heading"><div><h2>Tareas y actividades</h2><p class="muted">Entrega archivos y consulta la revisión docente de ${esc(data.estudiante.nombres)}</p></div></div>${data.tareas.map((task) => `<div class="task-row interactive"><button class="task-check ${task.estado === 'completada' ? 'done' : ''}" data-action="mark-task" data-task="${task.tarea_id}" data-student="${data.estudiante.id}" data-state="${task.estado}">${task.estado === 'completada' ? '✓' : ''}</button><div><strong>${esc(task.titulo)}</strong><small>${esc(task.materia)} · ${esc(task.descripcion || '')}</small>${task.revision_comentario ? `<p class="task-feedback">Comentario docente: ${esc(task.revision_comentario)}</p>` : ''}<label class="evidence-upload"><span>${task.tiene_archivo ? 'Reemplazar evidencia' : 'Adjuntar evidencia'}</span><input type="file" data-upload-evidence="${task.entrega_id}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"></label></div><div class="task-meta"><span class="chip ${task.estado === 'completada' ? 'chip-sobresaliente' : 'chip-bueno'}">${task.estado === 'completada' ? (task.es_tardia ? 'Entregada tarde' : 'Entregada') : 'Pendiente'}</span>${task.estado === 'completada' ? `<span class="review-status ${task.revisada ? 'reviewed' : ''}">${task.revisada ? '✓ Revisada' : 'Pendiente de revisión'}</span>` : ''}<time>${task.fecha_entrega ? fecha(task.fecha_entrega) : 'Sin fecha'}</time></div></div>`).join('') || empty('No hay tareas asignadas')}</section>`; }
async function familyNotices() { const notices = await api('/comunicados'); return `<section class="card"><h2 class="card-titulo">Comunicados de la unidad educativa</h2>${notices.map((n) => `<article class="notice-card"><div class="notice-date">${fecha(n.fecha)}</div><h3>${esc(n.titulo)}</h3><p>${esc(n.mensaje)}</p><small>${esc(n.autor)}${n.curso ? ` · ${esc(n.curso)}` : ''}</small></article>`).join('') || empty('No hay comunicados')}</section>`; }
async function renderAttendanceRole() {
  const hoy = new Date().toISOString().slice(0, 10);
  return `<div class="page-title"><span class="eyebrow">Control institucional</span><h1>Asistencia de estudiantes</h1><p>Busca estudiantes por nombre para registrar atrasos o permisos.</p></div><section class="card"><div class="section-heading"><h2>Registro de novedades</h2><span class="tag">Búsqueda individual</span></div><div class="form-grid attendance-search-form"><div class="campo"><label for="attendance-search">Buscar por nombre o RUDE</label><div class="attendance-search-control"><input id="attendance-search" type="search" placeholder="Escribe al menos 2 caracteres"><button class="btn btn-primary btn-sm" id="attendance-search-btn" type="button">Buscar</button></div></div><div class="campo"><label for="attendance-date">Fecha</label><input id="attendance-date" type="date" value="${hoy}"></div></div><div id="attendance-list"><p class="attendance-search-help">Escribe un apellido, nombre o RUDE para buscar.</p></div><div class="action-row" style="margin-top:10px"><button class="btn btn-primary" id="attendance-save">Guardar novedades</button><span class="muted" id="attendance-hint"></span></div></section>`;
}

async function initAttendanceRole() {
  const cargarNovedades = async () => {
    const fechaSel = $('#attendance-date')?.value;
    if (!fechaSel) return;
    try {
      const attendance = await api('/asistencias/curso-global?fecha=' + fechaSel).catch(() => []);
      const previous = {}; attendance.forEach((item) => { previous[item.estudiante_id] = item; });
      $('#attendance-hint').textContent = attendance.length ? `Ya existe registro del ${fechaSel}: se actualizará.` : '';
      state.data.attendancePrevious = previous;
      renderAttendanceStudents(previous);
    } catch (error) { $('#attendance-list').innerHTML = `<div class="card"><p>${esc(error.message)}</p></div>`; }
  };
  let timer;
  const buscar = async () => {
    const query = $('#attendance-search').value.trim();
    if (query.length < 2) { state.data.attendanceStudents = []; $('#attendance-list').innerHTML = '<p class="attendance-search-help">Escribe al menos 2 caracteres para buscar.</p>'; return; }
    $('#attendance-list').innerHTML = loading('Buscando estudiante...');
    try { state.data.attendanceStudents = (await api(`/asistencia/estudiantes?q=${encodeURIComponent(query)}`)).estudiantes; renderAttendanceStudents(state.data.attendancePrevious || {}); } catch (error) { $('#attendance-list').innerHTML = `<div class="card"><p>${esc(error.message)}</p></div>`; }
  };
  $('#attendance-search')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 250); });
  $('#attendance-search-btn')?.addEventListener('click', buscar);
  $('#attendance-date')?.addEventListener('change', cargarNovedades);
  $('#attendance-save')?.addEventListener('click', async () => {
    const fechaSel = $('#attendance-date').value;
    const registros = (state.data.attendanceStudents || []).map((student) => { const estado = $(`input[name="attendance-${student.id}"]:checked`)?.value; const motivo = $(`[data-attendance-reason="${student.id}"]`)?.value || ''; return estado ? { estudiante_id: student.id, estado, motivo } : null; }).filter(Boolean);
    if (!registros.length) { mostrarError(new Error('Selecciona al menos un atraso o permiso')); return; }
    if (registros.some((registro) => registro.estado === 'licencia' && !registro.motivo.trim())) { mostrarError(new Error('Todo permiso debe tener una justificación')); return; }
    try {
      const result = await api('/asistencias', { method: 'POST', body: JSON.stringify({ fecha: fechaSel, registros }) });
      for (const registro of registros.filter((item) => item.estado === 'licencia')) {
        const archivo = $(`[data-attendance-file="${registro.estudiante_id}"]`)?.files?.[0];
        if (!archivo) continue;
        const form = new FormData();
        form.append('estudiante_id', registro.estudiante_id);
        form.append('fecha', fechaSel);
        form.append('motivo', registro.motivo);
        form.append('archivo', archivo);
        await api('/asistencias/justificacion', { method: 'POST', body: form });
      }
      $('#attendance-hint').textContent = ''; showToast(`Novedades guardadas: ${result.guardados}`, 'ok'); await cargarNovedades();
    } catch (error) { mostrarError(error); }
  });
  await cargarNovedades();
}

function renderAttendanceStudents(previous) {
  state.data.attendancePrevious = previous;
  const query = ($('#attendance-search')?.value || '').trim().toLowerCase();
  const students = (state.data.attendanceStudents || []).filter((student) => `${student.apellidos} ${student.nombres} ${student.rude}`.toLowerCase().includes(query));
  const statuses = [['tarde', 'Atraso'], ['licencia', 'Permiso']];
  $('#attendance-list').innerHTML = students.map((student) => { const saved = previous[student.id]; return `<div class="att-row"><div><strong>${esc(student.apellidos)}, ${esc(student.nombres)}</strong><small>${esc(student.curso)} · ${esc(student.rude)}</small></div><div class="att-options">${statuses.map(([value, label]) => `<label class="att-opt"><input type="radio" name="attendance-${student.id}" value="${value}" ${saved?.estado === value ? 'checked' : ''}>${label}</label>`).join('')}<input class="attendance-reason" data-attendance-reason="${student.id}" placeholder="Justificación del permiso" value="${esc(saved?.motivo || '')}" ${saved?.estado === 'licencia' ? '' : 'hidden'}><label class="attendance-file" data-attendance-file-label="${student.id}" ${saved?.estado === 'licencia' ? '' : 'hidden'}>Adjuntar respaldo<input type="file" data-attendance-file="${student.id}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"></label></div></div>`; }).join('') || empty('No se encontraron estudiantes');
  $('#attendance-list').querySelectorAll('input[type="radio"]').forEach((radio) => radio.addEventListener('change', () => { const id = radio.name.replace('attendance-', ''); const reason = $(`[data-attendance-reason="${id}"]`); const file = $(`[data-attendance-file-label="${id}"]`); if (reason) reason.hidden = radio.value !== 'licencia'; if (file) file.hidden = radio.value !== 'licencia'; }));
}

async function familyAttendance(data) { const result = await api(`/expediente/${data.estudiante.id}/asistencias`); return `<section class="card"><div class="section-heading"><div><h2>Asistencia</h2><p class="muted">Registro completo de ${esc(data.estudiante.nombres)}</p></div><span class="tag">${data.asistencia.porcentaje_asistencia ?? 0}% asistencia</span></div><div class="asistencia-resumen"><div class="asis-caja verde"><strong>${data.asistencia.presente}</strong><span>Presentes</span></div><div class="asis-caja amarillo"><strong>${data.asistencia.tarde}</strong><span>Tardanzas</span></div><div class="asis-caja rojo"><strong>${data.asistencia.ausente}</strong><span>Ausencias</span></div><div class="asis-caja azul"><strong>${data.asistencia.licencia}</strong><span>Licencias</span></div></div>${result.asistencias.map((a) => `<div class="asist-fila"><span class="asist-fecha">${fecha(a.fecha)}</span><span class="semaforo ${a.estado === 'presente' || a.estado === 'licencia' ? 'verde' : a.estado === 'tarde' ? 'amarillo' : 'rojo'}">${a.estado}</span></div>`).join('') || empty('No hay registros de asistencia')}</section>`; }

async function renderTeacher(view) {
  if (!state.data.asignaciones) state.data.asignaciones = await api('/docente/asignaciones');
  const asignaciones = state.data.asignaciones;
  if (view === 'tareas') return teacherTasks(asignaciones);
  if (view === 'comunicados') return familyNotices();
  if (view === 'asistencia') return teacherAttendance(asignaciones);
  if (view === 'clases') return teacherClasses(asignaciones);
  const total = asignaciones.reduce((sum, a) => sum + a.total_estudiantes, 0);
  const resumen = asignaciones.map((item) => `<article class="teacher-dashboard-card"><div class="section-heading"><div><h3>${esc(item.curso)}</h3><small>${esc(item.materia)} · ${item.total_estudiantes} estudiantes</small></div><button class="btn btn-primary btn-sm" data-assignment="${item.id}">Abrir curso</button></div><div class="task-status-grid"><div><strong>${item.tareas_revisadas || 0}</strong><small>Tareas revisadas</small></div><div><strong>${item.tareas_pendientes || 0}</strong><small>Tareas pendientes</small></div></div></article>`).join('');
  return `<div class="page-title"><span class="eyebrow">Panel docente</span><h1>Buen día, ${esc(state.user.nombres)}</h1><p>Resumen de tus cursos y seguimiento de tareas.</p></div><div class="stats-grid"><div class="stat"><span class="stat-icon blue">${icon('grades')}</span><strong>${asignaciones.length}</strong><small>asignaciones</small></div><div class="stat"><span class="stat-icon green">${icon('users')}</span><strong>${total}</strong><small>estudiantes</small></div><div class="stat"><span class="stat-icon yellow">3</span><strong>3</strong><small>trimestres</small></div></div><section class="teacher-dashboard"><div class="section-heading"><h2>Mis cursos asignados</h2><button class="btn btn-primary btn-sm" data-action="clases">Ver tabla completa</button></div>${resumen || empty('No tienes cursos asignados')}</section>`;
}
function assignmentCard(a) { return `<button class="assignment" data-assignment="${a.id}"><span class="subject-mark">${esc(a.materia[0])}</span><span><strong>${esc(a.materia)}</strong><small>${esc(a.curso)} · ${a.total_estudiantes} estudiantes</small></span><span class="arrow">›</span></button>`; }
function teacherClasses(asignaciones) { return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Mis clases</h1><p>Haz clic en un curso para abrir directamente su lista y registrar notas.</p></div><section class="card"><div class="section-heading"><h2>Cursos asignados</h2><span class="tag">${asignaciones.length} clases</span></div><div class="teacher-class-table"><div class="teacher-class-head"><span>Curso</span><span>Materia</span><span>Estudiantes</span><span>Tareas revisadas</span><span>Tareas pendientes</span><span>Acción</span></div>${asignaciones.map((a) => `<button class="teacher-class-row" data-assignment="${a.id}"><strong>${esc(a.curso)}</strong><span>${esc(a.materia)}</span><span>${a.total_estudiantes}</span><span class="task-count reviewed">${a.tareas_revisadas || 0}</span><span class="task-count pending">${a.tareas_pendientes || 0}</span><span class="teacher-class-open">Abrir lista <span class="arrow">›</span></span></button>`).join('') || empty('No hay cursos disponibles para este docente')}</div></section><div id="class-detail"></div>`; }
async function teacherTasks(asignaciones) {
  const tasks = await api('/tareas');
  state.data.tareas = tasks;
  return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Tareas publicadas</h1><p>Crea, actualiza, revisa entregas o retira actividades de tus cursos.</p></div><section class="card"><div class="section-heading"><h2>${tasks.length} actividades</h2><button class="btn btn-primary btn-sm" data-action="new-task">Nueva tarea</button></div>${tasks.map((t) => `<article class="managed-task"><div class="task-row"><span class="subject-mark small">${esc(t.materia[0])}</span><div><strong>${esc(t.titulo)}</strong><small>${esc(t.materia)} · ${esc(t.curso)} · ${tipoLabel[t.tipo] || t.tipo} · ${t.entregas.completada} entregadas / ${t.entregas.pendiente} pendientes</small></div><time>${t.fecha_entrega ? fecha(t.fecha_entrega) : 'Sin fecha'}</time></div><div class="managed-task-actions"><button class="btn btn-verde btn-sm" data-review-task="${t.id}">Revisar entregas</button><button class="btn btn-outline btn-sm" data-edit-task="${t.id}">Editar</button><button class="btn btn-rojo btn-sm" data-delete-task="${t.id}">Eliminar</button></div></article>`).join('') || empty('Aún no publicaste tareas')}</section>`;
}

function teacherAttendance(asignaciones) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (!asignaciones.length) return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Asistencia diaria</h1></div>${empty('No tienes asignaciones activas')}`;
  return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Asistencia diaria</h1><p>Registra o corrige la asistencia de tus cursos; los datos se guardan por fecha.</p></div>
  <section class="card"><div class="section-heading"><h2>Tomar asistencia</h2></div>
    <div class="form-grid"><div class="campo"><label>Clase</label><select id="att-class">${asignaciones.map((a) => `<option value="${a.id}">${esc(a.materia)} · ${esc(a.curso)}</option>`).join('')}</select></div>
    <div class="campo"><label>Fecha</label><input id="att-date" type="date" value="${hoy}"></div></div>
    <div id="att-list">${loading('Cargando estudiantes...')}</div>
    <div class="action-row" style="margin-top:10px"><button class="btn btn-primary" id="att-save">Guardar asistencia</button><span class="muted" id="att-hint"></span></div>
  </section>`;
}

async function initAttendance() {
  const cargar = async () => {
    const asigId = Number($('#att-class').value);
    const fechaSel = $('#att-date').value;
    const asig = (state.data.asignaciones || []).find((a) => a.id === asigId);
    if (!asig || !fechaSel) return;
    try {
      const [estData, asistData] = await Promise.all([
        api(`/docente/estudiantes?asignacion_id=${asigId}`),
        api(`/asistencias?curso_id=${asig.curso_id}&fecha=${fechaSel}`),
      ]);
      const prev = {}; for (const a of asistData) prev[a.estudiante_id] = a.estado;
      state.data.attStudents = estData.estudiantes;
      $('#att-hint').textContent = asistData.length ? `Ya existe registro del ${fechaSel}: se sobreescribirá.` : '';
      $('#att-list').innerHTML = estData.estudiantes.map((e) => `<div class="att-row"><strong>${esc(e.apellidos)}, ${esc(e.nombres)}</strong><div class="att-options">${['presente', 'tarde', 'ausente', 'licencia'].map((est) => `<label class="att-opt"><input type="radio" name="att-${e.id}" value="${est}" ${(prev[e.id] || 'presente') === est ? 'checked' : ''}>${est}</label>`).join('')}</div></div>`).join('') || empty('No hay estudiantes en este curso');
    } catch (error) { $('#att-list').innerHTML = `<div class="card"><p>${esc(error.message)}</p></div>`; }
  };
  $('#att-class').addEventListener('change', cargar);
  $('#att-date').addEventListener('change', cargar);
  $('#att-save').addEventListener('click', async () => {
    const fechaSel = $('#att-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSel)) { mostrarError(new Error('Selecciona una fecha válida')); return; }
    const registros = (state.data.attStudents || []).map((e) => ({ estudiante_id: e.id, estado: $(`input[name="att-${e.id}"]:checked`)?.value || 'presente' }));
    if (!registros.length) return;
    try {
      const r = await api('/asistencias', { method: 'POST', body: JSON.stringify({ fecha: fechaSel, registros }) });
      $('#att-hint').textContent = '';
      showToast(`Asistencia del ${fechaSel} guardada (${r.guardados} registros)`, 'ok');
    } catch (error) { mostrarError(error); }
  });
  await cargar();
}

async function renderAdmin(view) {
  if (view === 'usuarios') return adminUsers();
  if (view === 'estudiantes') return adminStudents();
  if (view === 'academico') return adminAcademic();
  if (view === 'cursos') return adminCourses();
  if (view === 'reportes') return adminReports();
  if (view === 'notificaciones') return adminNotifications();
  if (view === 'familias') return adminFamilies();
  const [users, courses, subjects] = await Promise.all([api('/usuarios'), api('/cursos'), api('/materias')]);
  state.data.users = users; state.data.courses = courses; state.data.subjects = subjects;
  return `<div class="page-title"><span class="eyebrow">Dirección</span><h1>Vista general del sistema</h1><p>Gestión académica de la unidad educativa · ${new Date().getFullYear()}</p></div><div class="stats-grid"><div class="stat"><span class="stat-icon blue">${icon('users')}</span><strong>${users.length}</strong><small>usuarios</small></div><div class="stat"><span class="stat-icon green">${courses.length}</span><strong>${courses.reduce((n, c) => n + c.total_estudiantes, 0)}</strong><small>estudiantes</small></div><div class="stat"><span class="stat-icon yellow">${subjects.length}</span><strong>${subjects.length}</strong><small>materias activas</small></div></div><section class="card"><div class="section-heading"><h2>Acciones rápidas</h2></div><div class="quick-grid"><button class="quick-action" data-action="usuarios">${icon('users')}<strong>Usuarios</strong><small>Familias y docentes</small></button><button class="quick-action" data-action="cursos">${icon('calendar')}<strong>Cursos</strong><small>Capacidad y gestión</small></button><button class="quick-action" data-action="reportes">${icon('report')}<strong>Reportes</strong><small>Rendimiento académico</small></button></div></section>`;
}
function userRow(u) {
  return `<tr><td><strong>${esc(u.nombres)} ${esc(u.apellidos)}</strong><small>@${esc(u.username)}</small></td><td><span class="tag">${rolLabel[u.rol]}</span></td><td>${esc(u.email || 'Sin correo')}</td><td><span class="semaforo ${u.activo ? 'verde' : 'rojo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td><td><div class="action-row"><button class="btn btn-outline btn-sm" data-edit-user="${u.id}">Editar</button>${u.id !== state.user.id ? (u.activo ? `<button class="btn btn-rojo btn-sm" data-toggle-user="${u.id}" data-activar="0">Desactivar</button>` : `<button class="btn btn-verde btn-sm" data-toggle-user="${u.id}" data-activar="1">Activar</button>`) : ''}</div></td></tr>`;
}
async function adminUsers() {
  const users = state.data.users || await api('/usuarios');
  state.data.users = users;
  return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Usuarios del sistema</h1><p>Administra el acceso de cada integrante de la comunidad educativa.</p></div><section class="card"><div class="section-heading"><h2>${users.length} cuentas registradas</h2><button class="btn btn-primary btn-sm" data-action="new-user">Nuevo usuario</button></div><input id="user-search" class="search-input" placeholder="Buscar por nombre o usuario..."><div class="table-wrap"><table><thead><tr><th>Persona</th><th>Rol</th><th>Contacto</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="users-tbody">${users.map(userRow).join('')}</tbody></table></div></section>`;
}
function studentRow(s) { return `<tr><td><strong>${esc(s.apellidos)}, ${esc(s.nombres)}</strong><small>${s.fecha_nacimiento || 'Sin fecha de nacimiento'}</small></td><td>${esc(s.rude)}</td><td><span class="tag">${esc(s.curso)}</span></td><td>${s.username ? `@${esc(s.username)}` : '<span class="muted">Sin cuenta</span>'}</td></tr>`; }
async function adminStudents() {
  const students = await api('/estudiantes');
  state.data.students = students;
  const courses = state.data.courses || await api('/cursos'); state.data.courses = courses;
  return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Estudiantes matriculados</h1><p>Controla RUDE, curso y capacidad de la gestión activa.</p></div><section class="card"><div class="section-heading"><h2>${students.length} estudiantes</h2><div class="action-row"><button class="btn btn-outline btn-sm" data-action="export-students">Exportar CSV</button><button class="btn btn-primary btn-sm" data-action="new-student">Nuevo estudiante</button></div></div><input id="student-search" class="search-input" placeholder="Buscar por nombre, apellido o RUDE..."><div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>RUDE</th><th>Curso</th><th>Cuenta</th></tr></thead><tbody id="students-tbody">${students.map(studentRow).join('')}</tbody></table></div></section>`;
}
async function adminFamilies() {
  const [links, tutors, students] = await Promise.all([api('/vinculos'), api('/usuarios?rol=tutor'), api('/estudiantes')]);
  state.data.familyLinks = links; state.data.tutors = tutors; state.data.students = students;
  const grouped = tutors.map((tutor) => ({ tutor, children: links.filter((link) => link.tutor_id === tutor.id) }));
  return `<div class="page-title"><span class="eyebrow">Administración familiar</span><h1>Tutores y sus hijos</h1><p>Asigna los estudiantes que cada tutor podrá consultar en su panel familiar.</p></div><section class="card"><div class="section-heading"><h2>Asignar hijo a tutor</h2></div><form id="family-link-form"><div class="form-grid"><div class="campo"><label>Tutor</label><select name="tutor_id" required>${tutors.map((tutor) => `<option value="${tutor.id}">${esc(tutor.nombres)} ${esc(tutor.apellidos)}</option>`).join('')}</select></div><div class="campo"><label>Estudiante</label><select name="estudiante_id" required>${students.map((student) => `<option value="${student.id}">${esc(student.apellidos)}, ${esc(student.nombres)} · ${esc(student.curso)}</option>`).join('')}</select></div></div><button class="btn btn-primary" type="submit">Asignar hijo</button></form></section><section class="card"><div class="section-heading"><h2>Relaciones familiares</h2><span class="tag">${links.length} vínculos</span></div><div class="family-links">${grouped.map(({ tutor, children }) => `<article class="family-tutor"><div class="family-tutor-heading"><strong>${esc(tutor.nombres)} ${esc(tutor.apellidos)}</strong><span class="tag">${children.length} hijos</span></div>${children.length ? children.map((child) => `<div class="family-child"><div><strong>${esc(child.estudiante)}</strong><small>RUDE: ${esc(child.rude)}</small></div><button class="btn btn-rojo btn-sm" data-delete-family-link="${child.id}">Quitar</button></div>`).join('') : '<p class="subject-assignment-empty">Sin estudiantes asignados</p>'}</article>`).join('') || empty('No hay tutores registrados')}</div></section>`;
}
async function adminNotifications() {
  const [notifications, users, courses] = await Promise.all([api('/admin/notificaciones'), api('/usuarios'), api('/cursos')]);
  state.data.notificationUsers = users; state.data.notificationCourses = courses;
  const roleLabels = { admin: 'Administración', docente: 'Docentes', tutor: 'Tutores', estudiante: 'Estudiantes' };
  return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Gestión de notificaciones</h1><p>Envía avisos segmentados y administra el historial de notificaciones.</p></div><section class="card"><div class="section-heading"><h2>Nueva notificación</h2></div><form id="notification-form"><div class="form-grid"><div class="campo"><label>Título</label><input name="titulo" required maxlength="120" placeholder="Ej. Reunión de padres"></div><div class="campo"><label>Tipo</label><select name="tipo"><option value="administrativa">Administrativa</option><option value="academica">Académica</option><option value="urgente">Urgente</option><option value="recordatorio">Recordatorio</option></select></div><div class="campo"><label>Enviar para</label><select name="destino" id="notification-destino"><option value="todos">Todos los usuarios activos</option><option value="rol">Un rol</option><option value="usuario">Un usuario</option><option value="curso">Docentes y tutores de un curso</option></select></div><div class="campo" id="notification-rol-field"><label>Rol destinatario</label><select name="rol"><option value="docente">Docentes</option><option value="tutor">Tutores</option><option value="estudiante">Estudiantes</option><option value="admin">Administración</option></select></div><div class="campo" id="notification-user-field"><label>Usuario destinatario</label><select name="usuario_id">${users.filter((user) => user.activo).map((user) => `<option value="${user.id}">${esc(user.nombres)} ${esc(user.apellidos)} · ${roleLabels[user.rol]}</option>`).join('')}</select></div><div class="campo" id="notification-course-field"><label>Curso destinatario</label><select name="curso_id">${courses.map((course) => `<option value="${course.id}">${esc(course.nombre)} · ${course.total_estudiantes} estudiantes</option>`).join('')}</select></div><div class="campo campo-full"><label>Mensaje</label><textarea name="mensaje" rows="4" required maxlength="1000" placeholder="Escribe el contenido de la notificación"></textarea></div></div><button class="btn btn-primary" type="submit">Enviar notificación</button></form></section><section class="card"><div class="section-heading"><h2>Historial de envíos</h2><span class="tag">${notifications.length} registros</span></div><div class="notification-admin-list">${notifications.map((notification) => `<article class="notification-admin-row"><div><strong>${esc(notification.titulo)}</strong><small>${esc(notification.destinatario)} · ${roleLabels[notification.rol] || notification.rol} · ${fecha(notification.created_at)}</small><p>${esc(notification.mensaje)}</p></div><button class="btn btn-rojo btn-sm" data-delete-notification="${notification.id}">Eliminar</button></article>`).join('') || empty('No hay notificaciones enviadas')}</div></section>`;
}
async function adminAcademic() {
  const [assignments, subjects, users, courses] = await Promise.all([api('/asignaciones'), api('/materias'), api('/usuarios?rol=docente'), api('/cursos')]);
  state.data.courses = courses; state.data.asignacionesAdmin = assignments; state.data.subjects = subjects; state.data.docentes = users;
  const grouped = subjects.map((subject) => ({ subject, assignments: assignments.filter((assignment) => assignment.materia_id === subject.id) }));
  const subjectGroups = grouped.map(({ subject, assignments: subjectAssignments }) => `<article class="subject-assignment-group"><div class="subject-assignment-heading"><div class="subject-assignment-title"><span class="subject-mark">${esc(subject.nombre[0])}</span><div><h3>${esc(subject.nombre)}</h3><small>${subjectAssignments.length} asignaciones · ${new Set(subjectAssignments.map((assignment) => assignment.docente_id)).size} docentes</small></div></div><button class="btn btn-outline btn-sm" data-action="new-assignment" data-subject-id="${subject.id}">Asignar docente</button></div>${subjectAssignments.length ? `<div class="subject-assignment-list">${subjectAssignments.map((assignment) => `<div class="subject-assignment-row"><div><strong>${esc(assignment.docente)}</strong><small>${esc(assignment.curso)} · Gestión ${assignment.gestion_anio}</small></div><span class="tag">${esc(assignment.curso)}</span><button class="btn btn-rojo btn-sm" data-remove-assignment="${assignment.id}">Quitar</button></div>`).join('')}</div>` : '<p class="subject-assignment-empty">Sin docentes asignados</p>'}</article>`).join('');
  return `<div class="page-title"><span class="eyebrow">Administración académica</span><h1>Materias y asignaciones</h1><p>Consulta cada materia y todos los docentes asignados a sus cursos.</p></div><section class="card"><div class="section-heading"><h2>Asignaciones por materia</h2><button class="btn btn-primary btn-sm" data-action="new-assignment">Nueva asignación</button></div><div class="subject-assignment-groups">${subjectGroups || empty('No hay materias configuradas')}</div></section><section class="card"><div class="section-heading"><h2>${subjects.length} materias configuradas</h2><button class="btn btn-outline btn-sm" data-action="new-subject">Agregar materia</button></div><div class="chip-list">${subjects.map((subject) => `<span class="tag">${esc(subject.nombre)}</span>`).join('')}</div></section>`;
}
function courseRow(c) {
  const ocupacion = c.capacidad_max ? Math.min(100, Math.round((c.total_estudiantes / c.capacidad_max) * 100)) : 0;
  return `<tr class="course-row-clickable" data-course-list="${c.id}">
    <td><strong>${esc(c.nombre)}</strong><small>${esc(c.nivel)}</small></td>
    <td>${esc(c.gestion)}</td>
    <td><span class="tag">${c.total_estudiantes}</span></td>
    <td>${c.capacidad_max}</td>
    <td>
      <div class="course-progress">
        <div><span style="width:${ocupacion}%"></span></div>
        <small>${ocupacion}%</small>
      </div><button class="btn btn-outline btn-sm" data-course-list="${c.id}">Ver filiación</button>
    </td>
  </tr>`;
}
async function adminCourses() {
  const [courses, gestiones] = await Promise.all([api('/cursos'), api('/gestiones')]);
  state.data.courses = courses; state.data.gestiones = gestiones;
  const activa = gestiones.find((g) => g.activa);
  return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Cursos y gestiones</h1><p>Gestión activa: ${activa ? activa.anio : 'ninguna'} · máximo 40 estudiantes por curso.</p></div>
  <section class="card"><div class="section-heading"><h2>Gestiones académicas</h2></div>${gestiones.map((g) => `<div class="course-row"><div><strong>Gestión ${g.anio}</strong><small>${g.total_cursos} cursos · ${g.activa ? 'activa' : 'inactiva'}</small></div><div class="action-row">${g.activa ? '<span class="tag">Activa</span>' : `<button class="btn btn-verde btn-sm" data-gestion-activar="${g.id}">Activar</button>`}</div></div>`).join('') || empty('No hay gestiones registradas')}<form id="gestion-form" class="form-inline"><div class="campo"><label>Nueva gestión</label><input name="anio" type="number" min="2000" max="2100" placeholder="Año, ej. 2027" required></div><button class="btn btn-primary btn-sm">Crear gestión</button></form></section>
  <section class="card"><div class="section-heading"><h2>Cursos</h2><button class="btn btn-primary btn-sm" data-action="new-course">Nuevo curso</button></div><div class="table-wrap"><table><thead><tr><th>Curso</th><th>Gestión</th><th>Estudiantes</th><th>Capacidad</th><th>Progreso</th></tr></thead><tbody>${courses.map(courseRow).join('') || '<tr><td colspan="5">No hay cursos creados</td></tr>'}</tbody></table></div></section>`;
}
async function adminReports() { const courses = state.data.courses || await api('/cursos'); state.data.courses = courses; const reports = await Promise.all(courses.map(async (course) => ({ course, risk: await api(`/reportes/riesgo?curso_id=${course.id}`), performance: await api(`/reportes/rendimiento?curso_id=${course.id}`) }))); return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Reportes académicos</h1><p>Rendimiento, asistencia académica y estudiantes que requieren apoyo.</p></div>${reports.map(({ course, risk, performance }) => `<section class="card report-course"><div class="section-heading"><div><h2>${esc(course.nombre)}</h2><p class="muted">${risk.estudiantes.length} estudiantes en riesgo · trimestre ${risk.trimestre_actual || 'sin datos'}</p></div><span class="tag">${course.total_estudiantes} estudiantes</span></div>${risk.estudiantes.length ? risk.estudiantes.map((item) => `<div class="notice-line"><span class="puntito rojo"></span><div><strong>${esc(item.estudiante.nombres)} ${esc(item.estudiante.apellidos)}</strong><p>${item.materias_en_riesgo.map((m) => `${esc(m.materia)} (${m.promedio_anual ?? '—'})`).join(' · ')}</p></div></div>`).join('') : empty('No hay estudiantes en riesgo registrados')}<div class="report-subjects">${performance.materias.map((m) => `<div><span>${esc(m.materia)}</span><strong>${m.promedio_curso ?? '—'}</strong><small>${m.en_riesgo} en riesgo</small></div>`).join('')}</div></section>`).join('') || empty('No hay cursos configurados')}`; }

function bindActions() {
  document.querySelectorAll('[data-action]:not([data-action="new-task"])').forEach((element) => element.onclick = () => navigate(element.dataset.action));
  document.querySelectorAll('[data-assignment]').forEach((element) => element.onclick = () => showAssignment(Number(element.dataset.assignment)));
  document.querySelector('#teacher-open-class')?.addEventListener('click', () => {
    const assignmentId = Number(document.querySelector('#teacher-class-select')?.value);
    if (assignmentId) showAssignment(assignmentId);
  });
  document.querySelectorAll('[data-action="mark-task"]').forEach((element) => element.onclick = async (event) => {
    event.stopPropagation();
    const next = element.dataset.state === 'completada' ? 'pendiente' : 'completada';
    try { await api('/entregas/marcar', { method: 'PUT', body: JSON.stringify({ tarea_id: Number(element.dataset.task), estudiante_id: Number(element.dataset.student), estado: next }) }); state.data.expedientes = {}; await navigate('tareas'); } catch (error) { mostrarError(error); }
  });
  document.querySelectorAll('[data-upload-evidence]').forEach((input) => input.onchange = () => uploadEvidence(input));
  document.querySelector('[data-action="new-user"]')?.addEventListener('click', () => showUserForm());
  document.querySelector('[data-action="new-course"]')?.addEventListener('click', showCourseForm);
  document.querySelector('[data-action="new-task"]')?.addEventListener('click', () => showTaskForm().catch((error) => mostrarError(error)));
  document.querySelector('[data-action="new-student"]')?.addEventListener('click', showStudentForm);
  document.querySelectorAll('[data-course-list]').forEach((element) => element.addEventListener('click', (event) => {
    event.stopPropagation();
    showCourseStudents(Number(element.dataset.courseList));
  }));
  document.querySelectorAll('[data-action="new-assignment"]').forEach((button) => button.addEventListener('click', () => showAssignmentForm(button.dataset.subjectId)));
  document.querySelectorAll('[data-remove-assignment]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('¿Quitar esta asignación docente?')) return;
    try {
      await api(`/asignaciones/${button.dataset.removeAssignment}`, { method: 'DELETE' });
      state.data.asignacionesAdmin = null;
      await navigate('academico');
      showToast('Asignación quitada correctamente', 'ok');
    } catch (error) { mostrarError(error); }
  }));
  document.querySelector('[data-action="new-subject"]')?.addEventListener('click', showSubjectForm);
  document.querySelector('[data-action="export-students"]')?.addEventListener('click', exportStudents);
  const notificationDestination = $('#notification-destino');
  const updateNotificationFields = () => {
    const destination = notificationDestination?.value;
    if (!destination) return;
    $('#notification-rol-field').hidden = destination !== 'rol';
    $('#notification-user-field').hidden = destination !== 'usuario';
    $('#notification-course-field').hidden = destination !== 'curso';
  };
  notificationDestination?.addEventListener('change', updateNotificationFields);
  updateNotificationFields();
  $('#notification-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/admin/notificaciones', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await navigate('notificaciones'); showToast('Notificación enviada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  $('#family-link-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/vinculos', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await navigate('familias'); showToast('Hijo asignado al tutor correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  document.querySelectorAll('[data-delete-family-link]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('¿Quitar este vínculo familiar?')) return;
    try { await api(`/vinculos/${button.dataset.deleteFamilyLink}`, { method: 'DELETE' }); await navigate('familias'); showToast('Vínculo eliminado correctamente', 'ok'); } catch (error) { mostrarError(error); }
  }));
  document.querySelectorAll('[data-delete-notification]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('¿Eliminar esta notificación del historial?')) return;
    try { await api(`/admin/notificaciones/${button.dataset.deleteNotification}`, { method: 'DELETE' }); await navigate('notificaciones'); showToast('Notificación eliminada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  }));
  document.querySelectorAll('[data-edit-task]').forEach((element) => element.onclick = () => {
    const taskId = Number(element.dataset.editTask);
    api('/tareas').then((tasks) => {
      state.data.tareas = tasks;
      const task = tasks.find((item) => item.id === taskId);
      if (task) {
        showTaskForm(task).catch((error) => mostrarError(error));
      } else {
        showToast('La tarea ya no existe. Se actualizó la lista.', 'info');
        navigate('tareas');
      }
    }).catch((error) => mostrarError(error));
  });
  document.querySelectorAll('[data-delete-task]').forEach((element) => element.onclick = async () => {
    if (!window.confirm('¿Deseas eliminar esta tarea? También se eliminarán sus entregas asociadas.')) return;
    try { await api(`/tareas/${element.dataset.deleteTask}`, { method: 'DELETE' }); await navigate('tareas'); showToast('Tarea eliminada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  document.querySelectorAll('[data-review-task]').forEach((element) => element.onclick = () => showReviewForm(Number(element.dataset.reviewTask)));
  // Gestiones académicas (admin)
  document.querySelectorAll('[data-gestion-activar]').forEach((element) => element.onclick = async () => {
    try { await api(`/gestiones/${element.dataset.gestionActivar}/activar`, { method: 'PUT' }); state.data.courses = null; state.data.gestiones = null; await navigate('cursos'); showToast('Gestión activada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  $('#gestion-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/gestiones', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); state.data.gestiones = null; await navigate('cursos'); showToast('Gestión creada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  // Usuarios (admin): edición, activación y búsqueda
  bindUserButtons();
  $('#user-search')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    const lista = (state.data.users || []).filter((u) => !q || `${u.nombres} ${u.apellidos} ${u.username}`.toLowerCase().includes(q));
    $('#users-tbody').innerHTML = lista.map(userRow).join('') || '<tr><td colspan="5">Sin resultados para la búsqueda.</td></tr>';
    bindUserButtons();
  });
  // Estudiantes (admin): búsqueda
  $('#student-search')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    const lista = (state.data.students || []).filter((s) => !q || `${s.nombres} ${s.apellidos} ${s.rude}`.toLowerCase().includes(q));
    $('#students-tbody').innerHTML = lista.map(studentRow).join('') || '<tr><td colspan="4">Sin resultados para la búsqueda.</td></tr>';
  });
  // Asistencia docente
  if ($('#att-class')) initAttendance();
  if ($('#attendance-search')) initAttendanceRole();
  $('#child-select')?.addEventListener('change', (event) => { state.data.selectedChild = Number(event.target.value); state.data.expedientes = {}; navigate(state.view); });
}

function bindUserButtons() {
  document.querySelectorAll('[data-edit-user]').forEach((element) => element.onclick = () => {
    const u = (state.data.users || []).find((x) => x.id === Number(element.dataset.editUser));
    if (u) showUserForm(u);
  });
  document.querySelectorAll('[data-toggle-user]').forEach((element) => element.onclick = async () => {
    const activar = element.dataset.activar === '1';
    if (!activar && !window.confirm('¿Desactivar esta cuenta? Perderá acceso al sistema.')) return;
    try {
      if (activar) await api(`/usuarios/${element.dataset.toggleUser}`, { method: 'PUT', body: JSON.stringify({ activo: 1 }) });
      else await api(`/usuarios/${element.dataset.toggleUser}`, { method: 'DELETE' });
      state.data.users = null;
      await navigate('usuarios');
      showToast(activar ? 'Usuario activado correctamente' : 'Usuario desactivado correctamente', 'ok');
    } catch (error) { mostrarError(error); }
  });
}

function showModal(title, content) {
  $('#modal-root').innerHTML = `<div class="modal-fondo"><div class="modal"><div class="modal-titulo"><h2>${esc(title)}</h2><button class="modal-cerrar" id="close-modal" aria-label="Cerrar">×</button></div>${content}</div></div>`;
  $('#close-modal').onclick = () => { $('#modal-root').innerHTML = ''; };
}

function showUserForm(user = null) {
  const esEdicion = !!user;
  const esPropio = esEdicion && user.id === state.user.id;
  const rolOptions = [['tutor', 'Familia'], ['docente', 'Docente'], ['asistencia', 'Control de asistencia'], ['estudiante', 'Estudiante'], ['admin', 'Administración']]
    .map(([valor, label]) => `<option value="${valor}" ${user?.rol === valor ? 'selected' : ''}>${label}</option>`).join('');
  showModal(esEdicion ? 'Editar usuario' : 'Crear usuario', `<form id="user-form"><div class="form-grid"><div class="campo"><label>Usuario</label><input name="username" value="${esc(user?.username || '')}" required></div><div class="campo"><label>Contraseña ${esEdicion ? '<small class="muted">(vacía = sin cambios)</small>' : ''}</label><input name="password" type="password" minlength="6" ${esEdicion ? '' : 'required'}></div><div class="campo"><label>Nombres</label><input name="nombres" value="${esc(user?.nombres || '')}" required></div><div class="campo"><label>Apellidos</label><input name="apellidos" value="${esc(user?.apellidos || '')}" required></div><div class="campo"><label>Rol</label><select name="rol" ${esPropio ? 'disabled' : ''}>${rolOptions}</select></div><div class="campo"><label>Correo</label><input name="email" type="email" value="${esc(user?.email || '')}"></div>${esEdicion && !esPropio ? `<div class="campo"><label>Estado</label><select name="activo"><option value="1" ${user.activo ? 'selected' : ''}>Activo</option><option value="0" ${!user.activo ? 'selected' : ''}>Inactivo</option></select></div>` : ''}</div><button class="btn btn-primary btn-block">${esEdicion ? 'Guardar cambios' : 'Guardar usuario'}</button></form>`);
  $('#user-form').onsubmit = async (event) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget));
    if (!datos.password) delete datos.password;
    try {
      if (esEdicion) await api(`/usuarios/${user.id}`, { method: 'PUT', body: JSON.stringify(datos) });
      else await api('/usuarios', { method: 'POST', body: JSON.stringify(datos) });
      $('#modal-root').innerHTML = ''; state.data.users = null; await navigate('usuarios'); showToast(esEdicion ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente', 'ok');
    } catch (error) { mostrarError(error); }
  };
}

function showCourseForm() {
  const gestiones = state.data.gestiones || [];
  const gestionCampo = gestiones.length
    ? `<div class="campo"><label>Gestión</label><select name="gestion_id">${gestiones.map((g) => `<option value="${g.id}" ${g.activa ? 'selected' : ''}>Gestión ${g.anio}${g.activa ? ' (activa)' : ''}</option>`).join('')}</select></div>`
    : '<div class="campo"><label>Gestión</label><input name="gestion_id" type="number" min="1" placeholder="ID de la gestión" required></div>';
  showModal('Crear curso', `<form id="course-form"><div class="campo"><label>Nombre</label><input name="nombre" placeholder="2° Secundaria" required></div>${gestionCampo}<div class="campo"><label>Capacidad máxima</label><input name="capacidad_max" type="number" min="1" max="40" value="40" required></div><button class="btn btn-primary btn-block">Guardar curso</button></form>`);
  $('#course-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/cursos', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; state.data.courses = null; await navigate('cursos'); showToast('Curso creado correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showStudentForm(student = null, courseId = null) {
  const options = (state.data.courses || []).map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${c.total_estudiantes}/${c.capacidad_max}</option>`).join('');
  const editing = !!student;
  showModal(editing ? 'Editar estudiante' : 'Registrar estudiante', `<form id="student-form"><div class="form-grid"><div class="campo"><label>Nombres</label><input name="nombres" value="${esc(student?.nombres || '')}" required></div><div class="campo"><label>Apellidos</label><input name="apellidos" value="${esc(student?.apellidos || '')}" required></div><div class="campo"><label>Fecha de nacimiento</label><input name="fecha_nacimiento" type="date" value="${esc(student?.fecha_nacimiento || '')}"></div><div class="campo"><label>Curso</label><select name="curso_id" required>${options}</select></div><div class="campo campo-full"><label>RUDE (opcional)</label><input name="rude" value="${esc(student?.rude || '')}" placeholder="Se genera automáticamente si se omite"></div></div><button class="btn btn-primary btn-block">${editing ? 'Guardar cambios' : 'Registrar estudiante'}</button></form>`);
  $('#student-form [name="curso_id"]').value = courseId || student?.curso_id || '';
  $('#student-form').onsubmit = async (event) => { event.preventDefault(); try { await api(editing ? `/estudiantes/${student.id}` : '/estudiantes', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate(editing ? 'cursos' : 'estudiantes'); showToast(editing ? 'Estudiante actualizado correctamente' : 'Estudiante registrado correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

async function showCourseStudents(courseId) {
  try {
    const course = (state.data.courses || []).find((item) => item.id === courseId) || await api('/cursos').then((courses) => courses.find((item) => item.id === courseId));
    const students = await api(`/estudiantes?curso_id=${courseId}`);
    showModal(`Filiación · ${course.nombre}`, `<div class="section-heading filiacion-heading"><div><strong>${students.length} estudiantes</strong><small>Curso ${esc(course.nombre)} · Gestión ${esc(course.gestion)}</small></div><button class="btn btn-primary btn-sm" id="course-add-student">Añadir estudiante</button></div><div class="filiacion-list">${students.map((student) => `<article class="filiacion-student"><div class="filiacion-student-info"><strong>${esc(student.apellidos)}, ${esc(student.nombres)}</strong><small>RUDE: ${esc(student.rude)}</small><small>${student.fecha_nacimiento || 'Sin fecha de nacimiento'}</small></div><div class="filiacion-actions"><button class="btn btn-outline btn-sm" data-course-edit-student="${student.id}">Editar</button><button class="btn btn-rojo btn-sm" data-course-delete-student="${student.id}">Eliminar</button></div></article>`).join('') || '<p class="subject-assignment-empty">No hay estudiantes en este curso</p>'}</div>`);
    $('#course-add-student').onclick = () => showStudentForm(null, courseId);
    document.querySelectorAll('[data-course-edit-student]').forEach((button) => button.onclick = () => {
      const student = students.find((item) => item.id === Number(button.dataset.courseEditStudent));
      if (student) showStudentForm(student, courseId);
    });
    document.querySelectorAll('[data-course-delete-student]').forEach((button) => button.onclick = async () => {
      if (!window.confirm('¿Eliminar este estudiante? También se eliminarán sus datos académicos asociados.')) return;
      try { await api(`/estudiantes/${button.dataset.courseDeleteStudent}`, { method: 'DELETE' }); await showCourseStudents(courseId); showToast('Estudiante eliminado correctamente', 'ok'); } catch (error) { mostrarError(error); }
    });
  } catch (error) { mostrarError(error); }
}

function showAssignmentForm(subjectId = '') {
  const docentes = (state.data.docentes || []).map((u) => `<option value="${u.id}">${esc(u.nombres)} ${esc(u.apellidos)}</option>`).join('');
  const materias = (state.data.subjects || []).map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');
  const cursos = (state.data.courses || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  showModal('Nueva asignación', `<form id="assignment-form"><div class="campo"><label>Docente</label><select name="docente_id" required>${docentes}</select></div><div class="campo"><label>Materia</label><select name="materia_id" required>${materias}</select></div><div class="campo"><label>Curso</label><select name="curso_id" required>${cursos}</select></div><button class="btn btn-primary btn-block">Guardar asignación</button></form>`);
  if (subjectId) $('#assignment-form [name="materia_id"]').value = subjectId;
  $('#assignment-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/asignaciones', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate('academico'); showToast('Asignación creada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showSubjectForm() {
  showModal('Agregar materia', `<form id="subject-form"><div class="campo"><label>Nombre de la materia</label><input name="nombre" required maxlength="120" placeholder="Escribe cualquier materia"></div><div class="campo"><label>Descripción</label><textarea name="descripcion" rows="2"></textarea></div><button class="btn btn-primary btn-block">Guardar materia</button></form>`);
  $('#subject-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/materias', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate('academico'); showToast('Materia creada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

async function exportStudents() {
  try { const response = await fetch(`${API}/estudiantes/export`, { headers: { Authorization: `Bearer ${state.token}` } }); if (!response.ok) throw new Error('No se pudo exportar la lista'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'estudiantes.csv'; link.click(); URL.revokeObjectURL(url); } catch (error) { mostrarError(error); }
}

async function showTaskForm(task = null) {
  const asignaciones = await api('/docente/asignaciones');
  state.data.asignaciones = asignaciones;
  const options = asignaciones.map((a) => `<option value="${a.id}">${esc(a.curso)} · ${esc(a.materia)} · ${a.total_estudiantes} estudiantes</option>`).join('');
  if (!options) { showToast('No hay cursos disponibles para crear la tarea', 'info'); return; }
  const titulo = task ? 'Editar tarea' : 'Publicar tarea';
  const action = task ? `/tareas/${task.id}` : '/tareas';
  const method = task ? 'PUT' : 'POST';
  showModal(titulo, `<form id="task-form"><div class="campo"><label>Clase</label><select name="asignacion_id" required>${options}</select></div><div class="campo"><label>Título</label><input name="titulo" value="${esc(task?.titulo || '')}" required></div><div class="campo"><label>Descripción</label><textarea name="descripcion" rows="3">${esc(task?.descripcion || '')}</textarea></div><div class="form-grid"><div class="campo"><label>Tipo</label><select name="tipo"><option value="tarea" ${task?.tipo === 'tarea' ? 'selected' : ''}>Tarea</option><option value="actividad" ${task?.tipo === 'actividad' ? 'selected' : ''}>Actividad</option><option value="trabajo_practico" ${task?.tipo === 'trabajo_practico' ? 'selected' : ''}>Trabajo práctico</option><option value="examen" ${task?.tipo === 'examen' ? 'selected' : ''}>Examen</option></select></div><div class="campo"><label>Fecha de entrega</label><input name="fecha_entrega" type="date" value="${esc(task?.fecha_entrega || '')}"></div></div><div class="campo"><label>Material de apoyo</label><input name="archivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"><small class="ayuda">Máximo 10 MB.</small></div><button class="btn btn-primary btn-block">${task ? 'Guardar cambios' : 'Publicar tarea'}</button></form>`);
  if (task) $('#task-form [name="asignacion_id"]').value = task.asignacion_id;
  $('#task-form').onsubmit = async (event) => { event.preventDefault(); try { await api(action, { method, body: new FormData(event.currentTarget) }); $('#modal-root').innerHTML = ''; await navigate('tareas'); showToast(task ? 'Tarea actualizada correctamente' : 'Tarea publicada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

async function showReviewForm(taskId) {
  try {
    const result = await api(`/entregas?tarea_id=${taskId}`);
    showModal(`Revisar: ${result.tarea.titulo}`, `<p class="muted">El docente puede calificar cada estudiante aunque todavía no haya adjuntado la tarea.</p><div class="form-grid"><div class="campo"><label>Trimestre</label><select id="review-trimester"><option value="1">Trimestre 1</option><option value="2">Trimestre 2</option><option value="3">Trimestre 3</option></select></div><div class="campo"><label>Campo a calificar</label><small class="ayuda">Selecciona SER, SABER o HACER para cada estudiante.</small></div></div><div class="review-list">${result.entregas.length ? result.entregas.map((entrega) => `<article class="review-item ${entrega.estado !== 'completada' ? 'review-pending' : ''}"><div><strong>${esc(entrega.apellidos)}, ${esc(entrega.nombres)}</strong><small>${entrega.estado !== 'completada' ? 'Sin entrega adjunta' : entrega.revisada ? `Revisada el ${fecha(entrega.revision_fecha)}` : 'Entregada · pendiente de revisión'}</small></div>${entrega.archivo_path ? `<button class="btn btn-outline btn-sm" data-download-evidence="${entrega.id}">Descargar evidencia</button>` : '<small>Sin archivo adjunto</small>'}<div class="form-grid"><div class="campo"><label>Campo</label><select data-review-component="${entrega.id}"><option value="ser">SER /10</option><option value="saber">SABER /45</option><option value="hacer">HACER /40</option></select></div><div class="campo"><label>Puntos</label><input data-review-score="${entrega.id}" type="number" min="0" step="0.5" placeholder="0"></div></div><textarea data-review-comment="${entrega.id}" rows="2" placeholder="Comentario para el estudiante">${esc(entrega.revision_comentario || '')}</textarea><button class="btn ${entrega.revisada ? 'btn-gris' : 'btn-verde'} btn-sm" data-review-delivery="${entrega.id}">${entrega.revisada ? 'Actualizar revisión y nota' : 'Guardar calificación'}</button></article>`).join('') : empty('No hay estudiantes asignados')}</div>`);
    $('#modal-root').querySelectorAll('[data-review-delivery]').forEach((button) => button.onclick = async () => {
      const id = button.dataset.reviewDelivery;
      const comentario = $('#modal-root').querySelector(`[data-review-comment="${id}"]`).value;
      const componente = $('#modal-root').querySelector(`[data-review-component="${id}"]`).value;
      const valor = $('#modal-root').querySelector(`[data-review-score="${id}"]`).value;
      if (valor === '') { mostrarError(new Error('Ingresa los puntos de la calificación')); return; }
      const trimestre = Number($('#modal-root').querySelector('#review-trimester').value);
      try { await api(`/entregas/${id}/revisar`, { method: 'PUT', body: JSON.stringify({ comentario, trimestre, componente, valor: Number(valor) }) }); $('#modal-root').innerHTML = ''; await navigate('tareas'); showToast('Entrega revisada y nota guardada', 'ok'); } catch (error) { mostrarError(error); }
    });
    $('#modal-root').querySelectorAll('[data-download-evidence]').forEach((button) => button.onclick = () => downloadEvidence(Number(button.dataset.downloadEvidence)));
  } catch (error) { mostrarError(error); }
}

async function uploadEvidence(input) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('archivo', file);
  try { await api(`/entregas/${input.dataset.uploadEvidence}/enviar`, { method: 'POST', body: form }); state.data.expedientes = {}; await navigate('tareas'); showToast('Evidencia enviada correctamente', 'ok'); } catch (error) { mostrarError(error); }
}

async function downloadEvidence(id) {
  try { const response = await fetch(`${API}/entregas/${id}/archivo`, { headers: { Authorization: `Bearer ${state.token}` } }); if (!response.ok) throw new Error('No se pudo descargar la evidencia'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'evidencia'; link.click(); URL.revokeObjectURL(url); } catch (error) { mostrarError(error); }
}

async function showAssignment(id) {
  let root = $('#class-detail');
  if (!root) {
    await navigate('clases');
    root = $('#class-detail');
  }
  if (!root) return;
  root.innerHTML = loading('Cargando estudiantes...');
  try {
    const data = await api(`/docente/estudiantes?asignacion_id=${id}`);
    const asig = (state.data.asignaciones || []).find((a) => a.id === id) || {};
    const obs = asig.curso_id ? await api(`/observaciones?curso_id=${asig.curso_id}`).catch(() => []) : [];
    // Abrir en el último trimestre con notas registradas (o trimestre 1)
    const conNotas = [1, 2, 3].filter((b) => data.estudiantes.some((e) => e.notas && e.notas[b]));
    const inicial = conNotas.length ? Math.max(...conNotas) : 1;

    const renderGrades = (trimestre) => {
      root.innerHTML = `<section class="card"><div class="section-heading"><div><h2>${esc(data.asignacion.materia)}</h2><p class="muted">${esc(data.asignacion.curso)}</p></div><div class="grade-tools"><select id="grade-term"><option value="1" ${trimestre === 1 ? 'selected' : ''}>Trimestre 1</option><option value="2" ${trimestre === 2 ? 'selected' : ''}>Trimestre 2</option><option value="3" ${trimestre === 3 ? 'selected' : ''}>Trimestre 3</option></select><button class="btn btn-verde btn-sm" id="save-grades">Guardar notas</button></div></div><p class="grade-entry-help">Escribe directamente la nota de cada dimensión y luego presiona Guardar notas.</p><div class="table-wrap"><table class="grades-table"><thead><tr><th>Estudiante</th>${COMPONENTES.map(([key, label, max]) => `<th>${label}<br><small>/${max}</small></th>`).join('')}<th>Total</th></tr></thead><tbody>${data.estudiantes.map((e) => { const n = (e.notas && e.notas[trimestre]) || {}; const t = (e.acumulado_tareas && e.acumulado_tareas[trimestre]) || {}; const acumulado = [t.ser !== undefined ? `SER ${t.ser}` : '', t.saber !== undefined ? `SABER ${t.saber}` : '', t.hacer !== undefined ? `HACER ${t.hacer}` : ''].filter(Boolean).join(' · ') || 'Sin calificaciones de tareas'; return `<tr data-student="${e.id}"><td><strong>${esc(e.apellidos)}, ${esc(e.nombres)}</strong><small>${esc(e.rude)}</small><small class="task-accumulated">Tareas: ${esc(acumulado)}</small></td>${COMPONENTES.map(([key, , max]) => `<td><input class="grade-input" data-grade="${key}" type="number" inputmode="decimal" min="0" max="${max}" step="0.5" placeholder="0" value="${n[key] ?? ''}" aria-label="${key} de ${esc(e.nombres)}"></td>`).join('')}<td><strong class="row-total">${n.ser !== undefined ? Math.round((Number(n.ser) + Number(n.saber) + Number(n.hacer) + Number(n.decidir)) * 100) / 100 : '—'}</strong></td></tr>`; }).join('')}</tbody></table></div><p class="muted" style="margin-top:8px">Las notas de tareas se acumulan por dimensión y se reflejan aquí. Ser /10 · Saber /45 · Hacer /40 · Autoevaluación /5.</p></section>
      <section class="card"><div class="section-heading"><h2>Observaciones del curso</h2></div>
        <form id="obs-form"><div class="form-grid"><div class="campo"><label>Estudiante</label><select name="estudiante_id">${data.estudiantes.map((e) => `<option value="${e.id}">${esc(e.apellidos)}, ${esc(e.nombres)}</option>`).join('')}</select></div><div class="campo"><label>Tipo</label><select name="tipo"><option value="academica">Académica</option><option value="conductual">Conductual</option></select></div><div class="campo campo-full"><label>Descripción</label><textarea name="descripcion" rows="2" required></textarea></div></div><div class="action-row"><button class="btn btn-primary btn-sm" type="submit">Guardar observación</button></div></form>
        <div id="obs-list">${obs.length ? obs.map((o) => `<div class="notice-line"><span class="puntito ${o.tipo === 'conductual' ? 'amarillo' : 'verde'}"></span><div><strong>${esc(o.estudiante)}${o.materia ? ` · ${esc(o.materia)}` : ''}</strong><p>${esc(o.descripcion)}</p><small>${esc(o.docente)} · ${fecha(o.fecha)}</small></div>${(o.docente_id === state.user.id || state.user.rol === 'admin') ? `<button class="btn btn-rojo btn-sm" data-del-obs="${o.id}">Eliminar</button>` : ''}</div>`).join('') : empty('No hay observaciones registradas')}</div>
      </section>`;
      root.querySelector('#grade-term').onchange = (event) => renderGrades(Number(event.target.value));
      root.querySelector('#save-grades').onclick = async () => {
        const invalid = [...root.querySelectorAll('[data-grade]')].find((input) => {
          if (input.value === '') return false;
          const value = Number(input.value);
          const max = Number(input.max);
          const invalidValue = !Number.isFinite(value) || value < 0 || value > max;
          input.classList.toggle('grade-input-invalid', invalidValue);
          return invalidValue;
        });
        if (invalid) {
          invalid.focus();
          mostrarError(new Error(`La nota de ${invalid.dataset.grade.toUpperCase()} debe estar entre 0 y ${invalid.max}. No se guardaron las notas.`));
          return;
        }
        for (const row of root.querySelectorAll('tbody tr')) {
          const inputs = [...row.querySelectorAll('[data-grade]')];
          if (inputs.every((input) => input.value === '')) continue;
          const values = Object.fromEntries(inputs.map((input) => [input.dataset.grade, Number(input.value || 0)]));
          await api('/notas', { method: 'PUT', body: JSON.stringify({ estudiante_id: Number(row.dataset.student), materia_id: data.asignacion.materia_id, trimestre, ...values }) });
        }
        showToast(`Notas del trimestre ${trimestre} guardadas`, 'ok');
      };
      root.querySelector('#obs-form').onsubmit = async (event) => {
        event.preventDefault();
        const datos = Object.fromEntries(new FormData(event.currentTarget));
        try { await api('/observaciones', { method: 'POST', body: JSON.stringify({ ...datos, estudiante_id: Number(datos.estudiante_id), asignacion_id: id }) }); showToast('Observación registrada y familia notificada', 'ok'); await showAssignment(id); } catch (error) { mostrarError(error); }
      };
      root.querySelectorAll('[data-del-obs]').forEach((button) => button.onclick = async () => {
        if (!window.confirm('¿Eliminar esta observación?')) return;
        try { await api(`/observaciones/${button.dataset.delObs}`, { method: 'DELETE' }); await showAssignment(id); showToast('Observación eliminada', 'ok'); } catch (error) { mostrarError(error); }
      });
    };
    renderGrades(inicial);
  } catch (error) { root.innerHTML = `<div class="card"><p>${esc(error.message)}</p></div>`; }
}

async function iniciarApp() {
  try { state.data = {}; state.view = 'inicio'; state.user = await api('/auth/me'); header(); tabs(); await navigate('inicio'); bindActions(); } catch (_) { clearSession(); renderLogin(); }
}

document.addEventListener('click', (event) => { if (event.target.matches('[data-action]')) { setTimeout(bindActions, 0); } });

if (state.token) iniciarApp(); else renderLogin();
