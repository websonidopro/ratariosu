import express from "express";
import { loginController, registerController } from "../controller/auth.controller.js";

const router = express.Router();

// Estas rutas son públicas porque los usuarios aún no tienen token
router.post("/auth/registro", registerController);
router.post("/auth/login", loginController);

export default router;