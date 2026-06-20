import crypto from 'crypto';
import { supabaseAdmin } from "../services/supabase.service.js";

// --- FUNCIÓN AUXILIAR: Código criptográfico ---
const generarCodigoUnico = () => {
  const caracteresAzar = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TZ-${caracteresAzar}`;
};

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

    // 4. Guardamos en la tabla pública perfiles (CON CONTROL DE ERRORES REAL)
    const { error: profileError } = await supabaseAdmin.from('perfiles').insert([{
      id: authData.user.id,
      nombre: nombre || "Granjero",
      email: email,
      mi_codigo: nuevoCodigo,
      referido_por: referidorId
    }]);

    // Si la tabla falla, detenemos todo y avisamos qué pasó en la terminal
    if (profileError) {
      console.error("❌ ERROR CRÍTICO EN TABLA PERFILES:", profileError);
      return res.status(500).json({ error: `Error en base de datos: ${profileError.message}` });
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