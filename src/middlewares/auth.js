import { supabaseAdmin } from "../services/supabase.service.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Falta el token de autorización." });
    }

    const token = authHeader.replace("Bearer ", "");
    
    // Verificamos el token directamente con la seguridad de Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Token inválido o sesión expirada." });
    }

    // Guardamos la info del usuario para que el controlador sepa a quién cobrarle
    req.user = user;
    next();
  } catch (err) {
    console.error("Error en authMiddleware:", err);
    return res.status(500).json({ error: "Error interno de autenticación." });
  }
};