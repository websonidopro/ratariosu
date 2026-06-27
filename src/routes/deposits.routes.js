import express from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { supabaseAdmin } from "../services/supabase.service.js";
import {
  deriveChildAddress,
  getNextDerivationIndex,
} from "../services/hdwallet.service.js";
import { Contract, JsonRpcProvider, formatUnits, Interface, id, zeroPadValue } from "ethers";

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
      .eq("user_id", userId)
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
  console.log("💰💰💰 RECIBIENDO NOTIFICACIÓN DE PAGO WEBHOOK");
  console.log("💰💰💰 BODY COMPLETO:", JSON.stringify(req.body, null, 2));
  console.log("💰💰💰 HEADERS:", JSON.stringify(req.headers, null, 2));
  
  try {
    const expectedSecret = String(process.env.DEPOSITS_WEBHOOK_SECRET || '').trim();
    console.log("💰💰💰 WEBHOOK SECRET CONFIGURADO:", expectedSecret ? "SI" : "NO");
    
    if (!expectedSecret && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      console.log("❌ WEBHOOK NO CONFIGURADO EN PRODUCCIÓN");
      return res.status(500).json({ error: 'Deposits webhook no configurado' });
    }
    if (expectedSecret) {
      const got = String(req.headers['x-webhook-secret'] || '').trim();
      console.log("💰💰💰 SECRET RECIBIDO:", got ? got.substring(0, 10) + "..." : "MISSING");
      if (!got || got !== expectedSecret) {
        console.log("❌ SECRET INCORRECTO");
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
        user_id: resolvedUserId,
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

/**
 * ============================================
 * ENDPOINT DE RECUPERACIÓN DE DEPÓSITOS
 * ============================================
 */
router.post("/depositos/reclamar", authMiddleware, async (req, res) => {
  try {
    const { txHash } = req.body;
    const userId = req.user?.id;

    if (!txHash) {
      return res.status(400).json({ error: "El hash de transacción es requerido" });
    }

    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    console.log("💰 Recuperación de depósito solicitada:", { userId, txHash });

    // Configuración de blockchain
    const rpcUrl = String(process.env.BSC_RPC_URL || "").trim();
    const usdtContract = String(process.env.USDT_CONTRACT_BSC || "").trim();

    if (!rpcUrl || !usdtContract) {
      return res.status(500).json({ error: "Configuración de blockchain no disponible" });
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const ERC20_ABI = [
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "function decimals() view returns (uint8)",
    ];
    const TRANSFER_TOPIC0 = id("Transfer(address,address,uint256)");

    // 1. Obtener el recibo de la transacción
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return res.status(404).json({ error: "Transacción no encontrada" });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({ error: "La transacción falló" });
    }

    // 2. Verificar que la transacción interactuó con el contrato USDT correcto
    if (receipt.to?.toLowerCase() !== usdtContract.toLowerCase()) {
      return res.status(400).json({ error: "La transacción no es al contrato USDT correcto" });
    }

    // 3. Obtener la wallet del usuario
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("user_wallets")
      .select("address")
      .eq("user_id", userId)
      .maybeSingle();

    if (walletError || !wallet?.address) {
      return res.status(404).json({ error: "Wallet del usuario no encontrada" });
    }

    const userAddress = wallet.address.toLowerCase();

    // 4. Parsear logs para encontrar el evento Transfer
    const iface = new Interface(ERC20_ABI);
    let transferLog = null;
    let amount = null;

    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() === TRANSFER_TOPIC0.toLowerCase()) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.args?.to?.toLowerCase() === userAddress) {
            transferLog = log;
            amount = parsed.args.value;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!transferLog || !amount) {
      return res.status(400).json({ error: "No se encontró transferencia a la wallet del usuario" });
    }

    // 5. Obtener decimales del token
    const tokenContract = new Contract(usdtContract, ERC20_ABI, provider);
    const decimals = await tokenContract.decimals();
    const amountStr = formatUnits(amount, decimals);
    const parsedAmount = Number(amountStr);

    console.log(`💰 Transferencia válida encontrada: ${parsedAmount} USDT`);

    // 6. Verificar si ya fue procesada
    const { data: existingTx, error: existingError } = await supabaseAdmin
      .from("depositos_blockchain")
      .select("id")
      .eq("tx_hash", txHash)
      .maybeSingle();

    if (existingTx) {
      return res.status(400).json({ error: "Esta transacción ya fue procesada" });
    }

    // 7. Registrar en depositos_blockchain
    const { error: insertError } = await supabaseAdmin.from("depositos_blockchain").insert({
      user_id: userId,
      tx_hash: txHash,
      to_address: userAddress,
      amount: amountStr,
      network: "BEP20-USDT",
      token_symbol: "USDT",
      status: "confirmed",
      confirmations: receipt.confirmations || 0,
    });

    if (insertError) {
      console.error("❌ Error insertando en depositos_blockchain:", insertError);
      return res.status(500).json({ error: "Error al registrar la transacción" });
    }

    // 8. Acreditar saldo usando SELECT + UPDATE
    try {
      console.log(`💰 Consultando saldo actual para usuario ${userId}`);
      
      const { data: perfil, error: fetchError } = await supabaseAdmin
        .from("perfiles")
        .select("saldo_usdt")
        .eq("id", userId)
        .single();

      if (fetchError) throw fetchError;

      const saldoAnterior = Number(perfil.saldo_usdt || 0);
      const nuevoSaldo = saldoAnterior + parsedAmount;

      console.log(`💰 Actualizando saldo: ${saldoAnterior} -> ${nuevoSaldo}`);

      const { error: updateError } = await supabaseAdmin
        .from("perfiles")
        .update({ saldo_usdt: nuevoSaldo })
        .eq("id", userId);

      if (updateError) throw updateError;

      console.log(`✅ Depósito recuperado exitosamente. Nuevo saldo: ${nuevoSaldo}`);

      return res.json({
        ok: true,
        message: "Depósito recuperado exitosamente",
        amount: parsedAmount,
        newBalance: nuevoSaldo,
      });
    } catch (error) {
      console.error("❌ Error actualizando saldo:", error);
      return res.status(500).json({ error: "Error al acreditar el saldo" });
    }
  } catch (error) {
    console.error("❌ Error en /depositos/reclamar:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
