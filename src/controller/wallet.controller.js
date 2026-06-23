import { supabaseAdmin } from "../services/supabase.service.js";
import { deriveChildAddress, getNextDerivationIndex } from "../services/hdwallet.service.js";
import { verifyToken } from "../utils/verifyToken.js";

export const getWalletInfo = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const auth = await verifyToken(token);

    if (!auth.user) {
      return res.status(auth.status).json(auth.body);
    }

    const user = auth.user;

    const { data: walletData, error: walletError } = await supabaseAdmin
      .from('user_wallets')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (walletError) {
      console.error("Error consultando user_wallets:", walletError);
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('saldo_usdt, ganancias_usdt')
      .eq('id', user.id)
      .maybeSingle();

    if (perfilError) {
      console.error("Error consultando perfil:", perfilError);
    }

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
    console.error("❌ Error en getWalletInfo:", err);
    return res.status(500).json({ error: "Error interno al consultar la cartera" });
  }
};

// 2. Generar nueva dirección de depósito BEP-20
export const createDepositAddress = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const auth = await verifyToken(token);

    if (!auth.user) {
      return res.status(auth.status).json(auth.body);
    }

    const user = auth.user;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('user_wallets')
      .select('address')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingError) {
      console.error("Error consultando wallet existente:", existingError);
    }

    if (existing?.address) {
      return res.json({ ok: true, red: 'BEP20-USDT', direccion: existing.address });
    }

    let nextIndex;
    try {
      nextIndex = await getNextDerivationIndex(supabaseAdmin);
    } catch (dbError) {
      console.error("Error obteniendo índice de derivación:", dbError);
      return res.status(500).json({ error: "Error al obtener el siguiente índice de wallet." });
    }

    let newWallet;
    try {
      newWallet = deriveChildAddress(nextIndex);
    } catch (deriveError) {
      console.error("Error derivando dirección:", deriveError);
      return res.status(500).json({ error: "Error al generar la dirección de depósito." });
    }

    const { error: insertError } = await supabaseAdmin.from('user_wallets').insert([{
      user_id: user.id,
      address: newWallet.address,
      unique_tag: String(nextIndex)
    }]);

    if (insertError) {
      console.error("Error insertando wallet:", insertError);
      return res.status(500).json({ error: "No se pudo guardar la dirección de depósito." });
    }

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