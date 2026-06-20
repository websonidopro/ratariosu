import { supabaseAdmin } from "../services/supabase.service.js";
import { deriveChildAddress, getNextDerivationIndex } from "../services/hdwallet.service.js";

// 1. Obtener la información de la billetera (Saldo y Dirección)
export const getWalletInfo = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) throw error;

    // Buscamos si ya tiene una dirección generada
    const { data: walletData } = await supabaseAdmin
      .from('user_wallets')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Buscamos el saldo (asumiendo que está en la tabla perfiles o calculando desde el ledger)
    // Para este paso, traemos el saldo base de perfiles
    const { data: perfil } = await supabaseAdmin
      .from('perfiles')
      .select('saldo_usdt, ganancias_usdt')
      .eq('id', user.id)
      .single();

    return res.json({
      ok: true,
      balance: perfil?.saldo_usdt || 0,
      saldo_ganancias: perfil?.ganancias_usdt || 0,
      deposit_info: walletData ? {
        red: 'BEP20-USDT',
        direccion: walletData.address
      } : null
    });
  } catch (err) {
    return res.status(401).json({ error: "No autorizado" });
  }
};

// 2. Generar nueva dirección de depósito BEP-20
export const createDepositAddress = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) throw error;

    // Verificamos si ya tiene una para no duplicar
    const { data: existing } = await supabaseAdmin
      .from('user_wallets')
      .select('address')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      return res.json({ ok: true, red: 'BEP20-USDT', direccion: existing.address });
    }

    // Generamos la nueva billetera usando tu servicio
    const nextIndex = await getNextDerivationIndex(supabaseAdmin);
    const newWallet = deriveChildAddress(nextIndex);

    // Guardamos en la base de datos
    await supabaseAdmin.from('user_wallets').insert([{
      user_id: user.id,
      address: newWallet.address,
      unique_tag: String(nextIndex)
    }]);

    return res.json({ 
      ok: true, 
      red: 'BEP20-USDT', 
      direccion: newWallet.address 
    });

  } catch (err) {
    console.error("❌ Error generando wallet:", err);
    return res.status(500).json({ error: "Error al generar la dirección de depósito." });
  }
};