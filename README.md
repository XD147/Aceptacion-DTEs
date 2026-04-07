# 🚀 DTE-Web: Sistema de Aceptación Masiva SII

DTE-Web es una aplicación moderna basada en **Next.js 16 (App Router)** diseñada para automatizar el proceso de aceptación de Documentos Tributarios Electrónicos (DTEs) en el Servicio de Impuestos Internos (SII) de Chile. Esta herramienta permite procesar múltiples contribuyentes de manera secuencial, garantizando la correcta recepción de facturas y otros documentos.

## 🌟 Características Principales

- **Arquitectura Stateless**: Diseño "Process-and-Forget". No requiere base de datos persistente; las credenciales y el procesamiento se manejan en memoria.
- **Procesamiento por Lotes**: Carga masiva de contribuyentes mediante archivos JSON (`ArchivoBase_*.json`).
- **Pipeline en Tiempo Real**: Visualización granular del estado de cada contribuyente (autenticación, consulta de resumen, obtención de detalles y aceptación).
- **Control Inteligente de Rate Limiting**: Implementación de algoritmos de *backoff* exponencial para manejar los límites de peticiones (429) del SII.
- **Reportería Avanzada**: Generación automática de reportes en formato Excel (XLSX) con los resultados del proceso.
- **Diseño Premium**: Interfaz fluida construida con **Tailwind CSS 4** y **Lucide Icons**, optimizada para la experiencia del usuario.

## 🛠️ Stack Tecnológico

Basado en las directrices de **Agentic Frontend Architecture**:

- **Core**: Next.js 16 (React 19)
- **Estado Asíncrono**: React Query (TanStack Query)
- **Estado UI**: Zustand
- **Estilos**: Tailwind CSS 4 + Lucide React
- **Validación**: Zod + React Hook Form
- **Scraping/Integración**: Cheerio (para extracción de tokens y procesamiento HTML)
- **Formatos**: XLSX para exportación de datos

## 📂 Estructura del Proyecto

El proyecto sigue una arquitectura orientada a dominios (Feature-based):

```text
src/
├── app/                    # App Router - Rutas y Layouts
├── components/            # UI Components desacoplados (base y shared)
├── features/              # [CORE] Lógica por dominio de negocio
│   └── dte-pipeline/     # Gestión del proceso de aceptación masiva
│       ├── api/          # Server Actions y llamadas HTTP
│       ├── components/    # UI específica del pipeline
│       └── services/     # Servicio SiiClient (Lógica de bajo nivel)
├── lib/                   # Configuraciones globales y utilidades
└── styles/                # Tailwind config y estilos globales
```

## 🚀 Comenzando

### Requisitos Previos

- Node.js 20+
- npm o pnpm

### Instalación

1. Clona el repositorio.
2. Instala las dependencias:
   ```bash
   npm install
   ```

### Ejecución Local

Inicia el servidor de desarrollo:
```bash
npm run dev
```
La aplicación estará disponible en `http://localhost:3000`.

### Uso
1. Prepara tu archivo de entrada (formato JSON compatible con el sistema legacy).
2. Arrastra el archivo a la zona de "Pipeline DTEs".
3. Presiona **"Iniciar Proceso"** y observa el progreso en tiempo real.
4. Al finalizar, descarga el reporte final en Excel.

## ☁️ Despliegue en Vercel

La aplicación está optimizada para ejecutarse en entornos *serverless*. 

1. Conecta el repositorio a una cuenta de Vercel.
2. Los entornos de desarrollo y producción detectarán automáticamente la configuración de Next.js.
3. El despliegue es completamente independiente de bases de datos externas.

---

> [!NOTE]
> Este proyecto es una migración moderna de un sistema legacy basado en VB.NET, optimizado para ser rápido, seguro y fácil de mantener.

Desarrollado por GICAMUBE para la eficiencia tributaria.
