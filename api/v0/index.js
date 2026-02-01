const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const progressRoutes = require('./routes/progress');
const speakRoutes = require('./routes/speak');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/language-app';

app.use(cors());
app.use(express.json());

app.use('/progress', progressRoutes);
app.use('/speak', speakRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

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
