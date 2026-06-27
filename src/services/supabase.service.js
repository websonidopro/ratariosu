import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
// Cliente ADMIN para operaciones de base de datos (bypass RLS)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
// Cliente AUTH para operaciones de autenticación (respeta RLS)
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Faltan credenciales de Supabase en el archivo .env");
}

console.log("🔧 Supabase Admin Config:");
console.log("🔧 URL:", supabaseUrl ? "Configurada" : "MISSING");
console.log("🔧 Service Key Prefijo:", supabaseServiceKey ? supabaseServiceKey.substring(0, 10) + "..." : "MISSING");
console.log("🔧 Usando variable:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : (process.env.SUPABASE_SERVICE_KEY ? "SUPABASE_SERVICE_KEY" : "NINGUNA"));

console.log("🔧 Supabase Auth Client Config:");
console.log("🔧 Anon Key Prefijo:", supabaseAnonKey ? supabaseAnonKey.substring(0, 10) + "..." : "MISSING");

// Cliente ADMIN: USO EXCLUSIVO PARA BASE DE DATOS (.from().select/update/insert)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Cliente AUTH: USO EXCLUSIVO PARA AUTH (.auth.signUp, .auth.signInWithPassword)
export const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});