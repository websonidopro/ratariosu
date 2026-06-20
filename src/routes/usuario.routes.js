import express from "express";
import { getPerfilController } from "../controller/usuario.controller.js";

const router = express.Router();

router.get("/usuario/perfil", getPerfilController);

export default router;