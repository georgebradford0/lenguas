require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const progressRoutes = require('./routes/progress');
const speakRoutes = require('./routes/speak');
const translateRoutes = require('./routes/translate');
const wordsRoutes = require('./routes/words');
const generateTaskRoutes = require('./routes/generateTask');
const authRoutes = require('./routes/auth');
const requireAuth = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/language-app';

app.use(
  cors({
    origin: [
      'http://localhost:8080',
      'http://localhost:3000',
      'http://localhost:19006',
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
    ],
    // Allow requests with no origin (e.g., React Native on physical devices)
    credentials: true,
  })
);
app.use((req, res, next) => {
  if (!req.headers.origin) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  next();
});
app.use(express.json({ limit: '10mb' }));

app.use('/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/progress', requireAuth, progressRoutes);
app.use('/speak', requireAuth, speakRoutes);
app.use('/translate', requireAuth, translateRoutes);
app.use('/words', requireAuth, wordsRoutes);
app.use('/', requireAuth, generateTaskRoutes);

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
