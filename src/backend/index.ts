import { setupDb2ClientEnv } from './providers/db2/db2.env';
import { startServer } from './api/server';

setupDb2ClientEnv();
startServer();
