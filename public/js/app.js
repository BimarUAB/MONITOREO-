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
const rolLabel = { admin: 'Administración', docente: 'Docente', tutor: 'Familia', estudiante: 'Estudiante' };
const tipoLabel = { tarea: 'Tarea', actividad: 'Actividad', trabajo_practico: 'Trabajo práctico', examen: 'Examen' };

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
        <div class="login-escudo" aria-hidden="true"><svg viewBox="0 0 64 64" width="52" height="52"><path d="M32 5 39 21l17 2-13 11 4 17-15-9-15 9 4-17L8 23l17-2z" fill="#f4b41a"/><circle cx="32" cy="30" r="7" fill="#fff"/></svg></div>
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
    panel.innerHTML = `<div class="notif-head"><h3>Notificaciones</h3><button class="btn btn-sm btn-gris" id="read-notifs">Marcar leídas</button></div>${result.notificaciones.length ? result.notificaciones.map((n) => `<button class="notif-item ${n.leida ? '' : 'no-leida'}" data-notif="${n.id}"><strong>${esc(n.titulo)}</strong><span>${esc(n.mensaje)}</span><small class="notif-fecha">${fecha(n.created_at)}</small></button>`).join('') : empty('No tienes notificaciones nuevas')}`;
    panel.hidden = false;
    $('#notif-badge').hidden = !result.no_leidas;
    $('#notif-badge').textContent = result.no_leidas;
    $('#read-notifs')?.addEventListener('click', async () => { const ids = result.notificaciones.filter((n) => !n.leida).map((n) => n.id); if (!ids.length) return; await api('/notificaciones/leer', { method: 'PUT', body: JSON.stringify({ ids }) }); panel.hidden = true; toggleNotifications(); });
    panel.querySelectorAll('[data-notif]').forEach((item) => item.addEventListener('click', async () => { await api(`/notificaciones/${item.dataset.notif}/leer`, { method: 'PUT' }); item.classList.remove('no-leida'); }));
  } catch (error) { mostrarError(error); }
}

function tabs() {
  const items = state.user.rol === 'tutor' || state.user.rol === 'estudiante'
    ? [['inicio', 'home', 'Resumen'], ['notas', 'grades', 'Notas'], ['tareas', 'tasks', 'Tareas'], ['asistencia', 'calendar', 'Asistencia'], ['comunicados', 'notice', 'Avisos']]
    : state.user.rol === 'docente'
      ? [['inicio', 'home', 'Inicio'], ['clases', 'grades', 'Mis clases'], ['tareas', 'tasks', 'Tareas'], ['comunicados', 'notice', 'Avisos']]
      : [['inicio', 'home', 'Inicio'], ['usuarios', 'users', 'Usuarios'], ['estudiantes', 'users', 'Estudiantes'], ['academico', 'grades', 'Académico'], ['cursos', 'calendar', 'Cursos'], ['reportes', 'report', 'Reportes']];
  $('#tabbar').hidden = false;
  $('#tabbar').innerHTML = items.map(([id, ico, label]) => `<button class="tab ${state.view === id ? 'active' : ''}" data-view="${id}"><span>${icon(ico)}</span><small>${label}</small></button>`).join('');
  $('#tabbar').querySelectorAll('[data-view]').forEach((button) => button.onclick = () => navigate(button.dataset.view));
}

async function navigate(view) { state.view = view; tabs(); $('#view').innerHTML = loading(); try { $('#view').innerHTML = await renderView(view); bindActions(); } catch (error) { $('#view').innerHTML = `<div class="card"><h2>No se pudo cargar esta vista</h2><p>${esc(error.message)}</p></div>`; mostrarError(error); } }

