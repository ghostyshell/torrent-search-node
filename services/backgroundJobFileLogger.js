const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config/environment');
const jobLogContext = require('./jobLogContext');

const LOG_VERSION = config.logging.backgroundJobsLogVersion || 'v1';

/** @type {Set<string>} */
const ALLOWED_JOB_NAMES = new Set([
  'storageCleanup',
  'streamUrlRefresh',
  'descriptionImageCache',
  'searchResultsCache',
  'searchQueryCache',
  'jobLogMaintenance',
  'coverStorageMaintenance',
]);

function assertJobName(jobName) {
  if (!ALLOWED_JOB_NAMES.has(jobName)) {
    throw new Error(`Invalid background job name: ${jobName}`);
  }
}

function getJobsRoot() {
  return path.join(config.logging.logDir, 'background-jobs', LOG_VERSION);
}

/**
 * Run async work with a per-job NDJSON log file. While active, the global logger
 * also appends the same formatted lines here (via jobLogContext + middleware/logger).
 *
 * @param {string} jobName
 * @param {() => Promise<unknown>} fn
 */
async function runWithJobFileLogging(jobName, fn) {
  assertJobName(jobName);

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const dateStr = new Date().toISOString().slice(0, 10);
  const dir = path.join(getJobsRoot(), jobName, dateStr);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `${runId}.log`;
  const fullPath = path.join(dir, fileName);
  const stream = fs.createWriteStream(fullPath, { flags: 'a' });

  const sink = {
    appendRaw(line) {
      if (!stream.destroyed && stream.writable) {
        stream.write(line);
      }
    },
    meta: { jobName, runId, dateStr, fileName, fullPath, logVersion: LOG_VERSION },
  };

  const endStream = () =>
    new Promise((resolve, reject) => {
      if (stream.writableEnded) {
        resolve();
        return;
      }
      stream.end((err) => (err ? reject(err) : resolve()));
    });

  const header =
    JSON.stringify({
      v: 1,
      type: 'job_start',
      ts: new Date().toISOString(),
      job: jobName,
      runId,
      file: fileName,
      logVersion: LOG_VERSION,
    }) + '\n';
  stream.write(header);

  try {
    return await jobLogContext.run(sink, fn);
  } finally {
    const footer =
      JSON.stringify({
        v: 1,
        type: 'job_end',
        ts: new Date().toISOString(),
        job: jobName,
        runId,
      }) + '\n';
    try {
      sink.appendRaw(footer);
    } catch {
      // ignore
    }
    await endStream();
  }
}

module.exports = {
  runWithJobFileLogging,
  getJobsRoot,
  ALLOWED_JOB_NAMES,
  LOG_VERSION,
  assertJobName,
};
