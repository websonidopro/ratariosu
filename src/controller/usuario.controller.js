import { supabaseAdmin } from "../services/supabase.service.js";

export const getPerfilController = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Falta token de autorización" });

    const token = authHeader.split(" ")[1];

    // 1. Validar identidad del usuario
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw userError;

    // --- 🌳 CÁLCULO ESTRUCTURAL DE LA RED (3 NIVELES) ---
    let nivel1Ids = [];
    let nivel2Ids = [];
    let nivel3Ids = [];

    // Nivel 1: Usuarios que fueron invitados directamente por mí
    const { data: lvl1, error: e1 } = await supabaseAdmin
      .from('perfiles')
      .select('id')
      .eq('referido_por', user.id);
    
    if (e1) throw e1;
    if (lvl1) nivel1Ids = lvl1.map(u => u.id);

    // Nivel 2: Usuarios invitados por la gente de mi Nivel 1
    if (nivel1Ids.length > 0) {
      const { data: lvl2, error: e2 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel1Ids);
      
      if (e2) throw e2;
      if (lvl2) nivel2Ids = lvl2.map(u => u.id);
    }

    // Nivel 3: Usuarios invitados por la gente de mi Nivel 2
    if (nivel2Ids.length > 0) {
      const { data: lvl3, error: e3 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel2Ids);
      
      if (e3) throw e3;
      if (lvl3) nivel3Ids = lvl3.map(u => u.id);
    }

    // Suma total de miembros en la red
    const totalMiembrosRed = nivel1Ids.length + nivel2Ids.length + nivel3Ids.length;

    // 2. Traer inversiones del usuario
    const { data: inversiones } = await supabaseAdmin
      .from('inversiones_usuarios')
      .select('*, planes_animales(nombre)')
      .eq('usuario_id', user.id);

    return res.json({
      ok: true,
      inversiones: inversiones || [],
      gananciaTotal: "0.00",
      user: {
        nombre: user.user_metadata?.nombre_completo || "Granjero",
        codigo: user.user_metadata?.mi_codigo || "SIN-CODIGO"
      },
      red: {
        nivel1: nivel1Ids.length,
        nivel2: nivel2Ids.length,
        nivel3: nivel3Ids.length,
        total: totalMiembrosRed
      }
    });

  } catch (error) {
    console.error("❌ Error en perfil:", error);
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }
};