async function renderView(view) {
  if (state.user.rol === 'tutor' || state.user.rol === 'estudiante') return renderFamily(view);
  if (state.user.rol === 'docente') return renderTeacher(view);
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
    <section class="card"><div class="section-heading"><h2>Avance bimestral</h2><button class="text-button" data-action="notas">Ver notas</button></div>${[1, 2, 3, 4].map((b) => { const values = data.materias.map((m) => m.bimestres[b - 1].promedio).filter((n) => n !== null); const avg = values.length ? Math.round(values.reduce((a, n) => a + n, 0) / values.length) : null; return `<div class="progreso"><div class="progreso-info"><span>Bimestre ${b}</span><span>${avg === null ? 'Pendiente' : `${avg}/100`}</span></div><div class="progreso-pista"><div class="progreso-relleno ${semaforo(avg)}" style="width:${avg || 0}%"></div></div></div>`; }).join('')}</section>
    <section class="card"><div class="section-heading"><h2>Actividad reciente</h2><button class="text-button" data-action="tareas">Ver tareas</button></div>${data.tareas.slice(0, 3).map(taskRow).join('') || empty('No hay tareas registradas')}</section>
    ${data.observaciones.length ? `<section class="card"><h2 class="card-titulo">Últimas observaciones</h2>${data.observaciones.slice(0, 2).map((o) => `<div class="notice-line"><span class="puntito ${o.tipo === 'conductual' ? 'amarillo' : 'verde'}"></span><div><strong>${esc(o.materia || 'Seguimiento general')}</strong><p>${esc(o.descripcion)}</p><small>${fecha(o.fecha)}</small></div></div>`).join('')}</section>` : ''}`;
}

function familyGrades(data) { return `<section class="card"><div class="section-heading"><div><h2>Notas por materia</h2><p class="muted">Componentes de evaluación sobre 100 puntos</p></div><span class="tag">${data.materias.length} materias</span></div>${data.materias.map((m) => `<article class="grade-card"><div class="grade-head"><div><h3>${esc(m.materia)}</h3><small>${esc(m.docente)}</small></div><div class="grade-total"><strong>${m.promedio_anual ?? '—'}</strong><span>${m.cualitativo_anual || 'En proceso'}</span></div></div><div class="bimestre-grid">${m.bimestres.map((b) => `<div class="bimestre"><strong>B${b.bimestre}</strong><span>${b.promedio ?? '—'}</span>${b.promedio !== null ? chip(b.promedio, b.cualitativo) : '<em>Sin registro</em>'}</div>`).join('')}</div><div class="grade-foot"><span class="semaforo ${m.semaforo}">${m.aprobado === null ? 'Pendiente' : m.aprobado ? 'Rendimiento favorable' : `${m.puntos_necesarios} pts para aprobar`}</span><span>${m.porcentaje_registrado}% registrado</span></div></article>`).join('')}</section>`; }
function taskRow(task) { return `<div class="task-row"><span class="task-check ${task.estado === 'completada' ? 'done' : ''}">${task.estado === 'completada' ? '✓' : ''}</span><div><strong>${esc(task.titulo)}</strong><small>${esc(task.materia)} · ${tipoLabel[task.tipo] || task.tipo}</small></div><time>${task.fecha_entrega ? fecha(task.fecha_entrega) : 'Sin fecha'}</time></div>`; }
function familyTasks(data) { return `<section class="card"><div class="section-heading"><div><h2>Tareas y actividades</h2><p class="muted">Entrega archivos y consulta la revisión docente de ${esc(data.estudiante.nombres)}</p></div></div>${data.tareas.map((task) => `<div class="task-row interactive"><button class="task-check ${task.estado === 'completada' ? 'done' : ''}" data-action="mark-task" data-task="${task.tarea_id}" data-student="${data.estudiante.id}" data-state="${task.estado}">${task.estado === 'completada' ? '✓' : ''}</button><div><strong>${esc(task.titulo)}</strong><small>${esc(task.materia)} · ${esc(task.descripcion || '')}</small>${task.revision_comentario ? `<p class="task-feedback">Comentario docente: ${esc(task.revision_comentario)}</p>` : ''}<label class="evidence-upload"><span>${task.archivo_path ? 'Reemplazar evidencia' : 'Adjuntar evidencia'}</span><input type="file" data-upload-evidence="${task.entrega_id}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"></label></div><div class="task-meta"><span class="chip ${task.estado === 'completada' ? 'chip-sobresaliente' : 'chip-bueno'}">${task.estado === 'completada' ? (task.es_tardia ? 'Entregada tarde' : 'Entregada') : 'Pendiente'}</span>${task.estado === 'completada' ? `<span class="review-status ${task.revisada ? 'reviewed' : ''}">${task.revisada ? '✓ Revisada' : 'Pendiente de revisión'}</span>` : ''}<time>${task.fecha_entrega ? fecha(task.fecha_entrega) : 'Sin fecha'}</time></div></div>`).join('') || empty('No hay tareas asignadas')}</section>`; }
async function familyNotices() { const notices = await api('/comunicados'); return `<section class="card"><h2 class="card-titulo">Comunicados de la unidad educativa</h2>${notices.map((n) => `<article class="notice-card"><div class="notice-date">${fecha(n.fecha)}</div><h3>${esc(n.titulo)}</h3><p>${esc(n.mensaje)}</p><small>${esc(n.autor)}${n.curso ? ` · ${esc(n.curso)}` : ''}</small></article>`).join('') || empty('No hay comunicados')}</section>`; }
async function familyAttendance(data) { const result = await api(`/expediente/${data.estudiante.id}/asistencias`); return `<section class="card"><div class="section-heading"><div><h2>Asistencia</h2><p class="muted">Registro completo de ${esc(data.estudiante.nombres)}</p></div><span class="tag">${data.asistencia.porcentaje_asistencia ?? 0}% asistencia</span></div><div class="asistencia-resumen"><div class="asis-caja verde"><strong>${data.asistencia.presente}</strong><span>Presentes</span></div><div class="asis-caja amarillo"><strong>${data.asistencia.tarde}</strong><span>Tardanzas</span></div><div class="asis-caja rojo"><strong>${data.asistencia.ausente}</strong><span>Ausencias</span></div><div class="asis-caja azul"><strong>${data.asistencia.licencia}</strong><span>Licencias</span></div></div>${result.asistencias.map((a) => `<div class="asist-fila"><span class="asist-fecha">${fecha(a.fecha)}</span><span class="semaforo ${a.estado === 'presente' || a.estado === 'licencia' ? 'verde' : a.estado === 'tarde' ? 'amarillo' : 'rojo'}">${a.estado}</span></div>`).join('') || empty('No hay registros de asistencia')}</section>`; }

async function renderTeacher(view) {
  if (!state.data.asignaciones) state.data.asignaciones = await api('/docente/asignaciones');
  const asignaciones = state.data.asignaciones;
  if (view === 'tareas') return teacherTasks(asignaciones);
  if (view === 'comunicados') return familyNotices();
  if (view === 'clases') return teacherClasses(asignaciones);
  const total = asignaciones.reduce((sum, a) => sum + a.total_estudiantes, 0);
  return `<div class="page-title"><span class="eyebrow">Panel docente</span><h1>Buen día, ${esc(state.user.nombres)}</h1><p>Tu aula digital para acompañar cada proceso de aprendizaje.</p></div><div class="stats-grid"><div class="stat"><span class="stat-icon blue">${icon('grades')}</span><strong>${asignaciones.length}</strong><small>asignaciones</small></div><div class="stat"><span class="stat-icon green">${icon('users')}</span><strong>${total}</strong><small>estudiantes</small></div><div class="stat"><span class="stat-icon yellow">4</span><strong>4</strong><small>bimestres</small></div></div><section class="card"><div class="section-heading"><h2>Mis clases</h2><button class="btn btn-primary btn-sm" data-action="clases">Gestionar</button></div>${asignaciones.slice(0, 4).map(assignmentCard).join('') || empty('No tienes asignaciones activas')}</section>`;
}
function assignmentCard(a) { return `<button class="assignment" data-assignment="${a.id}"><span class="subject-mark">${esc(a.materia[0])}</span><span><strong>${esc(a.materia)}</strong><small>${esc(a.curso)} · ${a.total_estudiantes} estudiantes</small></span><span class="arrow">›</span></button>`; }
function teacherClasses(asignaciones) { return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Mis clases</h1><p>Selecciona una asignación para registrar y consultar notas.</p></div><section class="card">${asignaciones.map(assignmentCard).join('') || empty('No tienes asignaciones activas')}</section><div id="class-detail"></div>`; }
async function teacherTasks(asignaciones) {
  const tasks = await api('/tareas');
  state.data.tareas = tasks;
  return `<div class="page-title"><span class="eyebrow">Docencia</span><h1>Tareas publicadas</h1><p>Crea, actualiza, revisa entregas o retira actividades de tus cursos.</p></div><section class="card"><div class="section-heading"><h2>${tasks.length} actividades</h2><button class="btn btn-primary btn-sm" data-action="new-task">Nueva tarea</button></div>${tasks.map((t) => `<article class="managed-task"><div class="task-row"><span class="subject-mark small">${esc(t.materia[0])}</span><div><strong>${esc(t.titulo)}</strong><small>${esc(t.materia)} · ${esc(t.curso)} · ${tipoLabel[t.tipo] || t.tipo} · ${t.entregas.completada} entregadas / ${t.entregas.pendiente} pendientes</small></div><time>${t.fecha_entrega ? fecha(t.fecha_entrega) : 'Sin fecha'}</time></div><div class="managed-task-actions"><button class="btn btn-verde btn-sm" data-review-task="${t.id}">Revisar entregas</button><button class="btn btn-outline btn-sm" data-edit-task="${t.id}">Editar</button><button class="btn btn-rojo btn-sm" data-delete-task="${t.id}">Eliminar</button></div></article>`).join('') || empty('Aún no publicaste tareas')}</section>`;
}

