import { supabaseAdmin } from "../services/supabase.service.js";
import { processReferralCommissions } from "../services/referral.service.js";

// --- ENDPOINT 1: OBTENER CATÁLOGO DE ANIMALES ---
export const getPlanesController = async (req, res) => {
  try {
    console.log("🔍 Consultando planes_animales...");
    console.log("🔑 Prefijo Llave:", process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 10) + "..." : "MISSING");
    console.log("⚠️ Verificación de llaves - ¿Son idénticas?:", process.env.SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabaseAdmin.from('planes_animales').select('*');

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

    console.log("🛒 Iniciando compra manual:", { userId, plan_id });

    if (!plan_id) return res.status(400).json({ error: "Falta el ID del plan" });

    // Paso 1: Obtener Plan
    console.log("🔍 Paso 1: Obteniendo plan...");
    const { data: plan, error: planError } = await supabaseAdmin
      .from('planes_animales')
      .select('*')
      .eq('id', plan_id)
      .maybeSingle();

    if (planError || !plan) {
      console.error("❌ Plan no encontrado:", planError);
      return res.status(404).json({ error: "Plan no encontrado" });
    }

    const planPrecio = Number(plan.precio);
    const planGananciaDiaria = Number(plan.ganancia_diaria);
    const planDuracion = Number(plan.duracion_dias);

    console.log("� Plan encontrado:", { planPrecio, planGananciaDiaria, planDuracion });

    // Paso 2: Obtener Saldo del Usuario
    console.log("💰 Paso 2: Obteniendo saldo del usuario...");
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('saldo_usdt')
      .eq('id', userId)
      .maybeSingle();

    if (perfilError || !perfil) {
      console.error("❌ Perfil no encontrado:", perfilError);
      return res.status(404).json({ error: "Perfil de usuario no encontrado" });
    }

    const saldoActual = Number(perfil.saldo_usdt || 0);
    console.log("💵 Saldo actual:", saldoActual);

    // Paso 3: Validación de Fondos
    if (saldoActual < planPrecio) {
      console.error("❌ Saldo insuficiente:", { saldoActual, planPrecio });
      return res.status(400).json({ error: "Saldo insuficiente" });
    }

    // Paso 4: Descontar Saldo
    console.log("📉 Paso 4: Descontando saldo...");
    const nuevoSaldo = saldoActual - planPrecio;
    const { error: updateError } = await supabaseAdmin
      .from('perfiles')
      .update({ saldo_usdt: nuevoSaldo })
      .eq('id', userId);

    if (updateError) {
      console.error("❌ Error actualizando saldo:", updateError);
      return res.status(500).json({ error: "Error al actualizar el saldo" });
    }

    console.log("✅ Saldo actualizado:", nuevoSaldo);

    // Paso 5: Registrar Inversión
    console.log("📝 Paso 5: Registrando inversión...");
    const fechaFin = new Date();
    fechaFin.setDate(fechaFin.getDate() + 75); // Todos los planes duran 75 días

    const { data: inversion, error: inversionError } = await supabaseAdmin
      .from('inversiones_usuarios')
      .insert({
        user_id: userId,
        plan_id: plan_id,
        precio_pagado: planPrecio,
        ganancia_acumulada: 0,
        estado: 'activo',
        fecha_inicio: new Date().toISOString(),
        ultimo_cobro: null,
        fecha_fin: fechaFin.toISOString(),
        last_claim_date: new Date().toISOString(),
      })
      .select()
      .single();

    if (inversionError) {
      console.error("❌ Error insertando inversión:", inversionError);
      // Revertir saldo en caso de error
      await supabaseAdmin
        .from('perfiles')
        .update({ saldo_usdt: saldoActual })
        .eq('id', userId);
      return res.status(500).json({ error: "Error al registrar la inversión" });
    }

    console.log("✅ Inversión registrada:", inversion.id);

    // Paso 6: Referidos
    console.log("🎁 Paso 6: Procesando comisiones de referidos...");
    const commissionResult = await processReferralCommissions(userId, planPrecio, null, {
      referenciaId: inversion.id,
      referenciaTipo: "adopcion_animal",
    });
    console.log("✅ Resultado comisiones:", commissionResult);

    return res.json({
      ok: true,
      message: "¡Plan adquirido con éxito!",
      inversion_id: inversion.id,
      new_balance: nuevoSaldo,
      expires_at: fechaFin.toISOString()
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
    const { inversion_id } = req.body;

    if (!inversion_id) {
      return res.status(400).json({ error: "El ID de la inversión es requerido" });
    }

    // Paso 1: Validación - Obtener inversión específica del usuario
    const { data: inversion, error: inversionError } = await supabaseAdmin
      .from('inversiones_usuarios')
      .select(`
        id,
        plan_id,
        ganancia_acumulada,
        ultimo_cobro,
        last_claim_date
      `)
      .eq('id', inversion_id)
      .eq('user_id', userId)
      .eq('estado', 'activo')
      .maybeSingle();

    if (inversionError) {
      console.error("❌ Error obteniendo inversión:", inversionError);
      return res.status(500).json({ error: "Error al obtener tu inversión" });
    }

    if (!inversion) {
      return res.status(404).json({ error: "Inversión no encontrada o no activa" });
    }

    // Candado de tiempo: Validar si ya operó hoy
    const lastClaimDate = inversion.last_claim_date ? new Date(inversion.last_claim_date) : null;
    const today = new Date();
    
    if (lastClaimDate) {
      const isSameDay = 
        lastClaimDate.getFullYear() === today.getFullYear() &&
        lastClaimDate.getMonth() === today.getMonth() &&
        lastClaimDate.getDate() === today.getDate();
      
      if (isSameDay) {
        return res.status(400).json({ 
          error: 'Ya has reclamado las ganancias de este plan por el día de hoy. Vuelve mañana.' 
        });
      }
    }

    let totalGanancia = 0;
    const detalles = [];

    // Paso 2: Obtener ganancia_diaria desde planes_animales
    const { data: plan, error: planError } = await supabaseAdmin
      .from('planes_animales')
      .select('ganancia_diaria')
      .eq('id', inversion.plan_id)
      .maybeSingle();

    if (planError || !plan) {
      console.error("❌ Error obteniendo plan:", planError);
      return res.status(500).json({ error: "Error al obtener el plan" });
    }

    const gananciaDiaria = Number(plan.ganancia_diaria || 0);
    if (gananciaDiaria <= 0) {
      return res.status(400).json({ error: "El plan no tiene ganancia diaria configurada" });
    }

    totalGanancia = gananciaDiaria;

    detalles.push({
      inversion_id: inversion.id,
      plan_id: inversion.plan_id,
      ganancia_diaria: gananciaDiaria,
    });

    // Paso 4: Actualizar inversiones_usuarios
    const nuevaGananciaAcumulada = Number(inversion.ganancia_acumulada || 0) + gananciaDiaria;
    const now = new Date().toISOString();

    const { error: updateInversionError } = await supabaseAdmin
      .from('inversiones_usuarios')
      .update({
        ganancia_acumulada: nuevaGananciaAcumulada,
        ultimo_cobro: now,
        last_claim_date: now,
      })
      .eq('id', inversion.id);

    if (updateInversionError) {
      console.error("❌ Error actualizando inversión:", updateInversionError);
      return res.status(500).json({ error: "Error al actualizar la inversión" });
    }

    // Paso 3: Actualizar perfiles.saldo_usdt usando SELECT + UPDATE
    const { data: perfil, error: fetchError } = await supabaseAdmin
      .from('perfiles')
      .select('saldo_usdt')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError || !perfil) {
      console.error("❌ Error obteniendo perfil:", fetchError);
      return res.status(500).json({ error: "Error al obtener tu perfil" });
    }

    const saldoActual = Number(perfil.saldo_usdt || 0);
    const nuevoSaldo = saldoActual + totalGanancia;

    const { error: updateSaldoError } = await supabaseAdmin
      .from('perfiles')
      .update({ saldo_usdt: nuevoSaldo })
      .eq('id', userId);

    if (updateSaldoError) {
      console.error("❌ Error actualizando saldo:", updateSaldoError);
      return res.status(500).json({ error: "Error al actualizar tu saldo" });
    }

    // Paso 5: Insertar en historial_transacciones
    try {
      const { error: historyError } = await supabaseAdmin
        .from('historial_transacciones')
        .insert({
          user_id: userId,
          tipo: 'ganancia_operacion',
          monto: totalGanancia,
          descripcion: `Ganancia operativa de ${totalGanancia} USDT`,
        });

      if (historyError) {
        console.error("❌ Error insertando en historial_transacciones:", historyError);
      }
    } catch (historyErr) {
      console.log("⚠️ Tabla historial_transacciones no disponible, continuando...");
    }

    return res.json({
      ok: true,
      message: `Has recolectado ${totalGanancia.toFixed(2)} USDT en ganancias`,
      total_ganancia: totalGanancia,
      nuevo_saldo: nuevoSaldo,
      detalles
    });

  } catch (err) {
    console.error("❌ Error en operarController:", err);
    console.error("❌ Stack trace:", err.stack);
    return res.status(500).json({ error: "Error interno al procesar la operación" });
  }
};