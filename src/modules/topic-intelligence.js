'use strict';

const { getModuleLogger } = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const cheerio = require('cheerio');
const RssParser = require('rss-parser');

const log = getModuleLogger('topic-intelligence');
const rssParser = new RssParser();

// ============================================================
// FAIL-FAST UNIQUENESS GUARD
// ============================================================

/**
 * Checks if a candidate topic is too similar to any recently used topic.
 * Uses a simple word-overlap ratio for fast, zero-cost similarity detection.
 * @param {string} candidate
 * @param {string[]} recentTopics
 * @returns {boolean} true if the topic is a duplicate / too similar
 */
function isDuplicateTopic(candidate, recentTopics) {
  if (!recentTopics || recentTopics.length === 0) return false;
  const candidateWords = new Set(
    candidate.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3)
  );
  if (candidateWords.size === 0) return false;

  for (const recent of recentTopics) {
    const recentWords = recent.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
    const overlap = recentWords.filter(w => candidateWords.has(w)).length;
    const similarity = overlap / Math.min(candidateWords.size, recentWords.length || 1);
    if (similarity > 0.5) {
      log.info(`Fail-fast: topic "${candidate.substring(0, 60)}" is too similar to recent topic "${recent.substring(0, 60)}" (similarity: ${(similarity * 100).toFixed(0)}%)`);
      return true;
    }
  }
  return false;
}

const USER_AGENT = 'AURA/1.0 (Automated Content Discovery)';
const REQUEST_TIMEOUT = 10000;

const TRENDING_KEYWORDS = [
  'AI', 'GPT', 'LLM', 'blockchain', 'quantum', 'startup',
  'open source', 'cybersecurity', 'rust', 'web3', 'AGI', 'neural',
  'robotics', 'funding', 'launch', 'breakthrough', 'autonomous',
  'deepfake', 'regulation', 'chip', 'semiconductor', 'API'
];

const VERTICAL_SUBREDDITS = {
  tech: ['programming', 'MachineLearning', 'webdev', 'technology', 'artificial', 'startups'],
  geopolitics: ['geopolitics', 'worldnews', 'InternationalRelations', 'Economics'],
  history: ['history', 'HistoryMemes', 'AskHistorians', 'todayilearned'],
  finance: ['finance', 'wallstreetbets', 'investing', 'CryptoCurrency'],
  science: ['science', 'space', 'Physics', 'biology']
};

const AFFILIATE_KEYWORDS = {
  hostinger: ['hosting', 'web hosting', 'deploy', 'website builder'],
  namecheap: ['domain', 'DNS', 'domain name'],
  nordvpn: ['VPN', 'privacy', 'security', 'cybersecurity'],
  skillshare: ['learn', 'course', 'tutorial', 'education'],
  brilliant: ['math', 'science', 'algorithm', 'data structure'],
  notion: ['productivity', 'notes', 'project management'],
  vercel: ['deploy', 'Next.js', 'frontend', 'serverless'],
  digitalocean: ['cloud', 'server', 'VPS', 'kubernetes']
};

async function safeFetch(url, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, ...extraHeaders },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchReddit(subreddits, limit = 25) {
  const topics = [];
  for (const sub of subreddits) {
    try {
      const data = await withRetry(async () => {
        const res = await safeFetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=${limit}`);
        return res.json();
      }, { maxRetries: 2, name: `reddit-r/${sub}` });
      for (const post of (data?.data?.children || [])) {
        const d = post.data;
        if (!d || d.stickied) continue;
        topics.push({
          topic: d.title, source: `reddit/r/${sub}`,
          sourceUrl: `https://reddit.com${d.permalink}`,
          upvotes: d.ups || 0, commentCount: d.num_comments || 0,
          createdUtc: d.created_utc,
          isControversial: d.upvote_ratio < 0.75 && d.ups > 50
        });
      }
    } catch (err) { log.warn(`Reddit r/${sub} failed: ${err.message}`); }
  }
  return topics;
}

async function fetchHackerNews() {
  const topics = [];
  try {
    const idsRes = await withRetry(async () => {
      const res = await safeFetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      return res.json();
    }, { maxRetries: 2, name: 'hn-topstories' });
    const topIds = (idsRes || []).slice(0, 30);
    for (let i = 0; i < topIds.length; i += 10) {
      const batch = topIds.slice(i, i + 10);
      const items = await Promise.allSettled(
        batch.map(id => withRetry(async () => {
          const res = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return res.json();
        }, { maxRetries: 1, name: `hn-item-${id}` }))
      );
      for (const result of items) {
        if (result.status !== 'fulfilled') continue;
        const item = result.value;
        if (!item || item.type !== 'story' || (item.score || 0) < 100) continue;
        topics.push({
          topic: item.title, source: 'hackernews',
          sourceUrl: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
          upvotes: item.score || 0, commentCount: item.descendants || 0,
          createdUtc: item.time, isControversial: false
        });
      }
    }
  } catch (err) { log.warn(`HackerNews failed: ${err.message}`); }
  return topics;
}

