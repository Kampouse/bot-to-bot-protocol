const express = require('express');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Redis connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Register bot
app.post('/api/v1/register', async (req, res) => {
  const { bot_id, owner_id, platform, pubkey, endpoint } = req.body;
  
  if (!bot_id || !owner_id) {
    return res.status(400).json({ error: 'bot_id and owner_id required' });
  }

  const registration = {
    bot_id,
    owner_id,
    platform: platform || 'unknown',
    pubkey: pubkey || '',
    endpoint: endpoint || '',
    created_at: Date.now(),
    last_seen: Date.now(),
    status: 'online'
  };

  await redis.hset(`bot:registry:${bot_id}`, ...Object.entries(registration).flat());
  
  res.json({ status: 'registered', bot_id });
});

// List all registered bots
app.get('/api/v1/registry', async (req, res) => {
  const keys = await redis.keys('bot:registry:*');
  const bots = [];

  for (const key of keys) {
    const bot = await redis.hgetall(key);
    bots.push(bot);
  }

  res.json({ bots, count: bots.length });
});

// Get bot info
app.get('/api/v1/registry/:bot_id', async (req, res) => {
  const bot = await redis.hgetall(`bot:registry:${req.params.bot_id}`);
  
  if (!bot || Object.keys(bot).length === 0) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  res.json(bot);
});

// Send message to bot
app.post('/api/v1/send', async (req, res) => {
  const { to, from, message, conversation_id, ttl = 3600 } = req.body;

  if (!to || !from || !message) {
    return res.status(400).json({ error: 'to, from, and message required' });
  }

  // Check if recipient exists
  const recipient = await redis.hgetall(`bot:registry:${to}`);
  if (!recipient || Object.keys(recipient).length === 0) {
    return res.status(404).json({ error: 'Recipient bot not registered' });
  }

  // Check if recipient is online
  if (recipient.status === 'offline') {
    return res.status(503).json({ error: 'Recipient bot is offline' });
  }

  const messageObj = {
    version: '1.0',
    message_id: uuidv4(),
    conversation_id: conversation_id || uuidv4(),
    timestamp: Date.now(),
    ttl,
    from: {
      bot_id: from.bot_id || from,
      owner_id: from.owner_id || 'unknown',
      platform: from.platform || 'unknown'
    },
    to: {
      bot_id: to
    },
    message: {
      type: message.type || 'text',
      content: message.content,
      metadata: message.metadata || {}
    }
  };

  // Push to recipient's inbox
  await redis.rpush(`bot:inbox:${to}`, JSON.stringify(messageObj));
  
  // Store in sender's outbox
  await redis.rpush(`bot:outbox:${from.bot_id || from}`, JSON.stringify(messageObj));

  // Update sender's last_seen
  await redis.hset(`bot:registry:${from.bot_id || from}`, 'last_seen', Date.now());

  res.json({ 
    status: 'queued', 
    message_id: messageObj.message_id,
    conversation_id: messageObj.conversation_id 
  });
});

// Get inbox
app.get('/api/v1/inbox/:bot_id', async (req, res) => {
  const { bot_id } = req.params;
  const messages = await redis.lrange(`bot:inbox:${bot_id}`, 0, -1);

  // Parse and filter expired messages
  const now = Date.now();
  const valid = [];
  const expired = [];

  for (const msgStr of messages) {
    const msg = JSON.parse(msgStr);
    if (now - msg.timestamp > msg.ttl * 1000) {
      expired.push(msg.message_id);
    } else {
      valid.push(msg);
    }
  }

  // Remove expired messages
  if (expired.length > 0) {
    await redis.ltrim(`bot:inbox:${bot_id}`, valid.length, -1);
  }

  // Update last_seen
  await redis.hset(`bot:registry:${bot_id}`, 'last_seen', Date.now());

  res.json({ messages: valid, count: valid.length });
});

// Acknowledge message (delete from inbox)
app.post('/api/v1/ack', async (req, res) => {
  const { bot_id, message_id } = req.body;

  if (!bot_id || !message_id) {
    return res.status(400).json({ error: 'bot_id and message_id required' });
  }

  // Get all messages
  const messages = await redis.lrange(`bot:inbox:${bot_id}`, 0, -1);
  
  // Find and remove the message
  for (const msgStr of messages) {
    const msg = JSON.parse(msgStr);
    if (msg.message_id === message_id) {
      await redis.lrem(`bot:inbox:${bot_id}`, 1, msgStr);
      return res.json({ status: 'acked', message_id });
    }
  }

  res.status(404).json({ error: 'Message not found' });
});

// Clear inbox
app.delete('/api/v1/inbox/:bot_id', async (req, res) => {
  await redis.del(`bot:inbox:${req.params.bot_id}`);
  res.json({ status: 'cleared' });
});

// Set bot status
app.post('/api/v1/status', async (req, res) => {
  const { bot_id, status } = req.body;

  if (!bot_id || !status) {
    return res.status(400).json({ error: 'bot_id and status required' });
  }

  if (!['online', 'offline', 'busy'].includes(status)) {
    return res.status(400).json({ error: 'status must be online, offline, or busy' });
  }

  await redis.hset(`bot:registry:${bot_id}`, 'status', status);
  res.json({ status: 'updated', bot_id, new_status: status });
});

// Stats
app.get('/api/v1/stats', async (req, res) => {
  const registryKeys = await redis.keys('bot:registry:*');
  const inboxKeys = await redis.keys('bot:inbox:*');
  
  let totalMessages = 0;
  for (const key of inboxKeys) {
    totalMessages += await redis.llen(key);
  }

  res.json({
    registered_bots: registryKeys.length,
    active_inboxes: inboxKeys.length,
    pending_messages: totalMessages
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot-to-Bot Protocol API running on port ${PORT}`);
});
