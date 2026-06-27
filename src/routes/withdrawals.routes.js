import express from "express";
import bcrypt from "bcrypt";
import { authMiddleware } from "../middlewares/auth.js";
import { supabaseAdmin } from "../services/supabase.service.js";

const router = express.Router();

/**
 * ============================================
 * OBTENER SALDO DE GANANCIAS DISPONIBLE
 * ============================================
 */
const getEarningsBalance = async (userId) => {
  const { data: row, error } = await supabaseAdmin
    .from('perfiles')
    .select('ganancias_usdt')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return Number(row?.ganancias_usdt ?? 0) || 0;
};

/**
 * ============================================
 * VERIFICAR SI TIENE PLAN ACTIVO
 * ============================================
 */
const hasActivePlan = async (userId) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('inversiones_usuarios')
    .select('id')
    .eq('user_id', userId)
    .eq('activa', true)
    .or(`fecha_expiracion.is.null,fecha_expiracion.gt.${nowIso}`)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
};

/**
 * ============================================
 * OBTENER HISTORIAL DE RETIROS
 * ============================================
 */
router.get('/withdraw/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autenticado' });

    const { data, error } = await supabaseAdmin
      .from('historial_transacciones')
      .select('*')
      .eq('user_id', userId)
      .eq('tipo', 'retiro')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (error.message.includes('relation') || error.message.includes('does not exist')) {
        return res.json([]);
      }
      throw error;
    }

    return res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('❌ Error en GET /withdraw/me:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * ============================================
 * VALIDAR RETIRO
 * ============================================
 */
router.post("/withdraw/validate", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { monto, red, pin } = req.body;

    if (!userId) return res.status(401).json({ error: "No autenticado" });

    // Verificar si tiene plan activo
    const hasPlan = await hasActivePlan(userId);
    if (!hasPlan) {
      return res.status(403).json({ error: 'Debes tener un plan activo para retirar' });
    }

    if (!monto || !red || !pin) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    // Obtener usuario con PIN
    const { data: usuario, error: usuarioError } = await supabaseAdmin
      .from("perfiles")
      .select("pin_retiro_hash, pin_intentos, pin_bloqueado_hasta")
      .eq("id", userId)
      .maybeSingle();

    if (usuarioError) {
      console.error("❌ Error consultando usuario:", usuarioError);
      return res.status(500).json({ error: "Error interno del servidor" });
    }

    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });
    if (!usuario.pin_retiro_hash) {
      return res.status(403).json({ error: "PIN de retiro no configurado" });
    }

    // Verificar si está bloqueado
    const ahora = new Date();
    if (usuario.pin_bloqueado_hasta && new Date(usuario.pin_bloqueado_hasta) > ahora) {
      const minutos = Math.ceil((new Date(usuario.pin_bloqueado_hasta) - ahora) / 60000);
      return res.status(403).json({
        error: "PIN bloqueado temporalmente",
        desbloqueo_en_minutos: minutos,
      });
    }

    // Validar PIN
    const pinCorrecto = await bcrypt.compare(String(pin), usuario.pin_retiro_hash);

    if (!pinCorrecto) {
      const intentosActuales = Number(usuario.pin_intentos ?? 0);
      const nuevosIntentos = intentosActuales + 1;

      if (nuevosIntentos >= 3) {
        const bloqueoMin = 10;
        const desbloqueo = new Date(Date.now() + bloqueoMin * 60000);

        const { error: bloqueoError } = await supabaseAdmin
          .from("perfiles")
          .update({
            pin_intentos: 0,
            pin_bloqueado_hasta: desbloqueo.toISOString(),
          })
          .eq("id", userId);

        if (bloqueoError) {
          console.error("❌ Error bloqueando PIN:", bloqueoError);
          return res.status(500).json({ error: "Error interno del servidor" });
        }

        return res.status(403).json({
          error: "PIN incorrecto. Usuario bloqueado temporalmente.",
          bloqueo_minutos: bloqueoMin,
        });
      }

      const { error: intentosError } = await supabaseAdmin
        .from("perfiles")
        .update({ pin_intentos: nuevosIntentos })
        .eq("id", userId);

      if (intentosError) {
        console.error("❌ Error actualizando intentos PIN:", intentosError);
        return res.status(500).json({ error: "Error interno del servidor" });
      }

      return res.status(401).json({
        error: "PIN incorrecto",
        intentos_restantes: 3 - nuevosIntentos,
      });
    }

    // PIN correcto → resetear intentos
    const { error: resetError } = await supabaseAdmin
      .from("perfiles")
      .update({
        pin_intentos: 0,
        pin_bloqueado_hasta: null,
      })
      .eq("id", userId);

    if (resetError) {
      console.error("❌ Error reseteando intentos PIN:", resetError);
      return res.status(500).json({ error: "Error interno del servidor" });
    }

    // Validar red
    const redNorm = String(red || '').trim();
    if (redNorm !== 'BEP20-USDT') {
      return res.status(400).json({ error: 'Red no soportada. Usa BEP20-USDT' });
    }

    const feePercent = 0.1;
    const total = Number(montoNum);
    const fee = Math.round(total * feePercent * 100) / 100;
    const neto = total - fee;

    if (!Number.isFinite(neto) || neto <= 0) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    if (total < 3.5) {
      const minTotal = 3.5;
      const minFee = Math.round(minTotal * feePercent * 100) / 100;
      const minNeto = Math.round((minTotal - minFee) * 100) / 100;
      return res.status(400).json({
        error: `El retiro mínimo es 3.50 USDT. Debes ingresar mínimo ${Number(3.5).toFixed(2)} USDT`,
        minimo_neto: minNeto,
        minimo_total: minTotal,
        fee_percent: feePercent,
        fee: minFee,
      });
    }

    // Verificar saldo disponible
    const disponible = await getEarningsBalance(userId);
    if (!Number.isFinite(disponible) || disponible < total) {
      return res.status(400).json({
        error: "Saldo insuficiente",
        disponible,
        requerido: total,
      });
    }

    // Verificar retiro pendiente
    const { data: pendienteRows, error: pendienteErr } = await supabaseAdmin
      .from("historial_transacciones")
      .select("id")
      .eq("user_id", userId)
      .eq("tipo", "retiro")
      .in("estado", ["pendiente", "procesando"])
      .limit(1);

    if (pendienteErr) {
      if (!pendienteErr.message.includes('relation') || !pendienteErr.message.includes('does not exist')) {
        throw pendienteErr;
      }
    }

    const pendiente = Array.isArray(pendienteRows) && pendienteRows.length ? pendienteRows[0] : null;
    if (pendiente) {
      return res.status(400).json({ error: "Ya tienes un retiro pendiente" });
    }

    return res.json({
      ok: true,
      message: "Retiro validado correctamente",
      monto: neto,
      fee,
      fee_percent: feePercent,
      total,
      red: redNorm,
      disponible,
    });
  } catch (error) {
    console.error("❌ Error en /withdraw/validate:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * ============================================
 * CREAR SOLICITUD DE RETIRO
 * ============================================
 */
router.post("/withdraw/create", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { monto, red, direccion } = req.body;

    if (!userId) return res.status(401).json({ error: "No autenticado" });

    // Verificar si tiene plan activo
    const hasPlan = await hasActivePlan(userId);
    if (!hasPlan) {
      return res.status(403).json({ error: 'Debes tener un plan activo para retirar' });
    }

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    const redNorm = String(red || '').trim();
    if (redNorm !== 'BEP20-USDT') {
      return res.status(400).json({ error: 'Red no soportada. Usa BEP20-USDT' });
    }

    // Validar dirección
    const normalizedDireccion = String(direccion || '').trim().replace(/\s+/g, '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalizedDireccion)) {
      return res.status(400).json({ error: "Dirección inválida para BEP20" });
    }

    const feePercent = 0.1;
    const total = Number(montoNum);
    const fee = Math.round(total * feePercent * 100) / 100;
    const neto = total - fee;

    if (!Number.isFinite(neto) || neto <= 0) {
      return res.status(400).json({ error: "Monto inválido" });
    }

    if (total < 3.5) {
      return res.status(400).json({
        error: `El retiro mínimo es 3.50 USDT. Debes ingresar mínimo ${Number(3.5).toFixed(2)} USDT`,
      });
    }

    // Verificar saldo disponible
    const disponible = await getEarningsBalance(userId);
    if (!Number.isFinite(disponible) || disponible < total) {
      return res.status(400).json({ error: "Saldo insuficiente", disponible, requerido: total });
    }

    // Verificar retiro pendiente
    const { data: activeRows, error: activeErr } = await supabaseAdmin
      .from("historial_transacciones")
      .select("id")
      .eq("user_id", userId)
      .eq("tipo", "retiro")
      .in("estado", ["pendiente", "procesando"])
      .limit(1);

    if (activeErr) {
      if (!activeErr.message.includes('relation') || !activeErr.message.includes('does not exist')) {
        throw activeErr;
      }
    }

    const active = Array.isArray(activeRows) && activeRows.length ? activeRows[0] : null;
    if (active) {
      return res.status(400).json({ error: "Ya tienes un retiro pendiente" });
    }

    // Registrar retiro en historial_transacciones
    try {
      const { error: insertError } = await supabaseAdmin
        .from("historial_transacciones")
        .insert({
          user_id: userId,
          tipo: "retiro",
          referencia_id: normalizedDireccion,
          referencia_tipo: "direccion_wallet",
          monto: total,
          fee: fee,
          neto: neto,
          red: redNorm,
          estado: "pendiente",
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error("❌ Error insertando retiro:", insertError);
        throw insertError;
      }
    } catch (historyError) {
      console.log("⚠️ Tabla historial_transacciones no disponible, intentando actualizar saldo directamente...");
    }

    // Descontar del saldo de ganancias
    const { error: updateError } = await supabaseAdmin
      .from("perfiles")
      .update({
        ganancias_usdt: supabaseAdmin.raw(`ganancias_usdt - ${total}`)
      })
      .eq("id", userId);

    if (updateError) {
      console.error("❌ Error actualizando ganancias_usdt:", updateError);
      return res.status(500).json({ error: "Error al procesar el retiro" });
    }

    // Obtener nuevo saldo
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from("perfiles")
      .select("ganancias_usdt")
      .eq("id", userId)
      .maybeSingle();

    if (perfilError) {
      console.error("❌ Error obteniendo perfil actualizado:", perfilError);
    }

    return res.json({
      ok: true,
      message: "Solicitud de retiro creada exitosamente",
      monto: neto,
      fee,
      total,
      red: redNorm,
      direccion: normalizedDireccion,
      nuevo_saldo_ganancias: perfil?.ganancias_usdt || 0,
    });
  } catch (error) {
    console.error("❌ Error en /withdraw/create:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
