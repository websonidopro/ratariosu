# ⚠️ CHECKLIST BACKEND: Verificación de Rutas Protegidas

Este documento te ayudará a verificar que todas las rutas **privadas** (que requieren autenticación) usen el middleware `authMiddleware`.

## 🔍 Cómo Verificar

### Opción 1: Script Automático (Recomendado)

```bash
cd /Users/danny/Documents/proyectos/TradeZoo/backend
bash verify-auth-middleware.sh
```

Si el script no tiene permisos:
```bash
chmod +x verify-auth-middleware.sh
bash verify-auth-middleware.sh
```

### Opción 2: Verificación Manual

1. Abre cada archivo en `src/routes/`
2. Busca rutas que accedan a `usuario`, `perfil`, `inversiones`, etc.
3. Asegúrate de que usen `authMiddleware`

---

## 📋 Rutas que DEBEN Usar AuthMiddleware

### Usuario Routes (`src/routes/usuario.routes.js`)

```javascript
import { authMiddleware } from "../middlewares/auth.js";
import { getPerfilController } from "../controller/usuario.controller.js";

const router = express.Router();

// ✅ CORRECTO
router.get("/usuario/perfil", authMiddleware, getPerfilController);

// ❌ INCORRECTO (sin middleware)
// router.get("/usuario/perfil", getPerfilController);

export default router;
```

**Rutas obligatorias:**
- ✅ `GET /usuario/perfil` - Ver datos del usuario
- ✅ `GET /usuario/red` - Ver red de referrales
- ✅ `PUT /usuario/perfil` - Actualizar perfil
- ✅ `GET /usuario/inversiones` - Ver inversiones

### Planes Routes (`src/routes/planes.routes.js`)

```javascript
import { authMiddleware } from "../middlewares/auth.js";

// ✅ CORRECTO - Rutas públicas (sin middleware)
router.get("/planes", getplanesController);

// ✅ CORRECTO - Rutas privadas (con middleware)
router.post("/planes/comprar", authMiddleware, comprarPlanesController);
router.post("/planes/vender", authMiddleware, venderPlanesController);

// ❌ INCORRECTO
// router.post("/planes/comprar", comprarPlanesController);
```

**Rutas privadas:**
- ✅ `POST /planes/comprar` - Comprar un plan
- ✅ `POST /planes/vender` - Vender un plan
- ✅ `PUT /planes/:id` - Actualizar plan (solo admin)

### Wallet Routes (`src/routes/wallet.routes.js`)

```javascript
import { authMiddleware } from "../middlewares/auth.js";

// ✅ CORRECTO
router.get("/wallet/saldo", authMiddleware, obtenerSaldoController);
router.post("/wallet/depositar", authMiddleware, depositarController);
router.post("/wallet/retirar", authMiddleware, retirarController);
```

### Operar Routes (`src/routes/operar.routes.js`)

```javascript
import { authMiddleware } from "../middlewares/auth.js";

// ✅ CORRECTO
router.get("/operar/mercados", getmercadosController); // Pública
router.post("/operar/trade", authMiddleware, crearTradeController); // Privada
```

### Auth Routes (`src/routes/auth.routes.js`)

```javascript
// ✅ CORRECTO - Login y registro SIN middleware
router.post("/auth/login", loginController);
router.post("/auth/registro", registroController);

// ✅ CORRECTO - Logout CON middleware
router.post("/auth/logout", authMiddleware, logoutController);
```

---

## ✅ Template Correcto para Rutas Privadas

Copia este template para cualquier ruta privada:

```javascript
import express from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { miControlador } from "../controller/mimodulo.controller.js";

const router = express.Router();

// Ruta PÚBLICA
router.get("/mimodulo/lista", miControlador.getLista);

// Ruta PRIVADA
router.post("/mimodulo/crear", authMiddleware, miControlador.crear);
router.put("/mimodulo/:id", authMiddleware, miControlador.actualizar);
router.delete("/mimodulo/:id", authMiddleware, miControlador.eliminar);

export default router;
```

---

## 🧪 Testing de Autenticación

### 1. Petición SIN Token (Debe devolver 401)

```bash
curl -X GET http://localhost:8080/api/usuario/perfil

# Esperado:
# {"error": "Falta el token de autorización."}
```

### 2. Petición CON Token Válido (Debe devolver datos)

```bash
curl -X GET http://localhost:8080/api/usuario/perfil \
  -H "Authorization: Bearer <TOKEN_VALIDO>"

# Esperado:
# {
#   "ok": true,
#   "inversiones": [...],
#   "gananciaTotal": "0.00",
#   "user": {...}
# }
```

### 3. Petición CON Token Inválido (Debe devolver 401)

```bash
curl -X GET http://localhost:8080/api/usuario/perfil \
  -H "Authorization: Bearer invalid_token_123"

# Esperado:
# {"error": "Token inválido o sesión expirada."}
```

---

## 🐛 Si Ves 500 en Lugar de 401

Significa que falta `authMiddleware`. Solución:

```javascript
// ❌ Esto devuelve 500
router.post("/planes/comprar", comprarController);

// ✅ Esto devuelve 401 si no hay token
router.post("/planes/comprar", authMiddleware, comprarController);
```

**Por qué:**
- Sin middleware: El controlador intenta acceder a `req.user` pero no existe → error no capturado → 500
- Con middleware: El middleware valida el token primero → si es inválido, devuelve 401 automáticamente → controlador nunca se ejecuta

---

## 📝 Checklist Final

Antes de hacer push a producción, verifica:

- [ ] Todos los endpoints privados usan `authMiddleware`
- [ ] El middleware está importado correctamente
- [ ] No hay rutas duplicadas sin middleware
- [ ] Probaste con Postman/curl sin token → recibiste 401
- [ ] Probaste con token válido → recibiste datos
- [ ] Probaste con token inválido → recibiste 401
- [ ] Backend reiniciado después de cambios
- [ ] No hay errores en los logs de Railway

---

## 🚀 Comandos Útiles

### Ver todas las rutas en el servidor

```bash
# En tu servidor Node.js:
app._router.stack
  .filter(r => r.route)
  .forEach(r => console.log(r.route.stack.map(x => x.method).join(), r.route.path));
```

### Logs en tiempo real (Railway)

```bash
# Si usas Railway CLI:
railway logs -f
# Si usas SSH/console de Railway:
tail -f logs/output.log
```

### Reiniciar servidor

```bash
# Local
npm run dev

# Railway
# 1. Dashboard de Railway
# 2. Selecciona tu servicio
# 3. Botón "Redeploy"
```

---

✅ **Una vez verifiques todo esto, el sistema de autenticación estará listo para producción.**
