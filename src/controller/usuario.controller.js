import { supabaseAdmin } from "../services/supabase.service.js";
import { verifyToken } from "../utils/verifyToken.js";

export const getPerfilController = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const auth = await verifyToken(token);

    if (!auth.user) {
      return res.status(auth.status).json(auth.body);
    }

    const user = auth.user;

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('nombre, mi_codigo, ganancias_usdt')
      .eq('id', user.id)
      .single();

    if (perfilError && perfilError.code !== 'PGRST116') {
      console.error("Error buscando perfil:", perfilError);
    }

    let nivel1Ids = [];
    let nivel2Ids = [];
    let nivel3Ids = [];

    const { data: lvl1, error: e1 } = await supabaseAdmin
      .from('perfiles')
      .select('id')
      .eq('referido_por', user.id);
    
    if (!e1 && lvl1) nivel1Ids = lvl1.map(u => u.id);

    if (nivel1Ids.length > 0) {
      const { data: lvl2, error: e2 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel1Ids);
      
      if (!e2 && lvl2) nivel2Ids = lvl2.map(u => u.id);
    }

    if (nivel2Ids.length > 0) {
      const { data: lvl3, error: e3 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel2Ids);
      
      if (!e3 && lvl3) nivel3Ids = lvl3.map(u => u.id);
    }

    const totalMiembrosRed = nivel1Ids.length + nivel2Ids.length + nivel3Ids.length;

    const { data: inversiones } = await supabaseAdmin
      .from('inversiones_usuarios')
      .select('*, planes_animales(nombre)')
      .eq('usuario_id', user.id);

    return res.json({
      ok: true,
      inversiones: inversiones || [],
      gananciaTotal: perfil?.ganancias_usdt || "0.00",
      user: {
        nombre: perfil?.nombre || "Granjero",
        codigo: perfil?.mi_codigo || "SIN-CODIGO"
      },
      red: {
        nivel1: nivel1Ids.length,
        nivel2: nivel2Ids.length,
        nivel3: nivel3Ids.length,
        total: totalMiembrosRed
      }
    });

  } catch (error) {
    console.error("❌ Error inesperado en perfil:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
