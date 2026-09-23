import type { ExampleContent } from '../index';

export const esExamples: Record<string, ExampleContent> = {
  daymark: {
    title: 'Daymark: del brief a las tareas',
    description:
      'Cinco archivos editables: brief, tareas, proyectos, logotipo original y tokens. Conecta Hoy, proyectos y edición de tareas.',
    prompt:
      'Lee product-brief.md, tasks.json, projects.json, logo.svg y DESIGN.md del espacio de trabajo. Crea Daymark en App.jsx: Hoy, proyectos, detalle y editor de tareas conectados, con estado compartido y contadores derivados. Reutiliza el logotipo y los tokens locales. Implementa añadir, editar, completar, volver, validación y estados vacíos según el brief. Conserva los archivos originales y actualiza DESIGN.md. Solo datos simulados: sin backend, autenticación, pagos, red ni instalaciones. Interfaz accesible y adaptable a móvil y escritorio. Previsualiza y recorre el flujo antes de terminar; no presentes comportamientos no probados como verificados.',
  },
  'common-ground': {
    title: 'Common Ground: reservar talleres',
    description:
      'Un brief, un CSV y arte original guían descubrimiento, detalles, reserva y confirmación. Reservas simuladas, no reales.',
    prompt:
      'Lee product-brief.md, schedule.csv, poster.svg, logo.svg y DESIGN.md del espacio de trabajo. Crea Common Ground en App.jsx con descubrimiento, detalles, reserva y confirmación conectados. Reutiliza el arte local; usa el CSV para sesiones, precios y plazas. Comparte selección y formulario; valida datos y capacidad, evita reservas duplicadas y restaura plazas al cancelar. Respeta el brief, navegación atrás y estados vacíos. Indica reserva simulada sin cobro. Conserva archivos y actualiza DESIGN.md. Sin backend, autenticación, pagos, red ni instalaciones. Diseño accesible y adaptable. Previsualiza y prueba el flujo; no afirmes verificaciones que no realizaste.',
  },
  trailhead: {
    title: 'Trailhead: del boceto al itinerario',
    description:
      'Boceto SVG original, brief anotado y viajes ficticios para un editor conectado. Las notas no requieren un modelo con visión.',
    prompt:
      'Lee sketch-reference.svg, product-brief.md y trips.json del espacio de trabajo. El SVG es un boceto original de baja fidelidad, no una foto ni una interfaz terminada. Lee el texto SVG y las anotaciones aunque no puedas ver imágenes. Transforma sus tres marcos en viajes, itinerario y editor de paradas conectados en App.jsx. Añadir, editar, ordenar y eliminar deben actualizar un único estado y los totales en todas las pantallas. Incluye validación, estados vacíos y navegación atrás según el brief. Conserva los archivos y crea DESIGN.md. Solo datos simulados; sin mapas reales, reservas, autenticación, red ni instalaciones. Hazlo adaptable y accesible; previsualiza y recorre el flujo antes de finalizar, sin afirmar resultados no probados.',
  },
  'cosmic-animation': {
    title: 'Animación a escala cósmica',
    description:
      'Encabezado animado con anillos orbitando, un sol brillante y un campo de estrellas disperso.',
  },
  'organic-loaders': {
    title: 'Cargadores orgánicos',
    description: 'Seis indicadores de carga dibujados a mano en pasteles suaves — CSS / SVG puro.',
  },
  'landing-page': {
    title: 'Página de aterrizaje de marketing',
    description:
      'Página editorial para una herramienta de productividad: encabezado, características, vista previa de precios.',
  },
  'case-study': {
    title: 'Caso de estudio de cliente',
    description:
      'Caso de estudio de una página listo para imprimir con métricas principales y cita destacada del CFO.',
  },
  dashboard: {
    title: 'Dashboard de ingresos',
    description:
      'Dashboard de analíticas en tema oscuro: tendencia de MRR, pipeline, cuentas principales, pronóstico.',
  },
  'pitch-slide': {
    title: 'Diapositiva de presentación — Por qué ahora',
    description:
      'Una sola diapositiva 16:9 con subtítulo, declaración de impacto, viñetas de apoyo y minigráfico.',
  },
  email: {
    title: 'Correo de bienvenida',
    description:
      'Correo transaccional de bienvenida basado en tablas, 600px, con tres pasos de bienvenida.',
  },
  'mobile-app': {
    title: 'Pantalla móvil de seguimiento de hábitos',
    description:
      'Pantalla de inicio en marco de teléfono con contador de racha, lista de hábitos y barra de pestañas inferior.',
  },
  'pricing-page': {
    title: 'Página de precios SaaS',
    description:
      'Tres tarjetas de planes con tabla de comparación de características y selector de facturación.',
  },
  'blog-article': {
    title: 'Artículo de blog editorial',
    description:
      'Artículo de lectura larga con barra lateral de índice, citas destacadas y cuadrícula de artículos relacionados.',
  },
  'event-calendar': {
    title: 'Calendario de equipo',
    description:
      'Cuadrícula de calendario mensual con eventos de varios días y barra lateral de próximos eventos.',
  },
  'chat-interface': {
    title: 'Pantalla de mensajes de chat',
    description:
      'Interfaz de usuario móvil con burbujas de mensaje, indicador de escritura y mensajes con imagen.',
  },
  'portfolio-gallery': {
    title: 'Galería de portafolio de fotografía',
    description:
      'Cuadrícula masonry oscura con superposiciones al pasar el cursor, filtros de categoría y vista lightbox.',
  },
  'receipt-invoice': {
    title: 'Factura para imprimir',
    description:
      'Factura A4 limpia con tabla de artículos, desglose de impuestos y términos de pago.',
  },
  'settings-panel': {
    title: 'Página de configuración de la aplicación',
    description:
      'Configuración con navegación lateral, formularios, interruptores y sección de acciones críticas.',
  },
  'auth-signin': {
    title: 'Pantalla de inicio de sesión',
    description:
      'Tarjeta centrada sobre fondo estrellado con correo electrónico, inicios de sesión sociales y enlace de registro.',
  },
  'kanban-board': {
    title: 'Tablero Kanban de proyecto',
    description:
      'Tablero de tres columnas con tarjetas de tareas, avatares de responsables y etiquetas de prioridad.',
  },
  'ai-product-hero': {
    title: 'Encabezado de producto de IA',
    description:
      'Encabezado con degradado, orbe brillante, título con cursor parpadeante y dos CTA.',
  },
  'weather-card': {
    title: 'Tarjeta de clima móvil',
    description: 'Pantalla de clima estilo glassmorphism con tira horaria y resumen de siete días.',
  },
  'timeline-changelog': {
    title: 'Línea de tiempo de cambios (changelog)',
    description:
      'Línea de tiempo vertical de versiones con puntos codificados por colores y categorías filtrables.',
  },
  'stats-counter': {
    title: 'Franja de contadores animada',
    description: 'Trío de tarjetas con contadores animados, detalles en neón y fondos brillantes.',
  },
};
