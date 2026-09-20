# Seguimiento Académico

Sistema web de seguimiento académico para la Unidad Educativa **Jesús María Fe y Alegría**, El Alto, Bolivia.

Permite administrar usuarios, cursos, estudiantes, asignaciones, tareas, calificaciones, asistencia, observaciones, comunicados y reportes desde una interfaz web.

## Requisitos

- Node.js `22.5` o superior.
- npm.

La aplicación utiliza Node.js, Express, SQLite mediante `node:sqlite` y una interfaz web sin framework frontend.

## Instalación

Desde la carpeta del proyecto:

```powershell
npm install
```

## Iniciar la aplicación

```powershell
npm start
```

Después abre:

```text
http://localhost:3000
```

Para desarrollo, con reinicio automático al modificar archivos:

```powershell
npm run dev
```

## Datos y usuarios

La base de datos local se guarda en:

```text
data/app.db
```

Los estudiantes son registros académicos y no tienen cuentas de acceso. Los usuarios del sistema corresponden a roles como:

- Administrador.
- Docente.
- Tutor o padre de familia.
- Personal de asistencia.

Los datos de `data/`, `backups/` y `uploads/` no se suben a Git porque pueden contener información personal y archivos de la comunidad educativa.

## Importar listas por curso

El importador principal carga archivos `.xlsx` desde la carpeta configurada en `XLSX_DIR`. Si no se configura, utiliza esta ruta predeterminada:

```text
C:\Users\BIMAR\Desktop\UAB 2.2026\PRACTICA EMPRESARIAL\SECUNDARIA
```

Cada archivo debe permitir identificar el grado y la sección `A` o `B` en su nombre, por ejemplo:

```text
PRIMERO A.xlsx
SEGUNDO B.xlsx
```

Para importar:

```powershell
node importar_listas_jm.js
```

También se puede indicar otra carpeta:

```powershell
$env:XLSX_DIR = 'C:\ruta\a\las\listas'
node importar_listas_jm.js
```

La importación crea o actualiza estudiantes y los ubica en cursos separados por grado y sección. No crea usuarios para estudiantes.

## Respaldos

Crear una copia de la base actual:

```powershell
npm run backup
```

El archivo se guarda en `backups/`.

Para restaurar los datos en una instalación nueva:

1. Detén el servidor.
2. Copia el respaldo elegido a `data/app.db`.
3. Ejecuta `npm install`.
4. Inicia con `npm start`.

No ejecutes `npm run seed` en una instalación con datos reales. Ese comando borra la información existente y carga datos de demostración.

## Scripts disponibles

| Comando | Uso |
|---|---|
| `npm start` | Inicia el servidor. |
| `npm run dev` | Inicia el servidor con modo watch. |
| `npm run backup` | Crea un respaldo de `data/app.db`. |
| `npm run seed` | Reinicia la base con datos de demostración. Usar solo en pruebas. |
| `node importar_listas_jm.js` | Importa listas XLSX por curso. |

## Estructura principal

```text
server.js              Servidor Express y rutas principales
src/db.js              Esquema y conexión SQLite
src/routes/            Rutas de autenticación y módulos del sistema
public/                Interfaz web
importar_listas_jm.js  Importación de listas XLSX
backups/               Copias locales de la base de datos
data/                  Base SQLite local
uploads/                Archivos adjuntos locales
docs/api.md            Documentación de la API REST
```

## API

La documentación de endpoints se encuentra en [docs/api.md](docs/api.md).

Todas las rutas protegidas utilizan un token JWT obtenido mediante `POST /api/auth/login`.
