import express from "express";
import { authMiddleware } from "../middlewares/auth.js";
import { getPlanesController, buyPlanController } from "../controller/plan.controller.js";

const router = express.Router();

// Ruta pública para cargar los animales en el Dashboard
router.get("/planes", getPlanesController);

// Ruta protegida para efectuar la compra
router.post("/planes/comprar", authMiddleware, buyPlanController);

export default router;