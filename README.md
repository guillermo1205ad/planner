# Planner (GitHub Pages)

Planificador profesional de tres niveles:

- Mensual: listado de tareas del mes.
- Semanal: listado de tareas de la semana.
- Diario: gestión detallada por secciones.

## Qué incluye

- Secciones diarias:
  - Tareas para hoy
  - No olvidar
  - Tareas urgentes
  - Notas
- Persistencia local en navegador (`localStorage`)
- Conexión y sincronización con Google Calendar (frontend)
- Deploy automático a GitHub Pages con GitHub Actions

## Configuración `.env`

Usa solo estas variables:

```env
VITE_GOOGLE_CLIENT_ID=tu_client_id.apps.googleusercontent.com
VITE_GOOGLE_CALENDAR_ID=primary
```

## Desarrollo local

```bash
npm install
npm run dev
```

## Google Cloud

En tu OAuth client agrega como **Authorized JavaScript origins**:

- `http://localhost:5173`
- `https://guillermo1205ad.github.io`

## Deploy a GitHub Pages

1. Push a `main`.
2. En GitHub: `Settings > Pages`.
3. En `Build and deployment`, selecciona `GitHub Actions`.
4. Cada push a `main` desplegará automáticamente.

URL esperada:

- `https://guillermo1205ad.github.io/planner/`
