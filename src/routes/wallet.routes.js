import express from "express";
import { getWalletInfo, createDepositAddress } from "../controller/wallet.controller.js";

const router = express.Router();

// Ruta para ver el saldo y la dirección (si ya existe)
router.get("/wallet/info", getWalletInfo);

// Ruta para generar una nueva dirección BEP-20
router.post("/wallet/deposit", createDepositAddress);

export default router;