async function renderAdmin(view) {
  if (view === 'usuarios') return adminUsers();
  if (view === 'estudiantes') return adminStudents();
  if (view === 'academico') return adminAcademic();
  if (view === 'cursos') return adminCourses();
  if (view === 'reportes') return adminReports();
  const [users, courses, subjects] = await Promise.all([api('/usuarios'), api('/cursos'), api('/materias')]);
  state.data.users = users; state.data.courses = courses; state.data.subjects = subjects;
  return `<div class="page-title"><span class="eyebrow">Dirección</span><h1>Vista general del sistema</h1><p>Gestión académica de la unidad educativa · ${new Date().getFullYear()}</p></div><div class="stats-grid"><div class="stat"><span class="stat-icon blue">${icon('users')}</span><strong>${users.length}</strong><small>usuarios</small></div><div class="stat"><span class="stat-icon green">${courses.length}</span><strong>${courses.reduce((n, c) => n + c.total_estudiantes, 0)}</strong><small>estudiantes</small></div><div class="stat"><span class="stat-icon yellow">${subjects.length}</span><strong>${subjects.length}</strong><small>materias activas</small></div></div><section class="card"><div class="section-heading"><h2>Acciones rápidas</h2></div><div class="quick-grid"><button class="quick-action" data-action="usuarios">${icon('users')}<strong>Usuarios</strong><small>Familias y docentes</small></button><button class="quick-action" data-action="cursos">${icon('calendar')}<strong>Cursos</strong><small>Capacidad y gestión</small></button><button class="quick-action" data-action="reportes">${icon('report')}<strong>Reportes</strong><small>Rendimiento académico</small></button></div></section>`;
}
async function adminUsers() { const users = state.data.users || await api('/usuarios'); state.data.users = users; return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Usuarios del sistema</h1><p>Administra el acceso de cada integrante de la comunidad educativa.</p></div><section class="card"><div class="section-heading"><h2>${users.length} cuentas registradas</h2><button class="btn btn-primary btn-sm" data-action="new-user">Nuevo usuario</button></div><div class="table-wrap"><table><thead><tr><th>Persona</th><th>Rol</th><th>Contacto</th><th>Estado</th></tr></thead><tbody>${users.map((u) => `<tr><td><strong>${esc(u.nombres)} ${esc(u.apellidos)}</strong><small>@${esc(u.username)}</small></td><td><span class="tag">${rolLabel[u.rol]}</span></td><td>${esc(u.email || 'Sin correo')}</td><td><span class="semaforo ${u.activo ? 'verde' : 'rojo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td></tr>`).join('')}</tbody></table></div></section>`; }
async function adminStudents() { const students = await api('/estudiantes'); const courses = state.data.courses || await api('/cursos'); state.data.courses = courses; return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Estudiantes matriculados</h1><p>Controla RUDE, curso y capacidad de la gestión activa.</p></div><section class="card"><div class="section-heading"><h2>${students.length} estudiantes</h2><div class="action-row"><button class="btn btn-outline btn-sm" data-action="export-students">Exportar CSV</button><button class="btn btn-primary btn-sm" data-action="new-student">Nuevo estudiante</button></div></div><div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>RUDE</th><th>Curso</th><th>Cuenta</th></tr></thead><tbody>${students.map((s) => `<tr><td><strong>${esc(s.apellidos)}, ${esc(s.nombres)}</strong><small>${s.fecha_nacimiento || 'Sin fecha de nacimiento'}</small></td><td>${esc(s.rude)}</td><td><span class="tag">${esc(s.curso)}</span></td><td>${s.username ? `@${esc(s.username)}` : '<span class="muted">Sin cuenta</span>'}</td></tr>`).join('')}</tbody></table></div></section>`; }
async function adminAcademic() { const [assignments, subjects, users, courses] = await Promise.all([api('/asignaciones'), api('/materias'), api('/usuarios?rol=docente'), api('/cursos')]); state.data.courses = courses; state.data.asignacionesAdmin = assignments; state.data.subjects = subjects; state.data.docentes = users; return `<div class="page-title"><span class="eyebrow">Administración académica</span><h1>Materias y asignaciones</h1><p>Define quién enseña cada materia en cada curso.</p></div><section class="card"><div class="section-heading"><h2>Asignaciones docentes</h2><button class="btn btn-primary btn-sm" data-action="new-assignment">Nueva asignación</button></div>${assignments.map((a) => `<div class="assignment"><span class="subject-mark">${esc(a.materia[0])}</span><span><strong>${esc(a.materia)}</strong><small>${esc(a.curso)} · ${esc(a.docente)}</small></span><span class="tag">${a.gestion_anio}</span></div>`).join('') || empty('No hay asignaciones')}</section><section class="card"><div class="section-heading"><h2>${subjects.length} materias configuradas</h2><button class="btn btn-outline btn-sm" data-action="new-subject">Agregar materia</button></div><div class="chip-list">${subjects.map((s) => `<span class="tag">${esc(s.nombre)}</span>`).join('')}</div></section>`; }
async function adminCourses() { const courses = state.data.courses || await api('/cursos'); state.data.courses = courses; return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Cursos y capacidad</h1><p>Nivel Secundaria · máximo 40 estudiantes por curso.</p></div><section class="card"><div class="section-heading"><h2>Gestión 2026</h2><button class="btn btn-primary btn-sm" data-action="new-course">Nuevo curso</button></div>${courses.map((c) => `<div class="course-row"><div><strong>${esc(c.nombre)}</strong><small>${c.total_estudiantes}/${c.capacidad_max} estudiantes · ${c.nivel}</small></div><div class="course-progress"><div><span style="width:${Math.min(100, c.total_estudiantes / c.capacidad_max * 100)}%"></span></div><small>${Math.round(c.total_estudiantes / c.capacidad_max * 100)}%</small></div></div>`).join('')}</section>`; }
async function adminReports() { const courses = state.data.courses || await api('/cursos'); state.data.courses = courses; const reports = await Promise.all(courses.map(async (course) => ({ course, risk: await api(`/reportes/riesgo?curso_id=${course.id}`), performance: await api(`/reportes/rendimiento?curso_id=${course.id}`) }))); return `<div class="page-title"><span class="eyebrow">Administración</span><h1>Reportes académicos</h1><p>Rendimiento, asistencia académica y estudiantes que requieren apoyo.</p></div>${reports.map(({ course, risk, performance }) => `<section class="card report-course"><div class="section-heading"><div><h2>${esc(course.nombre)}</h2><p class="muted">${risk.estudiantes.length} estudiantes en riesgo · bimestre ${risk.bimestre_actual || 'sin datos'}</p></div><span class="tag">${course.total_estudiantes} estudiantes</span></div>${risk.estudiantes.length ? risk.estudiantes.map((item) => `<div class="notice-line"><span class="puntito rojo"></span><div><strong>${esc(item.estudiante.nombres)} ${esc(item.estudiante.apellidos)}</strong><p>${item.materias_en_riesgo.map((m) => `${esc(m.materia)} (${m.promedio_anual ?? '—'})`).join(' · ')}</p></div></div>`).join('') : empty('No hay estudiantes en riesgo registrados')}<div class="report-subjects">${performance.materias.map((m) => `<div><span>${esc(m.materia)}</span><strong>${m.promedio_curso ?? '—'}</strong><small>${m.en_riesgo} en riesgo</small></div>`).join('')}</div></section>`).join('') || empty('No hay cursos configurados')}`; }

function bindActions() {
  document.querySelectorAll('[data-action]').forEach((element) => element.onclick = () => navigate(element.dataset.action));
  document.querySelectorAll('[data-assignment]').forEach((element) => element.onclick = () => showAssignment(Number(element.dataset.assignment)));
  document.querySelectorAll('[data-action="mark-task"]').forEach((element) => element.onclick = async (event) => {
    event.stopPropagation();
    const next = element.dataset.state === 'completada' ? 'pendiente' : 'completada';
    try { await api('/entregas/marcar', { method: 'PUT', body: JSON.stringify({ tarea_id: Number(element.dataset.task), estudiante_id: Number(element.dataset.student), estado: next }) }); state.data.expedientes = {}; await navigate('tareas'); } catch (error) { mostrarError(error); }
  });
  document.querySelectorAll('[data-upload-evidence]').forEach((input) => input.onchange = () => uploadEvidence(input));
  document.querySelector('[data-action="new-user"]')?.addEventListener('click', showUserForm);
  document.querySelector('[data-action="new-course"]')?.addEventListener('click', showCourseForm);
  document.querySelector('[data-action="new-task"]')?.addEventListener('click', showTaskForm);
  document.querySelector('[data-action="new-student"]')?.addEventListener('click', showStudentForm);
  document.querySelector('[data-action="new-assignment"]')?.addEventListener('click', showAssignmentForm);
  document.querySelector('[data-action="new-subject"]')?.addEventListener('click', showSubjectForm);
  document.querySelector('[data-action="export-students"]')?.addEventListener('click', exportStudents);
  document.querySelectorAll('[data-edit-task]').forEach((element) => element.onclick = () => {
    const task = state.data.tareas?.find((item) => item.id === Number(element.dataset.editTask));
    if (task) showTaskForm(task);
  });
  document.querySelectorAll('[data-delete-task]').forEach((element) => element.onclick = async () => {
    if (!window.confirm('¿Deseas eliminar esta tarea? También se eliminarán sus entregas asociadas.')) return;
    try { await api(`/tareas/${element.dataset.deleteTask}`, { method: 'DELETE' }); await navigate('tareas'); showToast('Tarea eliminada correctamente', 'ok'); } catch (error) { mostrarError(error); }
  });
  document.querySelectorAll('[data-review-task]').forEach((element) => element.onclick = () => showReviewForm(Number(element.dataset.reviewTask)));
  $('#child-select')?.addEventListener('change', (event) => { state.data.selectedChild = Number(event.target.value); state.data.expedientes = {}; navigate(state.view); });
}

function showModal(title, content) {
  $('#modal-root').innerHTML = `<div class="modal-fondo"><div class="modal"><div class="modal-titulo"><h2>${esc(title)}</h2><button class="modal-cerrar" id="close-modal" aria-label="Cerrar">×</button></div>${content}</div></div>`;
  $('#close-modal').onclick = () => { $('#modal-root').innerHTML = ''; };
}

function showUserForm() {
  showModal('Crear usuario', `<form id="user-form"><div class="form-grid"><div class="campo"><label>Usuario</label><input name="username" required></div><div class="campo"><label>Contraseña</label><input name="password" type="password" minlength="6" required></div><div class="campo"><label>Nombres</label><input name="nombres" required></div><div class="campo"><label>Apellidos</label><input name="apellidos" required></div><div class="campo"><label>Rol</label><select name="rol"><option value="tutor">Familia</option><option value="docente">Docente</option><option value="estudiante">Estudiante</option><option value="admin">Administración</option></select></div><div class="campo"><label>Correo</label><input name="email" type="email"></div></div><button class="btn btn-primary btn-block">Guardar usuario</button></form>`);
  $('#user-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/usuarios', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; state.data.users = null; await navigate('usuarios'); showToast('Usuario creado correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showCourseForm() {
  const gestionId = state.data.courses?.[0]?.gestion_id;
  showModal('Crear curso', `<form id="course-form"><div class="campo"><label>Nombre</label><input name="nombre" placeholder="2° Secundaria" required></div><div class="campo"><label>Capacidad máxima</label><input name="capacidad_max" type="number" min="1" max="40" value="40" required></div><input type="hidden" name="gestion_id" value="${gestionId || ''}"><button class="btn btn-primary btn-block">Guardar curso</button></form>`);
  $('#course-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/cursos', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; state.data.courses = null; await navigate('cursos'); showToast('Curso creado correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showStudentForm() {
  const options = (state.data.courses || []).map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${c.total_estudiantes}/${c.capacidad_max}</option>`).join('');
  showModal('Registrar estudiante', `<form id="student-form"><div class="form-grid"><div class="campo"><label>Nombres</label><input name="nombres" required></div><div class="campo"><label>Apellidos</label><input name="apellidos" required></div><div class="campo"><label>Fecha de nacimiento</label><input name="fecha_nacimiento" type="date"></div><div class="campo"><label>Curso</label><select name="curso_id" required>${options}</select></div><div class="campo campo-full"><label>RUDE (opcional)</label><input name="rude" placeholder="Se genera automáticamente si se omite"></div></div><button class="btn btn-primary btn-block">Registrar estudiante</button></form>`);
  $('#student-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/estudiantes', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate('estudiantes'); showToast('Estudiante registrado correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showAssignmentForm() {
  const docentes = (state.data.docentes || []).map((u) => `<option value="${u.id}">${esc(u.nombres)} ${esc(u.apellidos)}</option>`).join('');
  const materias = (state.data.subjects || []).map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');
  const cursos = (state.data.courses || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  showModal('Nueva asignación', `<form id="assignment-form"><div class="campo"><label>Docente</label><select name="docente_id" required>${docentes}</select></div><div class="campo"><label>Materia</label><select name="materia_id" required>${materias}</select></div><div class="campo"><label>Curso</label><select name="curso_id" required>${cursos}</select></div><button class="btn btn-primary btn-block">Guardar asignación</button></form>`);
  $('#assignment-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/asignaciones', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate('academico'); showToast('Asignación creada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

function showSubjectForm() {
  showModal('Agregar materia', `<form id="subject-form"><div class="campo"><label>Nombre</label><input name="nombre" required placeholder="Matemática avanzada"></div><div class="campo"><label>Descripción</label><textarea name="descripcion" rows="2"></textarea></div><button class="btn btn-primary btn-block">Guardar materia</button></form>`);
  $('#subject-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/materias', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); $('#modal-root').innerHTML = ''; await navigate('academico'); showToast('Materia creada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

async function exportStudents() {
  try { const response = await fetch(`${API}/estudiantes/export`, { headers: { Authorization: `Bearer ${state.token}` } }); if (!response.ok) throw new Error('No se pudo exportar la lista'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'estudiantes.csv'; link.click(); URL.revokeObjectURL(url); } catch (error) { mostrarError(error); }
}

function showTaskForm(task = null) {
  const options = (state.data.asignaciones || []).map((a) => `<option value="${a.id}">${esc(a.materia)} · ${esc(a.curso)}</option>`).join('');
  const titulo = task ? 'Editar tarea' : 'Publicar tarea';
  const action = task ? `/tareas/${task.id}` : '/tareas';
  const method = task ? 'PUT' : 'POST';
  showModal(titulo, `<form id="task-form"><div class="campo"><label>Clase</label><select name="asignacion_id" ${task ? 'disabled' : ''} required>${options}</select></div><div class="campo"><label>Título</label><input name="titulo" value="${esc(task?.titulo || '')}" required></div><div class="campo"><label>Descripción</label><textarea name="descripcion" rows="3">${esc(task?.descripcion || '')}</textarea></div><div class="form-grid"><div class="campo"><label>Tipo</label><select name="tipo"><option value="tarea" ${task?.tipo === 'tarea' ? 'selected' : ''}>Tarea</option><option value="actividad" ${task?.tipo === 'actividad' ? 'selected' : ''}>Actividad</option><option value="trabajo_practico" ${task?.tipo === 'trabajo_practico' ? 'selected' : ''}>Trabajo práctico</option><option value="examen" ${task?.tipo === 'examen' ? 'selected' : ''}>Examen</option></select></div><div class="campo"><label>Fecha de entrega</label><input name="fecha_entrega" type="date" value="${esc(task?.fecha_entrega || '')}"></div></div><div class="campo"><label>Material de apoyo</label><input name="archivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"><small class="ayuda">Máximo 10 MB.</small></div><button class="btn btn-primary btn-block">${task ? 'Guardar cambios' : 'Publicar tarea'}</button></form>`);
  if (task) $('#task-form [name="asignacion_id"]').value = task.asignacion_id;
  $('#task-form').onsubmit = async (event) => { event.preventDefault(); try { await api(action, { method, body: new FormData(event.currentTarget) }); $('#modal-root').innerHTML = ''; await navigate('tareas'); showToast(task ? 'Tarea actualizada correctamente' : 'Tarea publicada correctamente', 'ok'); } catch (error) { mostrarError(error); } };
}

async function showReviewForm(taskId) {
  try {
    const result = await api(`/entregas?tarea_id=${taskId}`);
    showModal(`Revisar: ${result.tarea.titulo}`, `<p class="muted">Las entregas pendientes aún deben ser completadas por el estudiante o su tutor.</p><div class="review-list">${result.entregas.length ? result.entregas.map((entrega) => `<article class="review-item ${entrega.estado !== 'completada' ? 'review-pending' : ''}"><div><strong>${esc(entrega.apellidos)}, ${esc(entrega.nombres)}</strong><small>${entrega.estado !== 'completada' ? 'Pendiente de entrega' : entrega.revisada ? `Revisada el ${fecha(entrega.revision_fecha)}` : 'Entregada · pendiente de revisión'}</small></div>${entrega.estado === 'completada' ? `${entrega.archivo_path ? `<button class="btn btn-outline btn-sm" data-download-evidence="${entrega.id}">Descargar evidencia</button>` : '<small>Sin archivo adjunto</small>'}<textarea data-review-comment="${entrega.id}" rows="2" placeholder="Comentario para el estudiante">${esc(entrega.revision_comentario || '')}</textarea><button class="btn ${entrega.revisada ? 'btn-gris' : 'btn-verde'} btn-sm" data-review-delivery="${entrega.id}">${entrega.revisada ? 'Actualizar revisión' : 'Marcar revisada'}</button>` : '<span class="tag">Esperando entrega</span>'}</article>`).join('') : empty('No hay estudiantes asignados')}</div>`);
    $('#modal-root').querySelectorAll('[data-review-delivery]').forEach((button) => button.onclick = async () => {
      const comentario = $('#modal-root').querySelector(`[data-review-comment="${button.dataset.reviewDelivery}"]`).value;
      try { await api(`/entregas/${button.dataset.reviewDelivery}/revisar`, { method: 'PUT', body: JSON.stringify({ comentario }) }); $('#modal-root').innerHTML = ''; await navigate('tareas'); showToast('Entrega revisada y estudiante notificado', 'ok'); } catch (error) { mostrarError(error); }
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
  const root = $('#class-detail');
  if (!root) return;
  root.innerHTML = loading('Cargando estudiantes...');
  try {
    const renderGrades = async (bimestre) => {
      const data = await api(`/docente/estudiantes?asignacion_id=${id}&bimestre=${bimestre}`);
      root.innerHTML = `<section class="card"><div class="section-heading"><div><h2>${esc(data.asignacion.materia)}</h2><p class="muted">${esc(data.asignacion.curso)}</p></div><div class="grade-tools"><select id="grade-term"><option value="1" ${bimestre === 1 ? 'selected' : ''}>Bimestre 1</option><option value="2" ${bimestre === 2 ? 'selected' : ''}>Bimestre 2</option><option value="3" ${bimestre === 3 ? 'selected' : ''}>Bimestre 3</option><option value="4" ${bimestre === 4 ? 'selected' : ''}>Bimestre 4</option></select><button class="btn btn-verde btn-sm" data-action="save-note">Guardar notas</button></div></div><div class="table-wrap"><table class="grades-table"><thead><tr><th>Estudiante</th><th>Ser<br><small>/20</small></th><th>Saber<br><small>/40</small></th><th>Hacer<br><small>/30</small></th><th>Decidir<br><small>/10</small></th><th>Total</th></tr></thead><tbody>${data.estudiantes.map((e) => { const n = e.nota_bimestre || {}; return `<tr data-student="${e.id}"><td><strong>${esc(e.apellidos)}, ${esc(e.nombres)}</strong><small>${esc(e.rude)}</small></td>${[['ser', 20], ['saber', 40], ['hacer', 30], ['decidir', 10]].map(([key, max]) => `<td><input class="grade-input" data-grade="${key}" type="number" min="0" max="${max}" step="0.5" value="${n[key] ?? ''}"></td>`).join('')}<td><strong class="row-total">${n.promedio ?? '—'}</strong></td></tr>`; }).join('')}</tbody></table></div></section>`;
      root.querySelector('#grade-term').onchange = (event) => renderGrades(Number(event.target.value));
      root.querySelector('[data-action="save-note"]').onclick = async () => { for (const row of root.querySelectorAll('tbody tr')) { const inputs = [...row.querySelectorAll('[data-grade]')]; if (inputs.every((input) => input.value === '')) continue; const values = Object.fromEntries(inputs.map((input) => [input.dataset.grade, Number(input.value || 0)])); await api('/notas', { method: 'PUT', body: JSON.stringify({ estudiante_id: Number(row.dataset.student), materia_id: data.asignacion.materia_id, bimestre, ...values }) }); } showToast(`Notas del bimestre ${bimestre} guardadas`, 'ok'); };
    };
    await renderGrades(2);
  } catch (error) { root.innerHTML = `<div class="card"><p>${esc(error.message)}</p></div>`; }
}

async function iniciarApp() {
  try { state.data = {}; state.view = 'inicio'; state.user = await api('/auth/me'); header(); tabs(); await navigate('inicio'); bindActions(); } catch (_) { clearSession(); renderLogin(); }
}

document.addEventListener('click', (event) => { if (event.target.matches('[data-action]')) { setTimeout(bindActions, 0); } });

if (state.token) iniciarApp(); else renderLogin();
