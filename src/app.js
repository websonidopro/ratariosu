import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import planesRoutes from './routes/planes.routes.js';
import operarRoutes from './routes/operar.routes.js';
import authRoutes from './routes/auth.routes.js';
import usuarioRoutes from './routes/usuario.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import depositsRoutes from './routes/deposits.routes.js';
import withdrawalsRoutes from './routes/withdrawals.routes.js';
import depositsWebhook from './webhooks/deposits.webhook.js';
import tatumWebhook from './webhooks/tatum.webhook.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;


// ... configuración de CORS ...
app.use(express.json());

app.use(cors({
  origin: ['https://trade-zoo.vercel.app', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas principales
app.use('/api', planesRoutes);
app.use('/api', operarRoutes);
app.use('/api', authRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', walletRoutes);
app.use('/api', depositsRoutes);
app.use('/api', withdrawalsRoutes);

// Webhooks
app.use('/webhooks', depositsWebhook);
app.use('/webhooks', tatumWebhook);     

// Manejadores globales de errores para evitar que el proceso muera
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // No matamos el proceso, solo logueamos el error
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // No matamos el proceso, solo logueamos el error
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});