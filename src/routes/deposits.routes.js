import express from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { supabaseAdmin } from "../services/supabase.service.js";
import {
  deriveChildAddress,
  getNextDerivationIndex,
} from "../services/hdwallet.service.js";

const router = express.Router();

/**
 * ============================================
 * OBTENER HISTORIAL DE DEPÓSITOS DEL USUARIO
 * ============================================
 */
router.get("/deposits/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { data, error } = await supabaseAdmin
      .from("historial_transacciones")
      .select("*")
      .eq("usuario_id", userId)
      .eq("tipo", "deposito")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      // Si la tabla no existe, retornar array vacío
      if (error.message.includes('relation') || error.message.includes('does not exist')) {
        return res.json([]);
      }
      throw error;
    }

    return res.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error("❌ Error en GET /deposits/me:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * ============================================
 * GENERAR DIRECCIÓN DE DEPÓSITO
 * ============================================
 */
router.post("/deposit/address", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const network = process.env.DEPOSIT_NETWORK ?? "BEP20-USDT";

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("user_wallets")
      .select("deposit_address, network")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      console.error("❌ Error consultando wallet existente:", existingError);
      // Continuar, intentaremos crear una nueva
    }

    if (existing?.deposit_address) {
      return res.json({
        ok: true,
        address: existing.deposit_address,
        network: existing.network ?? network,
      });
    }

    // Generar nueva dirección
    let nextIndex;
    try {
      nextIndex = await getNextDerivationIndex(supabaseAdmin);
    } catch (dbError) {
      console.error("❌ Error obteniendo índice de derivación:", dbError);
      return res.status(500).json({ error: "Error al generar dirección de depósito" });
    }

    let newWallet;
    try {
      newWallet = deriveChildAddress(nextIndex);
    } catch (deriveError) {
      console.error("❌ Error derivando dirección:", deriveError);
      return res.status(500).json({ error: "Error al generar dirección de depósito" });
    }

    const { error: insertError } = await supabaseAdmin.from("user_wallets").insert([{
      user_id: userId,
      deposit_address: newWallet.address,
      unique_tag: String(nextIndex),
      network,
    }]);

    if (insertError) {
      console.error("❌ Error insertando wallet:", insertError);
      return res.status(500).json({ error: "Error al guardar dirección de depósito" });
    }

    return res.json({
      ok: true,
      address: newWallet.address,
      network,
    });
  } catch (error) {
    console.error("❌ Error en POST /deposit/address:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * ============================================
 * WEBHOOK PARA DEPÓSITOS BLOCKCHAIN
 * ============================================
 */
router.post("/deposits/webhook", async (req, res) => {
  try {
    const expectedSecret = String(process.env.DEPOSITS_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      return res.status(500).json({ error: 'Deposits webhook no configurado' });
    }
    if (expectedSecret) {
      const got = String(req.headers['x-webhook-secret'] || '').trim();
      if (!got || got !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const {
      txHash,
      amount,
      toAddress,
      token,
      network: networkParam,
    } = req.body;

    if (!txHash || amount == null || !toAddress) {
      return res.status(400).json({ error: "Campos faltantes" });
    }

    const normalizedTxHash = String(txHash).trim();
    if (!/^0x[a-f0-9]{64}$/i.test(normalizedTxHash)) {
      return res.status(400).json({ error: 'txHash inválido' });
    }

    const normalizedNetwork = networkParam ? String(networkParam).trim().toUpperCase() : null;
    if (normalizedNetwork && !normalizedNetwork.startsWith("BEP20")) {
      return res.status(400).json({ error: "Red no soportada" });
    }

    const normalizedToAddress = String(toAddress).trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalizedToAddress)) {
      return res.status(400).json({ error: "Dirección inválida" });
    }

    // Buscar wallet por dirección
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("user_wallets")
      .select("user_id, network")
      .eq("deposit_address", normalizedToAddress)
      .limit(1)
      .maybeSingle();

    if (walletError) throw walletError;
    if (!wallet?.user_id) {
      return res.status(404).json({ error: "Wallet no encontrada" });
    }

    const resolvedUserId = wallet.user_id;

    const amountStr = String(amount ?? "").trim();
    if (!/^(\d+)(\.\d+)?$/.test(amountStr)) {
      return res.status(400).json({ error: "amount inválido" });
    }

    const parsedAmount = Number(amountStr);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "amount inválido" });
    }

    // Verificar si ya existe esta transacción
    const { data: existingTx, error: existingTxError } = await supabaseAdmin
      .from("depositos_blockchain")
      .select("id")
      .eq("tx_hash", normalizedTxHash)
      .eq("network", "BEP20-USDT")
      .maybeSingle();

    if (existingTxError) throw existingTxError;
    if (existingTx) {
      return res.status(200).json({ ok: true, duplicated: true });
    }

    // Registrar TX en blockchain
    const { error: insertTxError } = await supabaseAdmin
      .from("depositos_blockchain")
      .insert({
        user_id: resolvedUserId,
        tx_hash: normalizedTxHash,
        to_address: normalizedToAddress,
        amount: amountStr,
        network: "BEP20-USDT",
        token_symbol: token || "USDT",
        status: "confirmed",
        confirmations: 0,
      });

    if (insertTxError) {
      const code = String(insertTxError.code ?? "");
      if (code === "23505") {
        return res.status(200).json({ ok: true, duplicated: true });
      }
      throw insertTxError;
    }

    // Verificar si se debe acreditar automáticamente
    const creditEnabledRaw = String(process.env.DEPOSITS_WEBHOOK_CREDIT_ENABLED || '').trim().toLowerCase();
    const creditEnabled = creditEnabledRaw === '1' || creditEnabledRaw === 'true' || creditEnabledRaw === 'yes';
    
    if (!creditEnabled) {
      return res.json({
        ok: true,
        credited: false,
        recorded: true,
      });
    }

    // Registrar en historial_transacciones
    try {
      await supabaseAdmin.from("historial_transacciones").insert({
        usuario_id: resolvedUserId,
        tipo: "deposito",
        referencia_id: normalizedTxHash,
        referencia_tipo: "blockchain",
        monto: parsedAmount,
        created_at: new Date().toISOString(),
      });
    } catch (historyError) {
      console.log("⚠️ Tabla historial_transacciones no disponible, continuando...");
    }

    // Actualizar saldo_usdt en perfiles
    console.log("💰 Intentando actualizar saldo en perfiles para el usuario:", resolvedUserId);
    console.log("💰 Monto a acreditar:", parsedAmount);

    const { error: balanceError } = await supabaseAdmin
      .from("perfiles")
      .update({
        saldo_usdt: supabaseAdmin.raw(`saldo_usdt + ${parsedAmount}`)
      })
      .eq("id", resolvedUserId);

    if (balanceError) {
      console.error("❌ Error actualizando saldo:", balanceError);
      throw balanceError;
    }

    console.log("✅ Saldo actualizado exitosamente para usuario:", resolvedUserId);

    // Obtener nuevo saldo
    const { data: userRow, error: userError } = await supabaseAdmin
      .from("perfiles")
      .select("saldo_usdt")
      .eq("id", resolvedUserId)
      .maybeSingle();

    if (userError) {
      console.error("❌ Error obteniendo saldo actualizado:", userError);
    }

    return res.json({
      ok: true,
      credited: amountStr,
      newBalance: userRow?.saldo_usdt ?? null,
    });
  } catch (error) {
    console.error("❌ Error en /deposits/webhook:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
