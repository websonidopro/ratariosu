import { supabaseAdmin } from "../services/supabase.service.js";
import { Contract, JsonRpcProvider, HDNodeWallet, Wallet, parseUnits, isAddress, formatUnits } from "ethers";

const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
];

let running = false;
let decimalsCache = null;
let hdBaseNode = null;

const getEnvNumber = (key, fallback) => {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const refundWithdrawalToEarnings = async (retId) => {
  try { await supabaseAdmin.rpc("refund_withdrawal_to_earnings", { p_retiro_id: retId }); } catch {}
};

const markFailed = async (retId) => {
  const { data } = await supabaseAdmin.from("retiros").update({ estado: "fallido", procesado_en: new Date().toISOString() })
    .eq("id", retId).neq("estado", "fallido").neq("estado", "confirmado").select("id");
  return Array.isArray(data) && data.length > 0;
};

const markConfirmed = async (retId) => {
  await supabaseAdmin.from("retiros").update({ estado: "confirmado" }).eq("id", retId).in("estado", ["enviado", "aprobado"]);
};

const markSent = async (retId, txHash) => {
  await supabaseAdmin.from("retiros").update({ estado: "enviado", tx_hash: txHash, procesado_en: new Date().toISOString() })
    .eq("id", retId).eq("estado", "aprobado");
};

const ensureApproved = async (retId) => {
  await supabaseAdmin.from("retiros").update({ estado: "aprobado" }).eq("id", retId).eq("estado", "pendiente");
};

const reconcileSentWithdrawals = async (provider, confirmationsRequired) => {
  const { data: rows } = await supabaseAdmin.from("retiros").select("id, tx_hash").eq("estado", "enviado").not("tx_hash", "is", null).order("procesado_en", { ascending: true }).limit(10);
  for (const r of rows || []) {
    try {
      const receipt = await provider.getTransactionReceipt(r.tx_hash);
      if (!receipt || Number(receipt.confirmations || 0) < confirmationsRequired) continue;
      if (receipt.status === 1) await markConfirmed(r.id);
      else if (await markFailed(r.id)) await refundWithdrawalToEarnings(r.id);
    } catch {}
  }
};

async function processWithdrawals() {
  if (running) return;
  running = true;

  const rpcUrl = String(process.env.BSC_RPC_URL || '').trim();
  const usdtContract = String(process.env.USDT_CONTRACT_BSC || '').trim();
  const confirmationsRequired = getEnvNumber("CONFIRMATIONS_REQUIRED", 1);
  const mnemonic = String(process.env.BSC_MNEMONIC || '').trim();
  const privateKey = String(process.env.BSC_PRIVATE_KEY || '').trim();
  const derivationPath = String(process.env.BSC_DERIVATION_PATH || "m/44'/60'/0'/0").trim();

  console.log("🔍 Debug Env Retiros:", { 
    RPC: !!rpcUrl, 
    RPC_Value: rpcUrl ? rpcUrl.substring(0, 20) + "..." : "MISSING",
    USDT: !!usdtContract,
    USDT_Value: usdtContract ? usdtContract.substring(0, 20) + "..." : "MISSING",
    MNEMONIC: !!mnemonic,
    MNEMONIC_Value: mnemonic ? mnemonic.substring(0, 10) + "..." : "MISSING",
    PRIVATE_KEY: !!privateKey,
    PRIVATE_KEY_Value: privateKey ? privateKey.substring(0, 10) + "..." : "MISSING"
  });

  // Usar PRIVATE_KEY si MNEMONIC no está disponible
  const authCredential = mnemonic || privateKey;

  if (!rpcUrl || !usdtContract || !authCredential) {
    console.error("❌ Worker retiros: faltan variables .env (BSC_RPC_URL, USDT_CONTRACT_BSC, BSC_MNEMONIC o BSC_PRIVATE_KEY)");
    running = false;
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const tokenRead = new Contract(usdtContract, ERC20_ABI, provider);

  if (decimalsCache == null) {
    try { decimalsCache = Number(await tokenRead.decimals()); } catch { decimalsCache = 18; }
  }

  if (hdBaseNode == null) {
    try {
      // Usar PRIVATE_KEY si está disponible, sino MNEMONIC
      if (privateKey) {
        hdBaseNode = new Wallet(privateKey);
      } else {
        const root = HDNodeWallet.fromPhrase(mnemonic, undefined, 'm');
        const normalizedPath = derivationPath.startsWith('m/') ? derivationPath : `m/${derivationPath.replace(/^\/+/, '')}`;
        hdBaseNode = root.derivePath(normalizedPath);
      }
    } catch (e) {
      console.error("❌ Error inicializando wallet:", e?.message || e);
      running = false;
      return;
    }
  }

  await reconcileSentWithdrawals(provider, confirmationsRequired);

  // Consulta limpia y directa a Supabase (reemplaza el RPC fallido)
  const { data: rows, error } = await supabaseAdmin.from("retiros")
    .select("id, user_id, monto, red, direccion, total, estado")
    .in("estado", ["pendiente", "aprobado"]).limit(1);

  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) {
    running = false;
    return;
  }

  await ensureApproved(row.id);
  console.log(`⚙️ Procesando retiro => ID: ${row.id}`);

  if (String(row.red || '').toUpperCase() !== 'BEP20-USDT') {
    running = false;
    return;
  }

  const to = String(row.direccion || '').trim();
  if (!isAddress(to)) {
    if (await markFailed(row.id)) await refundWithdrawalToEarnings(row.id);
    running = false;
    return;
  }

  let senderWallet = null;
  try {
    const { data: walletRow } = await supabaseAdmin.from('user_wallets').select('address, unique_tag').eq('user_id', row.user_id).single();
    const idx = Number.parseInt(String(walletRow?.unique_tag ?? ''), 10);
    const derived = hdBaseNode.deriveChild(idx);
    senderWallet = derived.connect(provider);
  } catch (e) {
    if (await markFailed(row.id)) await refundWithdrawalToEarnings(row.id);
    running = false;
    return;
  }

  try {
    const units = parseUnits(String(row.monto), decimalsCache);
    const token = new Contract(usdtContract, ERC20_ABI, senderWallet);
    const tx = await token.transfer(to, units);
    await markSent(row.id, tx.hash);
    console.log(`📤 Enviado tx: ${tx.hash}`);
  } catch (e) {
    console.error('❌ Error enviando retiro:', e?.message || e);
    if (await markFailed(row.id)) await refundWithdrawalToEarnings(row.id);
  } finally {
    running = false;
  }
}

setInterval(processWithdrawals, 10000);
console.log("🔧 Worker de retiros iniciado...");