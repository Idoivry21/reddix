import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { buildCorsOptions } from './cors';
import { csrfGuard } from './csrfGuard';
import { createRoutes } from './routes';
import { createStorage } from './storage';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.REDDIX_DATA_DIR ?? path.join(process.cwd(), '.reddix-data');
const storage = createStorage({ baseDir: dataDir });

app.use(cors(buildCorsOptions(process.env)));
app.use(csrfGuard);
app.use(express.json({ limit: '2mb' }));
app.use('/api', createRoutes({ storage, dataDir }));

app.listen(port, '127.0.0.1', () => {
  console.log(`Reddix backend listening on http://127.0.0.1:${port}`);
});
