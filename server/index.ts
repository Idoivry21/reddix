import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    app: 'Reddix',
    providers: []
  });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Reddix backend listening on http://127.0.0.1:${port}`);
});

