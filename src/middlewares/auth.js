import { supabaseAdmin } from "../services/supabase.service.js";
import { verifyToken } from "../utils/verifyToken.js";

export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    const auth = await verifyToken(token);

    if (!auth.user) {
      return res.status(auth.status).json(auth.body);
    }

    req.user = auth.user;
    next();
  } catch (err) {
    console.error("Error inesperado en authMiddleware:", err);
    return res.status(500).json({ error: "Error interno de autenticación." });
  }
};
