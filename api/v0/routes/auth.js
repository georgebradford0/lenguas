const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const LoginCode = require('../models/LoginCode');

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const FROM_EMAIL = 'noreply@lenguas.directto.link';

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /auth/login — send a 6-digit login code via SES
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    const userId = hashEmail(email);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await LoginCode.deleteMany({ userId });
    await LoginCode.create({ userId, code, expiresAt });

    await sesClient.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [email.toLowerCase().trim()] },
      Message: {
        Subject: { Data: 'Your Lenguas login code' },
        Body: {
          Text: {
            Data: `Your login code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you did not request this, you can ignore this email.`,
          },
        },
      },
    }));

    console.log(`Login code sent to ${email} (userId: ${userId.slice(0, 8)}...)`);
    res.json({ message: 'Login code sent' });

  } catch (error) {
    console.error('Error sending login code:', error);
    res.status(500).json({ error: 'Failed to send login code' });
  }
});

// POST /auth/verify — verify code and return JWT
router.post('/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const userId = hashEmail(email);
    const record = await LoginCode.findOne({ userId, code: String(code) });

    if (!record || record.expiresAt < new Date()) {
      if (record) await LoginCode.deleteOne({ _id: record._id });
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    await LoginCode.deleteOne({ _id: record._id });

    const token = jwt.sign(
      { userId, email: email.toLowerCase().trim() },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`User verified: ${email} (userId: ${userId.slice(0, 8)}...)`);
    res.json({ token, userId });

  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

module.exports = router;
