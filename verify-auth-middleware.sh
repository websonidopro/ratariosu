#!/bin/bash

# 🔍 Script de Verificación: Middleware de Autenticación
# Uso: bash verify-auth-middleware.sh

echo "🔐 Verificando que todas las rutas privadas usen authMiddleware..."
echo ""

# Buscar todas las rutas en el backend
ROUTES_DIR="src/routes"

if [ ! -d "$ROUTES_DIR" ]; then
  echo "❌ Directorio $ROUTES_DIR no encontrado"
  exit 1
fi

echo "📋 Analizando rutas en $ROUTES_DIR:"
echo ""

ISSUES=0

# Analizar cada archivo de rutas
for route_file in $ROUTES_DIR/*.routes.js; do
  if [ -f "$route_file" ]; then
    echo "📄 Procesando: $route_file"
    
    # Buscar rutas que NO tienen authMiddleware pero podrían ser privadas
    # (aquellas que acceden a datos de usuario o hacen cambios)
    
    # Rutas que DEBEN usar authMiddleware
    PRIVATE_PATTERNS=(
      "usuario/"
      "planes/comprar"
      "planes/vender"
      "wallet"
      "inversiones"
      "perfil"
      "transferencia"
    )
    
    for pattern in "${PRIVATE_PATTERNS[@]}"; do
      if grep -q "\"$pattern" "$route_file"; then
        # Verificar si usa authMiddleware
        ENDPOINT=$(grep "\"$pattern" "$route_file" | head -1)
        
        if grep -q "authMiddleware" "$route_file"; then
          echo "  ✅ Ruta protegida encontrada: $pattern"
        else
          echo "  ⚠️  ADVERTENCIA: Ruta privada SIN middleware: $pattern"
          echo "     Línea: $ENDPOINT"
          ((ISSUES++))
        fi
      fi
    done
    
    echo ""
  fi
done

# Resumen
if [ $ISSUES -gt 0 ]; then
  echo ""
  echo "❌ Se encontraron $ISSUES rutas que podrían necesitar authMiddleware"
  echo ""
  echo "📝 Solución:"
  echo "   Actualiza las rutas privadas de la siguiente forma:"
  echo ""
  echo "   Antes:"
  echo "     router.post('/planes/comprar', comprarController);"
  echo ""
  echo "   Después:"
  echo "     router.post('/planes/comprar', authMiddleware, comprarController);"
  echo ""
  exit 1
else
  echo ""
  echo "✅ Todas las rutas privadas tienen authMiddleware"
  exit 0
fi
