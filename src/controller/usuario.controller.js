import { supabaseAdmin } from "../services/supabase.service.js";

export const getPerfilController = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Falta token de autorización" });

    const token = authHeader.split(" ")[1];

    // 1. Validar identidad del usuario en Auth
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) throw userError;

    // 🌟 2. OBTENER EL PERFIL REAL DE LA BASE DE DATOS
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('nombre, mi_codigo, ganancias_usdt')
      .eq('id', user.id)
      .single();

    if (perfilError && perfilError.code !== 'PGRST116') {
      console.error("Error buscando perfil:", perfilError);
    }

    // --- 🌳 CÁLCULO ESTRUCTURAL DE LA RED (3 NIVELES) ---
    let nivel1Ids = [];
    let nivel2Ids = [];
    let nivel3Ids = [];

    // Nivel 1: Usuarios que fueron invitados directamente por mí
    const { data: lvl1, error: e1 } = await supabaseAdmin
      .from('perfiles')
      .select('id')
      .eq('referido_por', user.id);
    
    if (!e1 && lvl1) nivel1Ids = lvl1.map(u => u.id);

    // Nivel 2: Usuarios invitados por la gente de mi Nivel 1
    if (nivel1Ids.length > 0) {
      const { data: lvl2, error: e2 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel1Ids);
      
      if (!e2 && lvl2) nivel2Ids = lvl2.map(u => u.id);
    }

    // Nivel 3: Usuarios invitados por la gente de mi Nivel 2
    if (nivel2Ids.length > 0) {
      const { data: lvl3, error: e3 } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .in('referido_por', nivel2Ids);
      
      if (!e3 && lvl3) nivel3Ids = lvl3.map(u => u.id);
    }

    const totalMiembrosRed = nivel1Ids.length + nivel2Ids.length + nivel3Ids.length;

    // 3. Traer inversiones del usuario
    const { data: inversiones } = await supabaseAdmin
      .from('inversiones_usuarios')
      .select('*, planes_animales(nombre)')
      .eq('usuario_id', user.id);

    // 4. Retornar la respuesta con los datos de la tabla perfiles
    return res.json({
      ok: true,
      inversiones: inversiones || [],
      gananciaTotal: perfil?.ganancias_usdt || "0.00", // Ahora es dinámico
      user: {
        nombre: perfil?.nombre || "Granjero",
        codigo: perfil?.mi_codigo || "SIN-CODIGO" // Aquí atrapa tu TZ-XXXXXX
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