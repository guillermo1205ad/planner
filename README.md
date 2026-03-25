# Planner (GitHub Pages Ready)

Planificador profesional de tres niveles:

- Mensual
- Semanal
- Diario

Modo actual: **100% frontend**, compatible con GitHub Pages.

## Qué incluye

- Gestión de tareas por día con secciones:
  - Tareas para hoy
  - No olvidar
  - Tareas urgentes
  - Notas
- Persistencia local en navegador (`localStorage`)
- Integración Google Calendar desde frontend (OAuth en navegador + sincronización de tareas)
- Integración Telegram en modo compartir (abre Telegram con texto prellenado)

## Limitación importante

Sin backend no existe webhook ni bot de Telegram automático (`/add`, `/remove`, `/list` en tiempo real desde servidor).

## Desarrollo local

```bash
npm install
npm run dev
```

## Configurar Google Calendar

1. Crea credenciales OAuth Web en Google Cloud.
2. En la app, pega tu `Google Client ID`.
3. Deja `Calendar ID` en `primary` (o usa otro si lo necesitas).
4. Pulsa `Conectar Google`.
5. En vista diaria usa `Sincronizar Google` o activa `Sincronizar Google al guardar`.

En Google Cloud agrega como **Authorized JavaScript origin**:

- `http://localhost:5173` (desarrollo)
- `https://guillermo1205ad.github.io` (producción Pages)

## Telegram en Pages

- Usa `Mensaje de prueba` o `Compartir resumen`.
- La app abre Telegram con el mensaje listo para enviar.

## Deploy a GitHub Pages

Este repositorio incluye workflow de GitHub Actions para Pages.

1. Sube el proyecto a la rama `main`.
2. En GitHub, ve a `Settings > Pages`.
3. En `Build and deployment`, selecciona `GitHub Actions`.
4. Cada push a `main` desplegará automáticamente.

La URL final será:

- `https://guillermo1205ad.github.io/planner/`
