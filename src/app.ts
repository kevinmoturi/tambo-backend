import express from 'express';
import helloWorldRoutes from './routes/helloWorldRoutes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(express.json());

// Routes
app.use('/api/hello', helloWorldRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;