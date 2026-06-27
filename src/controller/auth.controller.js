import crypto from 'crypto';
import { supabaseAdmin } from "../services/supabase.service.js";

// --- FUNCIÓN AUXILIAR: Código criptográfico ---
const generarCodigoUnico = () => {
  const caracteresAzar = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TZ-${caracteresAzar}`;
};

// --- FUNCIÓN AUXILIAR: Delay para evitar race condition ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- ENDPOINT: REGISTRO (Con lógica de referidos y control de errores) ---
export const registerController = async (req, res) => {
  try {
    const { email, password, nombre, codigo_referido } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "El correo y la contraseña son obligatorios." });
    }

    // 1. Contamos cuántos usuarios existen
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;
    
    const totalUsuarios = listData.users.length;
    let referidorId = null;

    // 2. Lógica del Nodo Raíz
    if (totalUsuarios > 0) {
      if (!codigo_referido) {
        return res.status(400).json({ error: "Se requiere un código de invitación para unirte." });
      }

      const { data: referidor, error: refError } = await supabaseAdmin
        .from('perfiles')
        .select('id')
        .eq('mi_codigo', codigo_referido.toUpperCase())
        .single();

      if (refError || !referidor) {
        return res.status(400).json({ error: "El código de invitación no es válido o no existe." });
      }

      referidorId = referidor.id; 
    }

    // 3. Creamos el usuario en Auth
    const nuevoCodigo = generarCodigoUnico();
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: {
          nombre_completo: nombre || "Granjero",
          mi_codigo: nuevoCodigo,
          referido_por: referidorId
        }
      }
    });

    if (authError) throw authError;

    // 4. Esperar a que el Trigger SQL termine de insertar la fila en perfiles
    console.log("⏳ Esperando 500ms para que el Trigger SQL termine...");
    await delay(500);

    // 5. Actualizar la fila en perfiles creada por el Trigger SQL
    const { error: profileError } = await supabaseAdmin
      .from('perfiles')
      .update({
        nombre: nombre || "Granjero",
        referido_por: referidorId
      })
      .eq('id', authData.user.id);

    // Si el UPDATE falla, logueamos pero no detenemos todo (el usuario ya existe en Auth)
    if (profileError) {
      console.error("❌ ERROR actualizando perfiles:", profileError);
      // Intentamos recuperar con un select para ver si la fila existe
      const { data: existingProfile } = await supabaseAdmin
        .from('perfiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();
      
      console.log("🔍 Perfil existente:", existingProfile);
      
      if (!existingProfile) {
        return res.status(500).json({ error: `Error en base de datos: ${profileError.message}` });
      }
    }

    return res.json({ 
      ok: true, 
      message: "¡Cuenta creada con éxito! Tu código es: " + nuevoCodigo,
      user: authData.user 
    });

  } catch (err) {
    console.error("❌ Error general en registro:", err);
    return res.status(400).json({ error: err.message || "Error al crear la cuenta." });
  }
};

// --- ENDPOINT: INICIAR SESIÓN ---
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    return res.json({ 
      ok: true, 
      token: data.session.access_token,
      user: data.user 
    });

  } catch (err) {
    console.error("❌ Error en login:", err);
    return res.status(500).json({ error: "Error interno al iniciar sesión." });
  }
};