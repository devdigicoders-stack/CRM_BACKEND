import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { seedSuperAdmin } from './config/seeder.js';

const startServer = async () => {
  try {
    // Connect to database
    await connectDB();
    
    // Seed default Super Admin if needed
    await seedSuperAdmin();

    app.listen(env.PORT, () => {
      console.log(`🚀 Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error.message);
    process.exit(1);
  }
};

startServer();
