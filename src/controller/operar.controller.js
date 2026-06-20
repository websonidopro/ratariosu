import { supabaseAdmin } from "../services/supabase.service.js";

export const operarDiarioController = async (req, res) => {
  try {
    const userId = req.user.id;

    // Llamamos al RPC de Supabase que revisa las 24 horas y paga
    const { data, error } = await supabaseAdmin.rpc("reclamar_ganancia_diaria", {
      p_user_id: userId
    });

    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("no han pasado 24 horas") || msg.includes("Cuenta no encontrada")) {
        return res.status(400).json({ error: msg });
      }
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;

    return res.json({
      ok: true,
      message: "¡Mercado operado con éxito!",
      monto_reclamado: result.monto_reclamado,
      nuevo_saldo: result.nuevo_saldo
    });

  } catch (err) {
    console.error("❌ Error en operarDiarioController:", err);
    return res.status(500).json({ error: "Error procesando la operación diaria" });
  }
};