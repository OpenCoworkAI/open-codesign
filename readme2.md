## 1. Visión rápida del repo

Monorepo gestionado con __pnpm + Turborepo__:

- `apps/desktop`: app Electron (main + renderer React 19 + Vite 6 + Tailwind v4).
- `packages/core`: orquestación del agente (cómo del prompt se llega a los artefactos).
- `packages/runtime`: sandbox de preview (iframe `srcdoc`, transformación de App.jsx → HTML).
- `packages/ui`: librería de componentes/tokens de diseño (Radix + shadcn-style, Tailwind tokens).
- `packages/providers`: integración con `pi-ai` (Anthropic, OpenAI, Gemini, Ollama, etc).
- `packages/artifacts`, `packages/exporters`, `packages/templates`, `packages/shared`: tipos, esquemas y lógica común (export PDF/PPTX/ZIP/Markdown, demos, etc).
- `website`: docs públicas en VitePress (no hace falta para arrancar la app de escritorio).

Todo el código se construye/ejecuta con Node 22 LTS (ver `.nvmrc`) y se instala con `pnpm`.

---

## 2. Requisitos previos en la máquina

1. __Node.js 22 LTS__

   - En macOS/Linux: usar `nvm` o similar.
   - En Windows (tu caso): asegúrate de que el `node` activo es 22.x (puedes tenerlo vía `nvm-windows`).

2. __pnpm__\
   El repo asume Corepack o pnpm instalado globalmente. Si no lo tienes:

   ```bash
   npm install -g pnpm
   ```

   (O habilita Corepack: `corepack enable` y deja que use la versión fijada).

3. __Herramientas opcionales pero recomendadas__

   - Git
   - Un proveedor LLM (Anthropic/OpenAI/Google/OpenRouter, etc.) o __Ollama__ local si quieres probar sin keys remotas.

---

## 3. Instalación de dependencias

En la raíz del repo (`c:\Users\jalcalap\vscode\Codesign`):

```bash
pnpm install
```

Esto instalará:

- Dependencias de la app Electron (`apps/desktop`).
- Paquetes compartidos (`packages/*`).
- Web de documentación (`website`, opcional para tu objetivo).

__Importante__: no usar `npm install` ni `yarn`.

---

## 4. Arrancar la app en modo desarrollo

Desde la raíz:

```bash
pnpm dev
```

Según `CLAUDE.md`, este comando:

- Levanta __Electron__ (main process) para la app de escritorio.
- Levanta __Vite__ para el renderer React (ventanas de la UI).

En un flujo normal verás:

- Una ventana de Electron con la UI de Open CoDesign.
- Consola con logs de Vite (hot reload) y del proceso main de Electron.

Si usas VS Code, lo típico:

- Terminal 1: `pnpm dev`.
- No cierres esa terminal; es tu servidor de desarrollo.

---

## 5. Primer uso dentro de la app

Cuando abra la app:

1. __Configurar proveedor de modelos__\
   Se abrirá la pantalla de Settings:

   - Opción 1 – API key:
     - Pega una key de Anthropic (`sk-ant-...`), OpenAI (`sk-...`), Gemini, OpenRouter, etc.
   - Opción 2 – ChatGPT:
     - Haz login con tu suscripción ChatGPT Plus/Pro/Team para usar modelos Codex sin key explícita.
   - Opción 3 – Local/Ollama:
     - Si tienes Ollama corriendo, selecciónalo como proveedor.

   Las credenciales se guardan en un TOML local (`~/.config/open-codesign/config.toml` o equivalente en Windows) y no se envían a ningún backend de este proyecto.

2. __Crear tu primer diseño__

   - Desde el hub selecciona una de las demos (landing, dashboard, pitch, etc.) o escribe tu prompt.
   - El agente empezará a generar archivos de diseño (`App.jsx`, CSS, etc.) en un workspace local y los verás en el panel de Files + preview en el iframe.

---

## 6. Cómo está montado internamente (nivel necesario para debug)

### 6.1. `apps/desktop`

- Contiene:

  - __Main process__ de Electron (crea la BrowserWindow, gestiona menús, IPC).
  - __Preload__ (exposición de APIs seguras al renderer).
  - __Renderer React__ (UI principal de la app).

Puntos típicos de debug:

- Arranques / errores de ventana Electron:

  - Revisa `apps/desktop/src/main/*`.
  - No se permite `console.*` en algunos paquetes core, pero en main suele haber logging centralizado (via logger del proyecto).

- UI / navegación / estado:

  - `apps/desktop/src/renderer/*` (React + Zustand + Tailwind).
  - Usa los componentes y tokens de `packages/ui`.

### 6.2. `packages/core`

- Orquesta el __agent loop__:

  - Cómo se interpretan los prompts.
  - Cómo se gestionan sesiones (cada diseño es una pi session con JSONL + workspace).
  - Cómo se invocan los tools (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, y los específicos de diseño `ask`, `scaffold`, `skill`, `preview`, `gen_image`, `tweaks`, `todos`, `done`).

Si algo falla en la generación, casi siempre el bug observable estará:

- En la UI (renderer) mostrando mal el estado de la sesión.
- O en `packages/core` manejando mal el protocolo de run / tools.

### 6.3. `packages/runtime`

