'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ============================================================
// 1. VIDEO RECORD — tracks every generated video
// ============================================================
const VideoRecordSchema = new Schema({
  videoId: { type: String, default: null },
  accountId: { type: String, required: true, index: true },
  verticalId: { type: String, required: true, index: true },
  platform: { type: String, required: true, enum: ['youtube', 'instagram', 'x', 'tiktok'] },
  topic: { type: String, required: true },
  topicHash: { type: String, required: true, index: true },
  scriptJson: { type: Schema.Types.Mixed, default: null },
  audioFile: { type: String, default: null },
  videoFile: { type: String, default: null },
  uploadDate: { type: Date, default: null },
  scheduledTime: { type: Date, default: null },
  status: {
    type: String,
    required: true,
    enum: ['queued', 'processing', 'uploaded', 'failed', 'held_low_uniqueness'],
    default: 'queued',
    index: true
  },
  llmProvider: { type: String, default: null },
  ttsProvider: { type: String, default: null },
  ttsVoice: { type: String, default: null },
  visualProvider: { type: String, default: null },
  affiliateLinksUsed: [{ type: String }],
  metrics: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    updatedAt: { type: Date, default: null }
  },
  uniquenessScore: { type: Number, default: 0 },
  errorLog: [{ type: String }]
}, { timestamps: true });

VideoRecordSchema.index({ accountId: 1, uploadDate: -1 });
VideoRecordSchema.index({ accountId: 1, status: 1 });

// ============================================================
// 2. TASK — manually queued video requests from dashboard
// ============================================================
const TaskSchema = new Schema({
  createdBy: { type: String, default: 'user', enum: ['user', 'system'] },
  priority: { type: Number, default: 5, min: 1, max: 10 },
  accountId: { type: String, required: true },
  verticalId: { type: String, required: true },
  platform: [{ type: String, enum: ['youtube', 'instagram', 'x', 'tiktok'] }],
  topicInstruction: { type: String, required: true },
  additionalContext: { type: String, default: '' },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'picked', 'done', 'failed'],
    default: 'pending',
    index: true
  },
  pickedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  resultVideoId: { type: Schema.Types.ObjectId, ref: 'VideoRecord', default: null }
}, { timestamps: true });

TaskSchema.index({ status: 1, priority: -1, createdAt: 1 });

// ============================================================
// 3. CHANNEL — each YouTube/Insta/X account
// ============================================================
const ChannelSchema = new Schema({
  accountId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  platform: { type: String, required: true, enum: ['youtube', 'instagram', 'x', 'tiktok'] },
  verticalId: { type: String, required: true, index: true },
  contentPersona: { type: String, default: 'Explain complex topics in a fun, engaging way for a general audience.' },
  affiliatePrograms: [{ type: String }],
  credentials: {
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    clientId: { type: String, default: null },
    clientSecret: { type: String, default: null }
  },
  subreddits: [{ type: String }],
  quotaUsedToday: { type: Number, default: 0 },
  quotaResetAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// ============================================================
// 4. AFFILIATE PROGRAM — referral program registry
// ============================================================
const AffiliateProgramSchema = new Schema({
  programId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  referralUrl: { type: String, required: true },
  shortCode: { type: String, default: null },
  ctaText: { type: String, required: true },
  verticals: [{ type: String }],
  injectionFrequency: { type: Number, default: 4, min: 1 },
  totalClicks: { type: Number, default: 0 },
  totalConversions: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ============================================================
// 5. TOPIC SEEN — ultra-fast deduplication index
// ============================================================
const TopicSeenSchema = new Schema({
  topicHash: { type: String, required: true, index: { unique: true } },
  normalizedTopic: { type: String, required: true },
  seenAt: { type: Date, default: Date.now },
  accountId: { type: String, required: true, index: true },
  platform: { type: String, required: true }
});

// TTL: auto-delete after 90 days to keep MongoDB Atlas free tier under 512MB
TopicSeenSchema.index({ seenAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ============================================================
// 6. SYSTEM LOG — every pipeline run event
// ============================================================
const SystemLogSchema = new Schema({
  runId: { type: String, required: true, index: true },
  event: { type: String, required: true },
  module: { type: String, required: true },
  level: { type: String, required: true, enum: ['info', 'warn', 'error'] },
  payload: { type: Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
});

// TTL: auto-delete after 30 days
SystemLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// ============================================================
// 7. UPLOAD SCHEDULE — daily randomized upload slots
// ============================================================
const UploadScheduleSchema = new Schema({
  accountId: { type: String, required: true },
  date: { type: String, required: true },
  slots: [{
    time: { type: Date, required: true },
    used: { type: Boolean, default: false },
    videoRecordId: { type: Schema.Types.ObjectId, ref: 'VideoRecord', default: null }
  }]
});

UploadScheduleSchema.index({ accountId: 1, date: 1 }, { unique: true });
// TTL: auto-delete after 7 days
UploadScheduleSchema.index({ 'slots.0.time': 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// ============================================================
// 8. LLM PROVIDER HEALTH — track failures per provider
// ============================================================
const LLMHealthSchema = new Schema({
  provider: { type: String, required: true, unique: true },
  consecutiveFailures: { type: Number, default: 0 },
  lastFailure: { type: Date, default: null },
  lastSuccess: { type: Date, default: null },
  totalCalls: { type: Number, default: 0 },
  totalFailures: { type: Number, default: 0 },
  skipUntil: { type: Date, default: null }
});

// ============================================================
// Compile and export models
// ============================================================
const VideoRecord = mongoose.model('VideoRecord', VideoRecordSchema);
const Task = mongoose.model('Task', TaskSchema);
const Channel = mongoose.model('Channel', ChannelSchema);
const AffiliateProgram = mongoose.model('AffiliateProgram', AffiliateProgramSchema);
const TopicSeen = mongoose.model('TopicSeen', TopicSeenSchema);
const SystemLog = mongoose.model('SystemLog', SystemLogSchema);
const UploadSchedule = mongoose.model('UploadSchedule', UploadScheduleSchema);
const LLMHealth = mongoose.model('LLMHealth', LLMHealthSchema);

module.exports = {
  VideoRecord,
  Task,
  Channel,
  AffiliateProgram,
  TopicSeen,
  SystemLog,
  UploadSchedule,
  LLMHealth
};
