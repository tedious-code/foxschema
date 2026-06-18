import { setupDb2ClientEnv } from '@foxschema/core';
import { startServer } from './api/server';

setupDb2ClientEnv();
startServer();
