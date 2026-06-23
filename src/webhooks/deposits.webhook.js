import express from "express";
import { supabaseAdmin } from "../services/supabase.service.js";

const router = express.Router();

router.post("/deposit/webhook", async (req, res) => {
  try {
    const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
    const enabledRaw = String(process.env.LEGACY_DEPOSIT_WEBHOOK_ENABLED || '').trim().toLowerCase();
    const enabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes';

    if (!enabled) {
      return res.status(404).json({ error: 'Not found' });
    }

    const expectedSecret = String(process.env.LEGACY_DEPOSIT_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret && nodeEnv === 'production') {
      return res.status(500).json({ error: 'Legacy deposits webhook no configurado' });
    }

    if (expectedSecret) {
      const got = String(req.headers['x-webhook-secret'] || '').trim();
      if (!got || got !== expectedSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { tx_hash, amount, address, tag } = req.body;

    if (!tag) return res.status(400).json({ error: "Falta tag" });
    if (!tx_hash) return res.status(400).json({ error: "Falta tx_hash" });

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount inválido" });
    }

    // Adaptado a la nueva columna "address" en lugar de "deposit_address"
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("user_wallets")
      .select("user_id, address") 
      .eq("unique_tag", tag)
      .single();

    if (walletError || !wallet) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    if (address && wallet.address && address !== wallet.address) {
      return res.status(400).json({ error: "Address no coincide" });
    }

    const userId = wallet.user_id;

    // Verificar que no sea un depósito duplicado
    const { data: existingDeposit, error: existingDepositError } = await supabaseAdmin
      .from("depositos")
      .select("id")
      .eq("hash_tx", tx_hash)
      .maybeSingle();

    if (existingDepositError) {
      return res.status(500).json({ error: "Error interno verificando duplicados" });
    }

    if (existingDeposit) {
      return res.json({ ok: true, duplicated: true });
    }

    // Insertar en la nueva estructura de la tabla
    const { error: insertError } = await supabaseAdmin.from("depositos").insert({
      usuario_id: userId,
      monto: parsedAmount,
      hash_tx: tx_hash,
      token: "USDT",
      confirmado: true,
      deposit_tag: tag,
    });

    if (insertError) throw insertError;

    console.log("💰 Intentando actualizar saldo en perfiles para el usuario:", userId);
    console.log("💰 Monto a acreditar:", parsedAmount);

    // Actualizar saldo_usdt en perfiles directamente (sin RPC)
    const { error: balanceError } = await supabaseAdmin
      .from("perfiles")
      .update({
        saldo_usdt: supabaseAdmin.raw(`saldo_usdt + ${parsedAmount}`)
      })
      .eq("id", userId);

    if (balanceError) {
      console.error("❌ Error actualizando saldo:", balanceError);
      throw balanceError;
    }

    console.log("✅ Saldo actualizado exitosamente para usuario:", userId);

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ Webhook deposit error:", e);
    return res.status(500).json({ error: "internal error" });
  }
});

export default router;