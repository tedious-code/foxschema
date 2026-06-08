import { setupDb2ClientEnv } from './cores/db2-env';
import { startServer } from './api/server';

setupDb2ClientEnv();
startServer();
