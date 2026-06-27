import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
// Asegúrate de que el nombre de esta variable coincida exactamente con tu archivo .env
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Faltan credenciales de Supabase en el archivo .env");
}

console.log("🔧 Supabase Admin Config:");
console.log("🔧 URL:", supabaseUrl ? "Configurada" : "MISSING");
console.log("🔧 Service Key Prefijo:", supabaseServiceKey ? supabaseServiceKey.substring(0, 10) + "..." : "MISSING");
console.log("🔧 Usando variable:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : (process.env.SUPABASE_SERVICE_KEY ? "SUPABASE_SERVICE_KEY" : "NINGUNA"));

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});