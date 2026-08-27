'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getModuleLogger } = require('../../src/utils/logger');
const { connectToMongoDB } = require('../../src/db/connection');
const { VideoRecord, Task, Channel, AffiliateProgram, SystemLog } = require('../../src/db/schema');
const { computeDashboardStats } = require('../../src/modules/analytics-collector');

const log = getModuleLogger('dashboard-api');
const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT) || 3001;
const JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || 'change-me-in-production';

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.DASHBOARD_ADMIN_USER || 'admin';
  const adminPass = process.env.DASHBOARD_ADMIN_PASS;

  if (!adminPass) return res.status(500).json({ error: 'DASHBOARD_ADMIN_PASS not configured' });
  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, expiresIn: '7d' });
});

// All routes below require auth
app.use('/api', authMiddleware);

// ============================================================
// DASHBOARD OVERVIEW
// ============================================================
app.get('/api/dashboard/overview', async (req, res) => {
  try {
    const channels = await Channel.find({ isActive: true }).lean();
    const stats = {};
    let globalViews = 0, globalVideos = 0;

    for (const ch of channels) {
      const s = await computeDashboardStats(ch.accountId, 30);
      stats[ch.accountId] = s;
      globalViews += s.totalViews;
      globalVideos += s.totalVideos;
    }

    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const videosToday = await VideoRecord.countDocuments({
      status: 'uploaded', uploadDate: { $gte: todayStart }
    });

    const pendingTasks = await Task.countDocuments({ status: 'pending' });

    res.json({
      videosToday,
      totalViews30d: globalViews,
      totalVideos30d: globalVideos,
      avgViewsPerVideo: globalVideos > 0 ? Math.round(globalViews / globalVideos) : 0,
      activeChannels: channels.length,
      pendingTasks,
      channelStats: stats
    });
  } catch (err) {
    log.error(`Overview error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard/alerts', async (req, res) => {
  try {
    const alerts = [];
    const recentErrors = await SystemLog.find({ level: 'error' })
      .sort({ timestamp: -1 }).limit(10).lean();
    for (const e of recentErrors) {
      alerts.push({ type: 'error', message: `${e.module}: ${e.payload?.error || e.event}`, time: e.timestamp });
    }
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// VIDEOS
// ============================================================
app.get('/api/videos', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, platform, accountId, sort = '-uploadDate' } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (platform) filter.platform = platform;
    if (accountId) filter.accountId = accountId;

    const total = await VideoRecord.countDocuments(filter);
    const videos = await VideoRecord.find(filter)
      .sort(sort)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .select('-scriptJson') // Exclude large field for list view
      .lean();

    res.json({ videos, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  try {
    const video = await VideoRecord.findById(req.params.id).lean();
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// TASKS
// ============================================================
app.get('/api/tasks', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const tasks = await Task.find(filter).sort({ priority: -1, createdAt: 1 }).lean();
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { topicInstruction, accountId, verticalId, platform, priority, additionalContext } = req.body;
    if (!topicInstruction || !accountId || !verticalId) {
      return res.status(400).json({ error: 'topicInstruction, accountId, verticalId are required' });
    }
    const task = await Task.create({
      topicInstruction, accountId, verticalId,
      platform: platform || [],
      priority: priority || 5,
      additionalContext: additionalContext || '',
      createdBy: 'user'
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ANALYTICS
// ============================================================
app.get('/api/analytics/:accountId', async (req, res) => {
  try {
    const period = parseInt(req.query.period) || 30;
    const stats = await computeDashboardStats(req.params.accountId, period);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/compare/all', async (req, res) => {
  try {
    const channels = await Channel.find({ isActive: true }).lean();
    const comparison = {};
    for (const ch of channels) {
      comparison[ch.accountId] = await computeDashboardStats(ch.accountId, 30);
    }
    res.json(comparison);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AFFILIATES
// ============================================================
app.get('/api/affiliates', async (req, res) => {
  try {
    const programs = await AffiliateProgram.find().lean();
    res.json({ programs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/affiliates', async (req, res) => {
  try {
    const program = await AffiliateProgram.create(req.body);
    res.status(201).json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/affiliates/:id', async (req, res) => {
  try {
    const program = await AffiliateProgram.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/affiliates/:id/log', async (req, res) => {
  try {
    const program = await AffiliateProgram.findById(req.params.id).lean();
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const videos = await VideoRecord.find({
      affiliateLinksUsed: program.programId,
      status: 'uploaded'
    }).sort({ uploadDate: -1 }).limit(50).select('topic videoId platform uploadDate accountId').lean();

    res.json({ program, injections: videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CHANNELS
// ============================================================
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await Channel.find().lean();
    // Strip actual credential values — only return env var names
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels', async (req, res) => {
  try {
    const channel = await Channel.create(req.body);
    res.status(201).json(channel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/channels/:id', async (req, res) => {
  try {
    const channel = await Channel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/channels/:id/test', async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const plugin = require('../../src/modules/publisher/index').getPublisherPlugin(channel.platform);
    if (!plugin) return res.json({ valid: false, error: 'No plugin for platform' });

    const valid = await plugin.validateAuth(channel);
    res.json({ valid, platform: channel.platform, accountId: channel.accountId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SYSTEM
// ============================================================
app.get('/api/system/logs', async (req, res) => {
  try {
    const { limit = 50, level } = req.query;
    const filter = level ? { level } : {};
    const logs = await SystemLog.find(filter).sort({ timestamp: -1 }).limit(parseInt(limit)).lean();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/health', async (req, res) => {
  try {
    const { LLMHealth } = require('../../src/db/schema');
    const providers = await LLMHealth.find().lean();
    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
async function startServer() {
  await connectToMongoDB();
  app.listen(PORT, '0.0.0.0', () => {
    log.info(`Dashboard API running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  log.error(`Dashboard API failed to start: ${err.message}`);
  process.exit(1);
});

module.exports = app;
