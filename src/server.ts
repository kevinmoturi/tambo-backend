import app from './app';
import config from './config/config';
import connectDB from './config/database';

connectDB().then(() => {
  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});