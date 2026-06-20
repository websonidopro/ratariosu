import { supabaseAdmin } from "../services/supabase.service.js";
import { processReferralCommissions } from "../services/referral.service.js";

// --- ENDPOINT 1: OBTENER CATÁLOGO DE ANIMALES ---
export const getPlanesController = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('planes_animales')
      .select('*')
      .order('precio', { ascending: true }); 

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

    if (!plan_id) return res.status(400).json({ error: "Falta el ID del plan" });

    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc("comprar_animal_plan", {
      p_user_id: userId,
      p_plan_id: plan_id,
    });

    if (rpcError) {
      const msg = String(rpcError.message ?? "");
      if (msg.includes("Saldo insuficiente") || msg.includes("no existe") || msg.includes("No se encontró")) {
        return res.status(400).json({ error: msg });
      }
      throw rpcError;
    }

    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    
    if (!row?.inversion_id) {
      return res.status(500).json({ error: "No se pudo procesar la adopción" });
    }

    await processReferralCommissions(userId, row.plan_precio, null, {
      referenciaId: row.inversion_id,
      referenciaTipo: "adopcion_animal",
    });

    return res.json({
      ok: true,
      message: "¡Plan adquirido con éxito!",
      inversion_id: row.inversion_id,
      new_balance: row.nuevo_saldo,
      expires_at: row.fecha_expiracion
    });

  } catch (err) {
    console.error("❌ Error en buyPlanController:", err);
    return res.status(500).json({ error: "Error interno procesando la compra" });
  }
};