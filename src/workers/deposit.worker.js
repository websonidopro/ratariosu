import { supabaseAdmin } from "../services/supabase.service.js";
import { Contract, Interface, JsonRpcProvider, formatUnits, id, zeroPadValue } from "ethers";

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
];

const TRANSFER_TOPIC0 = id("Transfer(address,address,uint256)");

let running = false;
let decimalsCache = null;
let walletMap = new Map();
let lastProcessedBlock = null;

const normalizeAddr = (addr) => {
  const a = String(addr || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(a) ? a : '';
};

const getIgnoredFromAddresses = () => {
  const raw = String(process.env.DEPOSIT_IGNORE_FROM_ADDRESSES || '').trim();
  if (!raw) return new Set();
  const out = new Set();
  for (const part of raw.split(',')) {
    const n = normalizeAddr(part);
    if (n) out.add(n);
  }
  return out;
};

const getEnvNumber = (key, fallback) => {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toTopicAddress = (addr) => {
  try {
    return zeroPadValue(String(addr).toLowerCase(), 32);
  } catch {
    return null;
  }
};

const refreshWalletMap = async () => {
  console.log("🔍 Deposit worker: Refrescando mapa de wallets...");
  
  // Primero inspeccionar el esquema para encontrar el nombre correcto de la columna
  const { data: sample, error: sampleError } = await supabaseAdmin
    .from("user_wallets")
    .select("*")
    .limit(1);

  if (sampleError) {
    console.error("❌ Deposit worker: error inspeccionando user_wallets:", sampleError.message);
    return;
  }

  if (sample && sample.length > 0) {
    console.log("🔍 Deposit worker: Muestra de user_wallets:", Object.keys(sample[0]));
  }

  const { data, error } = await supabaseAdmin
    .from("user_wallets")
    .select("user_id, address") // Usar 'address' ya que deposit_address no existe
    .limit(10000);

  if (error) {
    console.error("❌ Deposit worker: error leyendo user_wallets:", error.message);
    return;
  }

  console.log("🔍 Deposit worker: Wallets encontradas:", data?.length || 0);
  const next = new Map();
  for (const row of data ?? []) {
    const addr = String(row?.address || "").trim().toLowerCase();
    const userId = row?.user_id;
    if (!addr || !userId) continue;
    next.set(addr, userId);
    console.log(`🔍 Deposit worker: Mapeando ${addr.substring(0, 10)}... -> user ${userId}`);
  }
  walletMap = next;
  console.log("🔍 Deposit worker: Mapa actualizado con", walletMap.size, "direcciones");
};

async function processDeposits() {
  if (running) return;
  running = true;

  const rpcUrl = String(process.env.BSC_RPC_URL || "").trim();
  const usdtContract = String(process.env.USDT_CONTRACT_BSC || "").trim();
  const confirmationsRequired = getEnvNumber("CONFIRMATIONS_REQUIRED", 1);
  const scanBatchBlocks = getEnvNumber("DEPOSIT_SCAN_BLOCK_BATCH", 500);
  const topicBatch = getEnvNumber("DEPOSIT_TOPIC_BATCH", 25);

  if (!rpcUrl || !usdtContract) {
    console.error("❌ Deposit worker: faltan variables .env (BSC_RPC_URL, USDT_CONTRACT_BSC)");
    running = false;
    return;
  }

  try {
    if (!walletMap.size) await refreshWalletMap();

    const provider = new JsonRpcProvider(rpcUrl);
    const token = new Contract(usdtContract, ERC20_ABI, provider);

    if (decimalsCache == null) {
      try {
        decimalsCache = Number(await token.decimals());
      } catch {
        decimalsCache = 18;
      }
    }

    const head = await provider.getBlockNumber();
    const targetBlock = Math.max(0, head - confirmationsRequired);

    if (lastProcessedBlock == null) {
      const configuredFrom = getEnvNumber("DEPOSIT_FROM_BLOCK", null);
      if (Number.isFinite(configuredFrom) && configuredFrom >= 0) {
        lastProcessedBlock = configuredFrom;
      } else {
        const fallback = Math.max(0, targetBlock - 2000);
        lastProcessedBlock = fallback;
      }
    }

    if (lastProcessedBlock >= targetBlock) {
      running = false;
      return;
    }

    const fromBlock = lastProcessedBlock + 1;
    const toBlock = Math.min(fromBlock + scanBatchBlocks, targetBlock);
    const iface = new Interface(ERC20_ABI);
    const addresses = Array.from(walletMap.keys());
    const addressTopics = addresses.map(toTopicAddress).filter((t) => typeof t === "string" && t.startsWith("0x"));

    if (!addressTopics.length) {
      lastProcessedBlock = toBlock;
      running = false;
      return;
    }

    const topicChunks = chunkArray(addressTopics, topicBatch);

    for (const chunk of topicChunks) {
      let logs = [];
      try {
        logs = await provider.getLogs({
          address: usdtContract,
          fromBlock,
          toBlock,
          topics: [TRANSFER_TOPIC0, null, chunk],
        });
      } catch (e) {
        continue;
      }

      for (const log of logs) {
        let parsed;
        try { parsed = iface.parseLog(log); } catch { continue; }

        const from = normalizeAddr(parsed?.args?.from);
        const to = normalizeAddr(parsed?.args?.to); // Ya normaliza a minúsculas
        const userId = walletMap.get(to);
        
        if (!userId) {
          console.log(`⚠️ Dirección ${to.substring(0, 10)}... no encontrada en walletMap`);
          continue;
        }

        console.log(`✅ Match encontrado: ${to.substring(0, 10)}... -> user ${userId}`);

        const txHash = String(log.transactionHash || "").trim();
        if (!txHash) continue;

        const value = parsed?.args?.value;
        const amountStr = formatUnits(value, decimalsCache);
        console.log(`💰 Monto formateado: ${amountStr} USDT (decimales: ${decimalsCache})`);
        
        const ignoredFrom = getIgnoredFromAddresses();
        const shouldIgnoreCredit = Boolean(from && ignoredFrom.has(from));

        const { error: insertChainError } = await supabaseAdmin.from("depositos_blockchain").insert({
          user_id: userId, tx_hash: txHash, to_address: to, amount: amountStr, network: "BEP20-USDT", token_symbol: "USDT", status: "confirmed", confirmations: confirmationsRequired,
        });

        if (insertChainError && String(insertChainError.code) !== "23505") continue; // 23505 = duplicado

        const { error: insertDepositError } = await supabaseAdmin.from("depositos").insert({
          user_id: userId, hash_tx: txHash, monto: amountStr, token: "USDT", confirmado: true, network: "BEP20", credited: !shouldIgnoreCredit,
          metadata: { to_address: to, source: shouldIgnoreCredit ? "internal_topup" : "deposit_worker" },
        });

        if (insertDepositError || shouldIgnoreCredit) continue;

        // Acreditar saldo usando SELECT + UPDATE (supabaseAdmin.raw() no está soportado)
        const parsedAmount = Number(amountStr);
        console.log(`💰 Monto formateado: ${parsedAmount} USDT`);
        
        try {
          console.log(`� [DEBUG 1] Iniciando bloque try. Verificando supabaseAdmin:`, !!supabaseAdmin);
          
          console.log(`🔍 [DEBUG 2] Ejecutando SELECT para usuario: ${userId}`);
          const { data: perfil, error: fetchError } = await supabaseAdmin
            .from("perfiles")
            .select("saldo_usdt")
            .eq("id", userId)
            .single();

          console.log(`🔍 [DEBUG 3] SELECT terminado. Error:`, fetchError?.message || 'Ninguno');
          if (fetchError) throw fetchError;

          const saldoAnterior = Number(perfil.saldo_usdt || 0);
          const nuevoSaldo = saldoAnterior + parsedAmount;
          console.log(`� [DEBUG 4] Saldo calculado: ${saldoAnterior} + ${parsedAmount} = ${nuevoSaldo}`);

          console.log(`🔍 [DEBUG 5] Ejecutando UPDATE...`);
          const { error: updateError } = await supabaseAdmin
            .from("perfiles")
            .update({ saldo_usdt: nuevoSaldo })
            .eq("id", userId);

          console.log(`🔍 [DEBUG 6] UPDATE terminado. Error:`, updateError?.message || 'Ninguno');
          if (updateError) throw updateError;

          console.log(`✅ EXITO TOTAL: Depósito de ${parsedAmount} guardado.`);
          console.log(`✅ Depósito acreditado user=${userId} amount=${amountStr} tx=${txHash}`);
        } catch (error) {
          console.error(`❌ CRASH FATAL EN WORKER:`, error.message);
          console.error(`❌ Stack trace:`, error?.stack);
        }
      }
    }
    lastProcessedBlock = toBlock;
  } catch (e) {
    console.error("❌ Deposit worker error:", e?.message || e);
  } finally {
    running = false;
  }
}

const enabled = String(process.env.DEPOSIT_SCAN_ENABLED || "true").toLowerCase();
if (enabled !== "false" && enabled !== "0") {
  const refreshMs = getEnvNumber("DEPOSIT_WALLETS_REFRESH_MS", 30000);
  const scanMs = getEnvNumber("DEPOSIT_SCAN_INTERVAL_MS", 15000);
  console.log("🔧 Worker de depósitos iniciado...");
  refreshWalletMap();
  setInterval(refreshWalletMap, refreshMs);
  setInterval(processDeposits, scanMs);
}