# Sistema de Rifas

Sistema completo de gestión de rifas desarrollado con **Astro (SSR)**, **Drizzle ORM**, **Turso** (SQLite en la nube), y **Tailwind CSS**.

## 🚀 Deployment en Vercel (GRATIS)

### Requisitos Previos
- Cuenta en [Vercel](https://vercel.com) (gratis)
- Cuenta en [Turso](https://turso.tech) (gratis)
- Node.js >= 18.17

---

## 📦 Instalación y Configuración

### 1. Clonar e Instalar Dependencias
```powershell
git clone https://github.com/tu-usuario/sistema-rifas.git
cd sistema-rifas
npm install
```

### 2. Configurar Turso (Base de Datos)
```powershell
# Instalar CLI de Turso
npm install -g @tursodatabase/cli

# Login en Turso
turso auth login

# Crear base de datos
turso db create sistema-rifas

# Obtener credenciales
turso db show sistema-rifas --url
turso db tokens create sistema-rifas
```

### 3. Configurar Variables de Entorno
```powershell
# Copiar archivo de ejemplo
Copy-Item .env.example .env

# Editar .env con tus credenciales de Turso
```

**Contenido de `.env`:**
```env
TURSO_CONNECTION_URL=libsql://sistema-rifas-tu-usuario.turso.io
TURSO_AUTH_TOKEN=tu_token_generado_por_turso
```

### 4. Migrar Base de Datos
```powershell
# Generar migraciones
npm run drizzle:generate

# Aplicar migraciones a Turso
npm run drizzle:migrate
```

### 5. Desarrollo Local
```powershell
npm run dev
```
Abre: http://localhost:4321

---

## 🌐 Deploy en Vercel

### Opción 1: CLI (Recomendado)
```powershell
# Instalar Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Configurar variables de entorno en Vercel Dashboard
# Settings > Environment Variables:
# - TURSO_CONNECTION_URL
# - TURSO_AUTH_TOKEN

# Deploy a producción
vercel --prod
```

### Opción 2: GitHub (Automático)
1. Sube tu código a GitHub
2. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
3. **New Project** → Importa tu repositorio
4. Configura variables de entorno:
   - `TURSO_CONNECTION_URL`
   - `TURSO_AUTH_TOKEN`
5. Click **Deploy**

---

## 📁 Estructura del Proyecto
```
src/
├── db/
│   ├── client.ts       # Cliente Turso/SQLite
│   └── schema.ts       # Schema Drizzle
├── pages/
│   ├── index.astro     # Landing page
│   ├── admin/          # Panel administrador
│   ├── usuario/        # Panel usuarios
│   └── api/            # Endpoints API
└── styles/
    └── global.css      # Estilos Tailwind
```

---

## 🛠️ Scripts Disponibles
```powershell
npm run dev              # Desarrollo local
npm run build            # Build producción
npm run preview          # Preview del build
npm run drizzle:generate # Generar migraciones
npm run drizzle:migrate  # Aplicar migraciones
```

---

## 🗄️ Migrar Datos de SQLite Local a Turso

```powershell
# 1. Exportar datos de SQLite local
sqlite3 ./data/db.sqlite .dump > backup.sql

# 2. Importar a Turso
turso db shell sistema-rifas < backup.sql
```

---

## 💰 Costos (TODO GRATIS)

| Servicio | Plan Gratuito |
|----------|---------------|
| **Vercel** | 100 GB bandwidth, SSL, dominio personalizado |
| **Turso** | 500 DBs, 9 GB storage, 1B lecturas/mes |
| **Total** | **$0/mes** |

---

## 🔧 Configuración Adicional

### Dominio Personalizado en Vercel
1. Ir a **Settings > Domains** en Vercel
2. Agregar tu dominio (ejemplo: `turifas.com`)
3. Configurar DNS según instrucciones de Vercel

### Cloudinary (Opcional)
Para subida de imágenes, configura en `.env`:
```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```

---

## 🐛 Troubleshooting

### Error: "Cannot find module"
```powershell
rm -rf node_modules package-lock.json
npm install
```

### Error: "Database connection failed"
Verifica que `TURSO_CONNECTION_URL` y `TURSO_AUTH_TOKEN` estén correctos en `.env`

### Desarrollo Local sin Turso
Comenta las variables de Turso en `.env` para usar SQLite local:
```env
# TURSO_CONNECTION_URL=...
# TURSO_AUTH_TOKEN=...
```

---

## 📚 Tecnologías
- **Frontend:** Astro 4.x + Tailwind CSS
- **Backend:** Astro SSR (Serverless)
- **Database:** Turso (SQLite)
- **ORM:** Drizzle ORM
- **Hosting:** Vercel
- **Email:** Nodemailer

---

## 📄 Licencia
MIT