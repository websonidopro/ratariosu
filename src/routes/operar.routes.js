import express from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { operarDiarioController } from "../controller/operar.controller.js";

const router = express.Router();

// Endpoint seguro para el trading diario
router.post("/operar/reclamar", authMiddleware, operarDiarioController);

export default router;