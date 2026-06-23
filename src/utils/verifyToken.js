import { supabaseAdmin } from "../services/supabase.service.js";

/**
 * Valida un JWT de Supabase sin lanzar excepciones.
 * @returns {{ user: object|null, status: number, body: object|null }}
 */
export async function verifyToken(token) {
  if (!token) {
    return {
      user: null,
      status: 401,
      body: { error: "Falta token de autorización", code: "no_token" },
    };
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    const code = error?.code || "auth_error";
    console.warn(`⚠️ Token rechazado (${code}):`, error?.message || "usuario no encontrado");
    return {
      user: null,
      status: 401,
      body: { error: "Sesión inválida o expirada", code },
    };
  }

  return { user, status: 200, body: null };
}
