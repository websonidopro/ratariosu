import { supabaseAdmin } from "../services/supabase.service.js";
import { processReferralCommissions } from "../services/referral.service.js";

// --- ENDPOINT 1: OBTENER CATÁLOGO DE ANIMALES ---
export const getPlanesController = async (req, res) => {
  try {
    console.log("🔍 Consultando planes_animales...");
    const { data, error } = await supabaseAdmin
      .from('planes_animales')
      .select('*')
      .order('precio', { ascending: true });

    console.log("📊 Resultado de Supabase:", { data, error });
    console.log("📊 Cantidad de planes:", data?.length || 0);

    if (error) throw error;

    return res.json({ ok: true, planes: data });

  } catch (err) {
    console.error("❌ Error obteniendo el catálogo:", err);
    return res.status(500).json({ error: "Error interno al cargar los planes" });
  }
};

// --- ENDPOINT 2: COMPRAR/ADOPTAR ---
export const buyPlanController = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan_id } = req.body;

    console.log("🛒 Iniciando compra:", { userId, plan_id });

    if (!plan_id) return res.status(400).json({ error: "Falta el ID del plan" });

    console.log("🔍 Ejecutando RPC comprar_animal_plan...");
    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc("comprar_animal_plan", {
      p_user_id: userId,
      p_plan_id: plan_id,
    });

    console.log("📊 Resultado RPC:", { rpcRows, rpcError });

    if (rpcError) {
      const msg = String(rpcError.message ?? "");
      console.error("❌ Error en RPC:", msg);
      if (msg.includes("Saldo insuficiente") || msg.includes("no existe") || msg.includes("No se encontró")) {
        return res.status(400).json({ error: msg });
      }
      throw rpcError;
    }

    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    console.log("📋 Fila RPC:", row);
    
    if (!row?.inversion_id) {
      console.error("❌ RPC no devolvió inversion_id");
      return res.status(500).json({ error: "No se pudo procesar la adopción" });
    }

    console.log("🎁 Procesando comisiones de referidos...");
    const commissionResult = await processReferralCommissions(userId, row.plan_precio, null, {
      referenciaId: row.inversion_id,
      referenciaTipo: "adopcion_animal",
    });
    console.log("✅ Resultado comisiones:", commissionResult);

    return res.json({
      ok: true,
      message: "¡Plan adquirido con éxito!",
      inversion_id: row.inversion_id,
      new_balance: row.nuevo_saldo,
      expires_at: row.fecha_expiracion
    });

  } catch (err) {
    console.error("❌❌❌ DETALLE FATAL EN COMPRA:", err);
    console.error("❌ Stack trace:", err.stack);
    return res.status(500).json({ error: "Error interno procesando la compra" });
  }
};

// --- ENDPOINT 3: OPERAR/RECOLECTAR GANANCIAS ---
export const operarController = async (req, res) => {
  try {
    const userId = req.user.id;

    // Obtener todas las inversiones activas del usuario
    const { data: inversiones, error: inversionesError } = await supabaseAdmin
      .from('inversiones_usuarios')
      .select(`
        id,
        last_claim_date,
        planes_animales (
          id,
          ganancia_diaria
        )
      `)
      .eq('usuario_id', userId)
      .eq('activa', true);

    if (inversionesError) {
      console.error("❌ Error obteniendo inversiones:", inversionesError);
      return res.status(500).json({ error: "Error al obtener tus inversiones" });
    }

    if (!inversiones || inversiones.length === 0) {
      return res.status(400).json({ error: "No tienes planes activos para operar" });
    }

    const now = new Date();
    let totalGanancia = 0;
    const detalles = [];

    // Calcular ganancias para cada inversión
    for (const inversion of inversiones) {
      const lastClaim = inversion.last_claim_date ? new Date(inversion.last_claim_date) : inversion.created_at ? new Date(inversion.created_at) : null;
      
      if (!lastClaim) {
        console.log("⚠️ Inversión sin fecha de creación:", inversion.id);
        continue;
      }

      // Calcular días transcurridos (mínimo 1 día si ya pasó tiempo)
      const diffTime = now - lastClaim;
      const diffDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

      const gananciaDiaria = Number(inversion.planes_animales?.ganancia_diaria || 0);
      if (gananciaDiaria <= 0) {
        console.log("⚠️ Plan sin ganancia diaria:", inversion.planes_animales?.id);
        continue;
      }

      const gananciaCalculada = gananciaDiaria * diffDays;
      totalGanancia += gananciaCalculada;

      detalles.push({
        inversion_id: inversion.id,
        plan_nombre: inversion.planes_animales?.id || 'Desconocido',
        dias_acumulados: diffDays,
        ganancia_diaria: gananciaDiaria,
        ganancia_total: gananciaCalculada
      });

      // Actualizar last_claim_date de esta inversión
      const { error: updateError } = await supabaseAdmin
        .from('inversiones_usuarios')
        .update({ last_claim_date: now.toISOString() })
        .eq('id', inversion.id);

      if (updateError) {
        console.error("❌ Error actualizando last_claim_date:", updateError);
      }
    }

    if (totalGanancia <= 0) {
      return res.status(400).json({ error: "No hay ganancias disponibles para recolectar" });
    }

    // Sumar ganancias al saldo_usdt del usuario
    const { error: updateSaldoError } = await supabaseAdmin
      .from('perfiles')
      .update({
        ganancias_usdt: supabaseAdmin.raw(`ganancias_usdt + ${totalGanancia}`)
      })
      .eq('id', userId);

    if (updateSaldoError) {
      console.error("❌ Error actualizando ganancias_usdt:", updateSaldoError);
      return res.status(500).json({ error: "Error al actualizar tu saldo de ganancias" });
    }

    // Obtener nuevo saldo
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('ganancias_usdt')
      .eq('id', userId)
      .single();

    if (perfilError) {
      console.error("❌ Error obteniendo perfil actualizado:", perfilError);
    }

    return res.json({
      ok: true,
      message: `Has recolectado ${totalGanancia.toFixed(2)} USDT en ganancias`,
      total_ganancia: totalGanancia,
      nuevo_saldo_ganancias: perfil?.ganancias_usdt || 0,
      detalles
    });

  } catch (err) {
    console.error("❌ Error en operarController:", err);
    return res.status(500).json({ error: "Error interno al procesar la operación" });
  }
};