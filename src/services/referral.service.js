import { supabaseAdmin } from "./supabase.service.js";
import crypto from "crypto";
import { v5 as uuidv5 } from "uuid";

const COMMISSION_ID_NAMESPACE = "7cf9a4f0-0b3b-4b7b-a6fb-e1b291f254b1";

// ---- GENERADOR DE INVITE CODE ----
export function generateInviteCode() {
  const prefix = "TZ-";
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${randomPart}`;
}

// ---- OBTENER ID ÚNICO DE COMISIÓN ----
const getCommissionId = ({ referrerId, buyerId, level, referenciaId, referenciaTipo }) => {
  const key = `commission:${referrerId}:${buyerId}:${level}:${referenciaTipo ?? ''}:${referenciaId ?? ''}`;
  return uuidv5(key, COMMISSION_ID_NAMESPACE);
};

// ---- PROCESAR COMISIONES DE REFERIDOS (NUEVAS REGLAS) ----
// Nivel 1: 5%, Nivel 2: 3%, Nivel 3: 2%
// Las comisiones se pagan SOLO cuando el referido compra un plan
// Las comisiones se suman al saldo_usdt del patrocinador
export const processReferralCommissions = async (
  userId,
  amount,
  plan,
  options = {}
) => {
  try {
    const baseAmount = Number(amount);
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      console.log("⚠️ Monto inválido para comisiones:", amount);
      return { ok: false, reason: 'invalid_amount' };
    }

    // Nuevas tasas de comisión para TradeZoo
    const pct1 = 5; // 5% nivel 1
    const pct2 = 3; // 3% nivel 2
    const pct3 = 2; // 2% nivel 3

    const referenciaId = options?.referenciaId ?? null;
    const referenciaTipo = options?.referenciaTipo ?? "compra_plan";

    // Obtener información del comprador desde perfiles
    const { data: buyer, error: buyerError } = await supabaseAdmin
      .from("perfiles")
      .select("id, mi_codigo, referred_by")
      .eq("id", userId)
      .maybeSingle();

    if (buyerError) {
      console.error("❌ Error obteniendo comprador:", buyerError);
      return { ok: false, reason: 'buyer_not_found' };
    }

    if (!buyer?.id) {
      console.log("⚠️ Comprador no encontrado en perfiles:", userId);
      return { ok: false, reason: 'buyer_not_found' };
    }

    // Si no tiene referido, no hay comisiones
    const level1Id = buyer.referred_by ?? null;
    if (!level1Id) {
      console.log("ℹ️ Usuario sin referido, no se generan comisiones");
      return { ok: true, reason: 'no_referrer' };
    }

    // Procesar comisión Nivel 1
    try {
      const { data: level1User, error: level1Error } = await supabaseAdmin
        .from("perfiles")
        .select("id, mi_codigo, referred_by")
        .eq("id", level1Id)
        .maybeSingle();

      if (level1Error || !level1User?.id) {
        console.error("❌ Error obteniendo nivel 1:", level1Error);
      } else {
        await grantCommission(
          level1Id,
          userId,
          baseAmount,
          pct1,
          1,
          { referenciaId, referenciaTipo }
        );
        console.log(`✅ Comisión nivel 1 (${pct1}%): ${baseAmount * pct1 / 100} USDT para ${level1Id}`);
      }

      // Procesar comisión Nivel 2
      const level2Id = level1User?.referred_by ?? null;
      if (level2Id) {
        const { data: level2User, error: level2Error } = await supabaseAdmin
          .from("perfiles")
          .select("id, mi_codigo, referred_by")
          .eq("id", level2Id)
          .maybeSingle();

        if (level2Error || !level2User?.id) {
          console.error("❌ Error obteniendo nivel 2:", level2Error);
        } else {
          await grantCommission(
            level2Id,
            userId,
            baseAmount,
            pct2,
            2,
            { referenciaId, referenciaTipo }
          );
          console.log(`✅ Comisión nivel 2 (${pct2}%): ${baseAmount * pct2 / 100} USDT para ${level2Id}`);
        }

        // Procesar comisión Nivel 3
        const level3Id = level2User?.referred_by ?? null;
        if (level3Id) {
          const { data: level3User, error: level3Error } = await supabaseAdmin
            .from("perfiles")
            .select("id, mi_codigo")
            .eq("id", level3Id)
            .maybeSingle();

          if (level3Error || !level3User?.id) {
            console.error("❌ Error obteniendo nivel 3:", level3Error);
          } else {
            await grantCommission(
              level3Id,
              userId,
              baseAmount,
              pct3,
              3,
              { referenciaId, referenciaTipo }
            );
            console.log(`✅ Comisión nivel 3 (${pct3}%): ${baseAmount * pct3 / 100} USDT para ${level3Id}`);
          }
        }
      }
    } catch (err) {
      console.error("❌ Error en procesamiento de niveles:", err);
      throw err;
    }

    return { ok: true };

  } catch (err) {
    console.error("❌ Error en processReferralCommissions:", err);
    return { ok: false, error: err.message };
  }
};

// ---- OTORGAR COMISIÓN A UN PATROCINADOR ----
const grantCommission = async (
  referrerId,
  buyerId,
  baseAmount,
  pct,
  level,
  options = {}
) => {
  try {
    const numericPct = Number(pct);
    if (!Number.isFinite(numericPct) || numericPct <= 0) {
      console.log("⚠️ Porcentaje inválido:", pct);
      return;
    }

    const commissionAmount = (Number(baseAmount) * numericPct) / 100;
    if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
      console.log("⚠️ Monto de comisión inválido:", commissionAmount);
      return;
    }

    const referenciaId = options?.referenciaId ?? buyerId;
    const referenciaTipo = options?.referenciaTipo ?? "compra_plan";

    // 1. Registrar en historial_transacciones (si existe la tabla)
    try {
      const { error: historyError } = await supabaseAdmin
        .from("historial_transacciones")
        .insert({
          usuario_id: referrerId,
          tipo: `comision_nivel_${level}`,
          referencia_id: referenciaId,
          referencia_tipo: referenciaTipo,
          monto: commissionAmount,
          created_at: new Date().toISOString(),
        });

      if (historyError) {
        // Si la tabla no existe, ignorar este error
        if (!historyError.message.includes('relation') || !historyError.message.includes('does not exist')) {
          console.error("❌ Error insertando en historial_transacciones:", historyError);
        }
      }
    } catch (historyErr) {
      // Ignorar si la tabla no existe
      console.log("⚠️ Tabla historial_transacciones no disponible, continuando...");
    }

    // 2. Sumar comisión al saldo_usdt del patrocinador usando RPC
    const { error: rpcError } = await supabaseAdmin.rpc("increment_saldo_usdt", {
      p_user_id: referrerId,
      p_amount: commissionAmount,
    });

    if (rpcError) {
      console.error("❌ Error en RPC increment_saldo_usdt:", rpcError);
      // Fallback: actualizar directamente
      const { error: updateError } = await supabaseAdmin
        .from("perfiles")
        .update({
          saldo_usdt: supabaseAdmin.raw(`saldo_usdt + ${commissionAmount}`)
        })
        .eq("id", referrerId);

      if (updateError) {
        console.error("❌ Error en fallback de actualización de saldo:", updateError);
        throw updateError;
      }
    }

    // 3. Registrar en tabla commissions (si existe)
    try {
      const commissionId = getCommissionId({
        referrerId,
        buyerId,
        level,
        referenciaId,
        referenciaTipo,
      });

      const { error: insertCommissionErr } = await supabaseAdmin
        .from("commissions")
        .insert({
          id: commissionId,
          user_id: referrerId,
          from_user_id: buyerId,
          amount: commissionAmount,
          level,
          referencia_tipo: referenciaTipo,
          referencia_id: referenciaId,
          created_at: new Date().toISOString(),
        });

      if (insertCommissionErr) {
        const code = String(insertCommissionErr.code ?? "");
        const msg = String(insertCommissionErr.message ?? "").toLowerCase();
        if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
          console.log("ℹ️ Comisión duplicada, ignorando...");
          return;
        }
        if (!msg.includes('relation') || !msg.includes('does not exist')) {
          console.error("❌ Error insertando en commissions:", insertCommissionErr);
        }
      }
    } catch (commErr) {
      // Ignorar si la tabla no existe
      console.log("⚠️ Tabla commissions no disponible, continuando...");
    }

    console.log(`✅ Comisión nivel ${level} otorgada: ${commissionAmount} USDT a ${referrerId}`);

  } catch (err) {
    console.error("❌ Error en grantCommission:", err);
    throw err;
  }
};
