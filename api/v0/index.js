// Local bare-node dev reads the repo-root .env. In Docker, env vars come
// from docker-compose; this path won't exist and dotenv silently no-ops.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const speakRoutes = require('./routes/speak');
const translateRoutes = require('./routes/translate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: [
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:19006',
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    ],
    credentials: true,
  })
);
app.use((req, res, next) => {
  if (!req.headers.origin) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  next();
});
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/speak', speakRoutes);
app.use('/translate', translateRoutes);

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