async function fetchGitHubTrending() {
  const topics = [];
  const urls = [
    'https://github.com/trending?since=daily',
    'https://github.com/trending/javascript?since=daily',
    'https://github.com/trending/python?since=daily'
  ];
  for (const url of urls) {
    try {
      const html = await withRetry(async () => {
        const res = await safeFetch(url);
        return res.text();
      }, { maxRetries: 2, name: 'github-trending' });
      const $ = cheerio.load(html);
      $('article.Box-row').each((_, el) => {
        const repoLink = $(el).find('h2 a').attr('href')?.trim();
        const desc = $(el).find('p').text().trim();
        const starsText = $(el).find('span.d-inline-block.float-sm-right').text().trim();
        const stars = parseInt(starsText.replace(/,/g, '')) || 0;
        if (repoLink && desc) {
          topics.push({
            topic: `${repoLink.replace(/^\//, '')}: ${desc}`,
            source: 'github-trending', sourceUrl: `https://github.com${repoLink}`,
            upvotes: stars, commentCount: 0,
            createdUtc: Date.now() / 1000, isControversial: false
          });
        }
      });
    } catch (err) { log.warn(`GitHub trending failed: ${err.message}`); }
  }
  return topics;
}

async function fetchDevTo() {
  const topics = [];
  const endpoints = [
    'https://dev.to/api/articles?top=1&per_page=30',
    'https://dev.to/api/articles?top=7&per_page=20'
  ];
  for (const url of endpoints) {
    try {
      const articles = await withRetry(async () => {
        const res = await safeFetch(url);
        return res.json();
      }, { maxRetries: 2, name: 'devto' });
      for (const a of (articles || [])) {
        topics.push({
          topic: a.title, source: 'devto', sourceUrl: a.url,
          upvotes: a.positive_reactions_count || 0,
          commentCount: a.comments_count || 0,
          createdUtc: new Date(a.published_at).getTime() / 1000,
          isControversial: false
        });
      }
    } catch (err) { log.warn(`Dev.to failed: ${err.message}`); }
  }
  return topics;
}

async function fetchProductHunt() {
  const topics = [];
  try {
    const feed = await withRetry(async () => {
      return rssParser.parseURL('https://www.producthunt.com/feed');
    }, { maxRetries: 2, name: 'producthunt' });
    for (const item of (feed.items || []).slice(0, 20)) {
      topics.push({
        topic: `${item.title}: ${item.contentSnippet || ''}`.trim(),
        source: 'producthunt', sourceUrl: item.link,
        upvotes: 50, commentCount: 0,
        createdUtc: new Date(item.pubDate).getTime() / 1000,
        isControversial: false
      });
    }
  } catch (err) { log.warn(`Product Hunt failed: ${err.message}`); }
  return topics;
}

async function fetchLobsters() {
  const topics = [];
  try {
    const items = await withRetry(async () => {
      const res = await safeFetch('https://lobste.rs/hottest.json');
      return res.json();
    }, { maxRetries: 2, name: 'lobsters' });
    for (const item of (items || [])) {
      if ((item.score || 0) < 20) continue;
      topics.push({
        topic: item.title, source: 'lobsters',
        sourceUrl: item.url || item.short_id_url,
        upvotes: item.score || 0, commentCount: item.comment_count || 0,
        createdUtc: new Date(item.created_at).getTime() / 1000,
        isControversial: false
      });
    }
  } catch (err) { log.warn(`Lobste.rs failed: ${err.message}`); }
  return topics;
}

async function fetchTechCrunch() {
  const topics = [];
  try {
    const feed = await withRetry(async () => {
      return rssParser.parseURL('https://techcrunch.com/feed/');
    }, { maxRetries: 2, name: 'techcrunch' });
    for (const item of (feed.items || []).slice(0, 20)) {
      const hasSaas = /SaaS|tool|platform|launch|startup|funding|raised/i.test(
        `${item.title} ${item.contentSnippet || ''}`
      );
      topics.push({
        topic: item.title, source: 'techcrunch', sourceUrl: item.link,
        upvotes: 30, commentCount: 0,
        createdUtc: new Date(item.pubDate).getTime() / 1000,
        isControversial: false, affiliateSignal: hasSaas
      });
    }
  } catch (err) { log.warn(`TechCrunch failed: ${err.message}`); }
  return topics;
}

