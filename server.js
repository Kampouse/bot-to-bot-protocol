const express = require('express');

const app = express();
app.use(express.json());

// In-memory storage (for testing without Redis)
const registry = new Map();
const inboxes = new Map();
const outboxes = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), mode: 'memory' });
});

// Register bot
app.post('/api/v1/register', (req, res) => {
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

  registry.set(bot_id, registration);

  res.json({ status: 'registered', bot_id });
});

// List all registered bots
app.get('/api/v1/registry', (req, res) => {
  const bots = Array.from(registry.values());
  res.json({ bots, count: bots.length });
});

// Get bot info
app.get('/api/v1/registry/:bot_id', (req, res) => {
  const bot = registry.get(req.params.bot_id);

  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  res.json(bot);
});

// Send message to bot
app.post('/api/v1/send', (req, res) => {
  const { to, from, message, conversation_id, ttl = 3600 } = req.body;

  if (!to || !from || !message) {
    return res.status(400).json({ error: 'to, from, and message required' });
  }

  // Check if recipient exists
  const recipient = registry.get(to);
  if (!recipient) {
    return res.status(404).json({ error: 'Recipient bot not registered' });
  }

  // Check if recipient is online
  if (recipient.status === 'offline') {
    return res.status(503).json({ error: 'Recipient bot is offline' });
  }

  const messageObj = {
    version: '1.0',
    message_id: require('uuid').v4(),
    conversation_id: conversation_id || require('uuid').v4(),
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
  if (!inboxes.has(to)) {
    inboxes.set(to, []);
  }
  inboxes.get(to).push(messageObj);

  // Store in sender's outbox
  const senderId = from.bot_id || from;
  if (!outboxes.has(senderId)) {
    outboxes.set(senderId, []);
  }
  outboxes.get(senderId).push(messageObj);

  // Update sender's last_seen
  if (registry.has(senderId)) {
    registry.get(senderId).last_seen = Date.now();
  }

  res.json({
    status: 'queued',
    message_id: messageObj.message_id,
    conversation_id: messageObj.conversation_id
  });
});

// Get inbox
app.get('/api/v1/inbox/:bot_id', (req, res) => {
  const { bot_id } = req.params;
  const messages = inboxes.get(bot_id) || [];

  // Parse and filter expired messages
  const now = Date.now();
  const valid = messages.filter(msg => now - msg.timestamp <= msg.ttl * 1000);

  // Update last_seen
  if (registry.has(bot_id)) {
    registry.get(bot_id).last_seen = Date.now();
  }

  res.json({ messages: valid, count: valid.length });
});

// Acknowledge message (delete from inbox)
app.post('/api/v1/ack', (req, res) => {
  const { bot_id, message_id } = req.body;

  if (!bot_id || !message_id) {
    return res.status(400).json({ error: 'bot_id and message_id required' });
  }

  const messages = inboxes.get(bot_id) || [];
  const index = messages.findIndex(msg => msg.message_id === message_id);

  if (index === -1) {
    return res.status(404).json({ error: 'Message not found' });
  }

  messages.splice(index, 1);
  res.json({ status: 'acked', message_id });
});

// Clear inbox
app.delete('/api/v1/inbox/:bot_id', (req, res) => {
  inboxes.delete(req.params.bot_id);
  res.json({ status: 'cleared' });
});

// Set bot status
app.post('/api/v1/status', (req, res) => {
  const { bot_id, status } = req.body;

  if (!bot_id || !status) {
    return res.status(400).json({ error: 'bot_id and status required' });
  }

  if (!['online', 'offline', 'busy'].includes(status)) {
    return res.status(400).json({ error: 'status must be online, offline, or busy' });
  }

  if (!registry.has(bot_id)) {
    return res.status(404).json({ error: 'Bot not registered' });
  }

  registry.get(bot_id).status = status;
  res.json({ status: 'updated', bot_id, new_status: status });
});

// Stats
app.get('/api/v1/stats', (req, res) => {
  let totalMessages = 0;
  for (const messages of inboxes.values()) {
    totalMessages += messages.length;
  }

  res.json({
    registered_bots: registry.size,
    active_inboxes: inboxes.size,
    pending_messages: totalMessages,
    mode: 'memory'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot-to-Bot Protocol API running on port ${PORT} (in-memory mode)`);
});