- Implementa el sandbox (preview):

  - Convierte el código fuente del workspace (`App.jsx`, CSS, etc.) en un documento HTML renderizable en un iframe de Electron.
  - Es donde se gestionan breakages de preview (errores de React/Babel, assets, etc.).

Si la vista previa “peta” pero los archivos están bien, revisa aquí.

### 6.4. `packages/providers`

- Adaptadores para `@mariozechner/pi-ai`:

  - Configuración de modelos, catálogos, mapeo de errores.
  - Soporte para Anthropic, OpenAI, Gemini, OpenRouter, SiliconFlow, DeepSeek, Ollama, etc.

Si el problema es “no puedo llamar al modelo X” o “los errores de provider no se interpretan bien”, se mira aquí.

---

## 7. Comandos clave para desarrollo y depuración

Desde la raíz del repo:

```bash
# Lint (Biome)
pnpm lint

# Lint con autofix (formato y reglas autofijables)
pnpm lint:fix

# TypeScript typecheck en todo el workspace
pnpm typecheck

# Tests unitarios (Vitest)
pnpm test

# Tests E2E (Playwright)
pnpm test:e2e

# Build de producción (instaladores, etc.)
pnpm build
```

Uso típico durante desarrollo:

- Terminal 1: `pnpm dev` (app corriendo).
- Terminal 2: `pnpm test --watch` para la parte del paquete que estás tocando.
- Antes de abrir PR / subir cambios internos:
  - `pnpm lint && pnpm typecheck && pnpm test`.

---

## 8. Debug de la app en el día a día

### 8.1. Depurar la UI (renderer React)

1. Arranca `pnpm dev`.

2. Abre las __DevTools__ de la ventana de Electron:
   - Normalmente `Ctrl+Shift+I` (Windows).

3. Ahí puedes:

   - Ver errores JS.
   - Inspeccionar el DOM y estilos (Tailwind classes).
   - Ver llamadas de red (si las hay hacia proveedores, aunque normalmente la llamada LLM pasa por el proceso que gestione `pi-ai`).

Para entender qué pasa cuando generas:

- Observa el panel de agente en la app (todos, herramientas ejecutadas).
- Busca componentes de UI relacionados en `apps/desktop/src/renderer/` y en `packages/ui`.

### 8.2. Depurar el proceso main de Electron

Opciones:

- Lanzar `pnpm dev` con una configuración de `NODE_OPTIONS=--inspect` (si está soportado por los scripts).
- O usar la plantilla de launch de VS Code para “Attach to Electron” si el repo la incluye (si no, puedes crearla tú apuntando al puerto de debug del main process).

Qué mirar:

- Gestión de ventanas (crashes al abrir/cerrar).
- IPC/bridge entre main y renderer.
- Rutas de almacenamiento local (workspaces, config).

### 8.3. Depurar generación / agent loop

- Si ves que el agente se queda colgado o da errores al usar tools:

  - Mira en `packages/core` los tests (`*.test.ts`) para la parte relevante (agent-session, run-protocol, etc.).
  - Ejecuta `pnpm test` filtrando por ese paquete (normalmente `pnpm test --filter @open-codesign/core` o similar, según esté configurado).

---

## 9. Flujo recomendado para un dev que acaba de entrar

1. __Instala entorno__:

   - Node 22
   - pnpm

2. __Instala deps__ en la raíz:

   ```bash
   pnpm install
   ```

3. __Familiarízate con el proyecto__ (5–10 minutos):

   - Lee `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`.
   - Echa un vistazo rápido a la estructura `apps/` y `packages/`.

4. __Arranca la app__:

   ```bash
   pnpm dev
   ```

5. __Configura un proveedor LLM__ desde Settings en la app.

6. __Prueba un par de prompts__ y mira:

   - Panel de agent (todos, tools).
   - Panel de Files (arquitectura de los artefactos).

7. __Configura tus herramientas de debug__:

   - DevTools de Electron (renderer).
   - Si lo necesitas, configuración de VS Code para adjuntar al proceso main.

8. __Para tocar código__:

   - Haz cambios pequeños, ejecuta `pnpm lint && pnpm typecheck && pnpm test`.
   - Usa los tests y tipos como guía para entender los contratos entre paquetes.

---

## 10. Dónde mirar según el tipo de problema

- __La app no arranca con `pnpm dev`__

  - Revisa:

    - Versión de Node (`node -v` → 22.x).
    - Que `pnpm install` haya terminado bien.
    - Logs de la terminal (puede ser un fallo de build de algún paquete).
    - Scripts y config en `apps/desktop/electron.vite.config.ts`.

- __Pantalla en blanco o error en el UI__

  - Abre DevTools → Console.
  - Localiza el componente en `apps/desktop/src/renderer`.
  - Comprueba imports desde `packages/ui`/`packages/core`.

- __Preview rompe o no se actualiza__

  - Error típico de runtime/transformación:

    - `packages/runtime`
    - O errores de React/Babel en el sandbox (ver logs en el panel de preview/DevTools).

- __Errores con modelos/proveedores (Auth, 4xx, 5xx)__

  - Configuración de providers en `packages/providers`.
  - Logs / panel de diagnóstico de conexión en la UI (Settings → tab de modelos/diagnósticos).