async function fetchGoogleTrends() {
  const topics = [];
  try {
    const feed = await withRetry(async () => {
      return rssParser.parseURL('https://trends.google.com/trending/rss?geo=US');
    }, { maxRetries: 2, name: 'google-trends' });
    for (const item of (feed.items || []).slice(0, 15)) {
      topics.push({
        topic: item.title, source: 'google-trends',
        sourceUrl: item.link || '', upvotes: 10, commentCount: 0,
        createdUtc: new Date(item.pubDate || Date.now()).getTime() / 1000,
        isControversial: false
      });
    }
  } catch (err) { log.warn(`Google Trends failed: ${err.message}`); }
  return topics;
}

function hasAffPotential(topicText) {
  const lower = topicText.toLowerCase();
  for (const [, kws] of Object.entries(AFFILIATE_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw.toLowerCase()))) return true;
  }
  return false;
}

function mentionsTrending(topicText) {
  const lower = topicText.toLowerCase();
  return TRENDING_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function scoreTopics(rawTopics) {
  if (!rawTopics.length) return [];
  const maxUpvotes = Math.max(...rawTopics.map(t => t.upvotes), 1);
  const now = Date.now() / 1000;
  const crossMap = new Map();
  for (const t of rawTopics) {
    const key = t.topic.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    crossMap.set(key, (crossMap.get(key) || 0) + 1);
  }
  const scored = rawTopics.map(t => {
    const hoursOld = (now - (t.createdUtc || now)) / 3600;
    const crossKey = t.topic.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    const crossCount = crossMap.get(crossKey) || 1;
    const viralityScore = Math.min(100, Math.round(
      (t.upvotes / maxUpvotes) * 30 +
      (t.isControversial ? 15 : 0) +
      (mentionsTrending(t.topic) ? 15 : 0) +
      (hoursOld < 6 ? 20 : hoursOld < 12 ? 10 : 0) +
      (crossCount > 1 ? crossCount * 10 : 0) +
      (hasAffPotential(t.topic) || t.affiliateSignal ? 10 : 0)
    ));
    return {
      topic: t.topic, source: t.source, sourceUrl: t.sourceUrl,
      viralityScore, affiliatePotential: hasAffPotential(t.topic) || !!t.affiliateSignal,
      raw: { upvotes: t.upvotes, commentCount: t.commentCount,
        hoursOld: Math.round(hoursOld), crossSourceCount: crossCount }
    };
  });
  scored.sort((a, b) => b.viralityScore - a.viralityScore);
  const seen = new Set();
  return scored.filter(t => {
    const key = t.topic.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverTopics(verticalId = 'tech', count = 10, customSubreddits = [], recentTopics = []) {
  log.info(`Discovering topics for vertical: ${verticalId}, count: ${count}, recent topics to exclude: ${recentTopics.length}`);
  const subreddits = customSubreddits.length > 0
    ? customSubreddits
    : (VERTICAL_SUBREDDITS[verticalId] || VERTICAL_SUBREDDITS.tech);

  const sourceResults = await Promise.allSettled([
    fetchReddit(subreddits), fetchHackerNews(), fetchGitHubTrending(),
    fetchDevTo(), fetchProductHunt(), fetchLobsters(),
    fetchTechCrunch(), fetchGoogleTrends()
  ]);

  const allRaw = [];
  const names = ['Reddit', 'HackerNews', 'GitHub', 'Dev.to', 'ProductHunt', 'Lobsters', 'TechCrunch', 'GoogleTrends'];
  sourceResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      log.info(`${names[i]}: ${r.value.length} topics`);
      allRaw.push(...r.value);
    } else {
      log.warn(`${names[i]}: failed — ${r.reason?.message || 'unknown'}`);
    }
  });

  log.info(`Total raw topics: ${allRaw.length}`);
  if (!allRaw.length) return [];

  const scored = scoreTopics(allRaw);

  // FAIL-FAST: Filter out anything too similar to recentTopics BEFORE returning
  const fresh = scored.filter(t => !isDuplicateTopic(t.topic, recentTopics));
  log.info(`After fail-fast dedup: ${fresh.length}/${scored.length} topics remain`);

  const topN = fresh.slice(0, count);
  log.info(`Top ${topN.length} topics (best: ${topN[0]?.viralityScore}/100)`);
  return topN;
}

module.exports = { discoverTopics, isDuplicateTopic, VERTICAL_SUBREDDITS, TRENDING_KEYWORDS, AFFILIATE_KEYWORDS };
