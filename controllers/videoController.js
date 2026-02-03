const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../middleware/logger');

// Video controller for all video-related endpoints
const videoController = {
  // Video screenshot endpoint using ffmpeg
  generateScreenshot: asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    // Add early validation for request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
      });
    }

    const { videoUrl, timestamp, magnetLink, filename } = req.body;
    const cache = req.app.locals.cache;
    let responseSent = false;

    if (
      !videoUrl ||
      typeof videoUrl !== 'string' ||
      typeof timestamp !== 'number' ||
      isNaN(timestamp) ||
      timestamp < 0
    ) {
      responseSent = true;
      return res.status(400).json({
        success: false,
        error:
          'Missing required fields: videoUrl (string) and timestamp (number)',
      });
    }

    // Check if ffmpeg is available
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    try {
      // Create temp directory if it doesn't exist
      const tempDir = path.join(__dirname, '../tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilename = `screenshot_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}.jpg`;
      const tempPath = path.join(tempDir, tempFilename);

      logger.info('Generating video screenshot', {
        videoUrl: videoUrl.substring(0, 100) + '...',
        timestamp,
        tempPath,
      });

      // Use ffmpeg to capture screenshot
      const ffmpegArgs = [
        '-ss',
        timestamp.toString(), // Seek to timestamp
        '-i',
        videoUrl, // Input video URL
        '-vframes',
        '1', // Extract single frame
        '-q:v',
        '2', // High quality JPEG
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease', // Scale to max 720p maintaining aspect ratio
        '-y', // Overwrite output file
        tempPath, // Output path
      ];

      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      let stderr = '';

      // Add timeout to prevent hanging processes
      const ffmpegTimeout = setTimeout(() => {
        if (!responseSent) {
          logger.warn('FFmpeg process timeout, killing process');
          ffmpegProcess.kill('SIGKILL');

          // Clean up temp file if it exists
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          responseSent = true;
          res.status(500).json({
            success: false,
            error: 'Screenshot generation timed out',
            details: 'FFmpeg process exceeded maximum allowed time',
          });
        }
      }, 30000); // 30 second timeout

      ffmpegProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpegProcess.on('close', async (code) => {
        clearTimeout(ffmpegTimeout); // Clear timeout when process completes
        if (responseSent) return; // Early exit if response already sent

        if (code !== 0) {
          logger.error('FFmpeg process failed', {
            code,
            stderr: stderr.substring(0, 500),
          });

          // Clean up temp file if it exists
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          responseSent = true;
          return res.status(500).json({
            success: false,
            error: 'Failed to generate screenshot',
            details: 'FFmpeg process failed',
          });
        }

        try {
          // Check if screenshot file was created
          if (!fs.existsSync(tempPath)) {
            responseSent = true;
            return res.status(500).json({
              success: false,
              error: 'Screenshot file was not created',
            });
          }

          // Read the screenshot file
          const screenshotBuffer = fs.readFileSync(tempPath);
          const base64Screenshot = screenshotBuffer.toString('base64');

          // Get file stats
          const stats = fs.statSync(tempPath);
          const fileSizeKB = Math.round(stats.size / 1024);

          logger.info('Screenshot generated successfully', {
            filename: tempFilename,
            sizeKB: fileSizeKB,
            timestamp,
          });

          // Upload to pixhost for better hosting
          let pixhostUrl = null;
          try {
            pixhostUrl = await videoController._uploadToPixhost(
              screenshotBuffer,
              tempFilename
            );
          } catch (pixhostError) {
            logger.warn('Error uploading to pixhost', {
              error: pixhostError.message,
            });
          }

          // Normalize timestamp for consistent cache keys
          const normalizedTimestamp = Number(timestamp.toFixed(6));

          // Cache screenshot if cache is available and magnetLink provided
          let cacheSuccess = false;
          let favoriteEntryUsed = false;
          if (cache && magnetLink) {
            try {
              const screenshotData = {
                base64: `data:image/jpeg;base64,${base64Screenshot}`,
                pixhostUrl: pixhostUrl,
                timestamp: normalizedTimestamp,
                filename: filename || tempFilename,
                generatedAt: new Date().toISOString(),
                videoUrl: videoUrl.substring(0, 100) + '...',
              };

              // First, check if this magnet link belongs to a favorite entry
              let favoriteEntry = null;
              try {
                const allFavorites = await cache.getAllFavoriteEntries();
                favoriteEntry = allFavorites.find(
                  (entry) =>
                    entry.magnetLink &&
                    entry.magnetLink.trim() === magnetLink.trim()
                );
              } catch (entryError) {
                logger.warn('Error checking favorite entries', {
                  error: entryError.message,
                });
              }

              // If we found a favorite entry, save to the new system
              if (favoriteEntry) {
                try {
                  const favoriteScreenshotData = {
                    timestamp: normalizedTimestamp,
                    filename: filename || tempFilename,
                    base64Data: `data:image/jpeg;base64,${base64Screenshot}`,
                    pixhostUrl: pixhostUrl,
                    sizeKB: fileSizeKB,
                    videoUrl: videoUrl.substring(0, 100) + '...',
                    metadata: {
                      generatedAt: new Date().toISOString(),
                      videoUrlFull: videoUrl,
                    },
                  };

                  const favoriteScreenshotSuccess =
                    await cache.addFavoriteScreenshot(
                      favoriteEntry.id,
                      favoriteScreenshotData
                    );

                  if (favoriteScreenshotSuccess) {
                    favoriteEntryUsed = true;
                    cacheSuccess = true;
                    logger.info('Screenshot saved to favorite entry', {
                      favoriteEntryId: favoriteEntry.id,
                      timestamp: normalizedTimestamp,
                    });
                  }
                } catch (favError) {
                  logger.warn(
                    'Failed to save to favorite entry, falling back to old system',
                    {
                      error: favError.message,
                    }
                  );
                }
              }

              // If favorite entry wasn't used, use the old timestamp-based system
              if (!favoriteEntryUsed) {
                const crypto = require('crypto');
                const magnetHash = crypto
                  .createHash('sha256')
                  .update(magnetLink)
                  .digest('hex')
                  .substring(0, 16);
                const cacheKey = `screenshot_${magnetHash}_${normalizedTimestamp}`;

                logger.info('Attempting to cache screenshot (old system)', {
                  cacheKey: cacheKey.substring(0, 100) + '...',
                  cacheKeyLength: cacheKey.length,
                  magnetLinkLength: magnetLink.length,
                  originalTimestamp: timestamp,
                  normalizedTimestamp: normalizedTimestamp,
                  dataSize: JSON.stringify(screenshotData).length,
                });

                cacheSuccess = await cache.set(
                  cacheKey,
                  screenshotData,
                  7 * 24 * 60 * 60
                ); // Cache for 7 days

                if (cacheSuccess) {
                  // Also maintain a list of available screenshots for this magnet link
                  const screenshotsListKey = `screenshots_list_${magnetHash}`;
                  let screenshotsList =
                    (await cache.get(screenshotsListKey)) || [];

                  const existingIndex = screenshotsList.findIndex(
                    (item) =>
                      Math.abs(item.timestamp - normalizedTimestamp) < 0.000001
                  );

                  if (existingIndex === -1) {
                    screenshotsList.push({
                      timestamp: normalizedTimestamp,
                      filename: filename || tempFilename,
                      generatedAt: new Date().toISOString(),
                    });

                    // Keep only the most recent 50 screenshots
                    screenshotsList = screenshotsList
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .slice(0, 50);

                    await cache.set(
                      screenshotsListKey,
                      screenshotsList,
                      7 * 24 * 60 * 60
                    );
                    logger.info('Updated screenshots list', {
                      magnetLink: magnetLink.substring(0, 50) + '...',
                      totalScreenshots: screenshotsList.length,
                    });
                  }
                }
              }

              logger.info('Cache set result', {
                cacheSuccess: cacheSuccess,
                favoriteEntryUsed: favoriteEntryUsed,
                method: favoriteEntryUsed ? 'favorite_entry' : 'old_system',
              });
            } catch (cacheError) {
              logger.error('Error caching screenshot', {
                error: cacheError.message,
                stack: cacheError.stack,
                magnetLinkLength: magnetLink.length,
                magnetLinkStart: magnetLink.substring(0, 50),
              });
            }
          }

          // Clean up temp file
          fs.unlinkSync(tempPath);

          // Return response
          responseSent = true;
          res.json({
            success: true,
            screenshot: {
              base64: `data:image/jpeg;base64,${base64Screenshot}`,
              pixhostUrl: pixhostUrl,
              timestamp: normalizedTimestamp,
              filename: filename || tempFilename,
              sizeKB: fileSizeKB,
              cached: cacheSuccess,
              generatedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          logger.error('Error processing screenshot', {
            error: error.message,
            stack: error.stack,
          });

          // Clean up temp file
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          if (!responseSent) {
            res.status(500).json({
              success: false,
              error: 'Failed to process screenshot',
              details: error.message,
            });
          }
        }
      });

      ffmpegProcess.on('error', (error) => {
        clearTimeout(ffmpegTimeout); // Clear timeout on error
        if (responseSent) return;

        logger.error('FFmpeg process error', {
          error: error.message,
        });

        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        responseSent = true;
        res.status(500).json({
          success: false,
          error: 'FFmpeg is not available or failed to start',
          details: error.message,
        });
      });
    } catch (error) {
      if (responseSent) return;

      logger.error('Video screenshot endpoint error', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: error.message,
      });
    }
  }),

  // POST endpoint for cached screenshots (for very long magnet links)
  getCachedScreenshotsPost: asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    // Add early validation for request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
      });
    }

    const { magnetLink } = req.body;
    const cache = req.app.locals.cache;

    if (!magnetLink || typeof magnetLink !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: magnetLink',
      });
    }

    if (!cache) {
      return res.status(503).json({
        success: false,
        error: 'Cache not available',
      });
    }

    try {
      // Add timeout to prevent hanging requests
      const timeoutMs = 10000; // 10 seconds
      const screenshots = await Promise.race([
        videoController._getCachedScreenshots(magnetLink, cache),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        ),
      ]);

      logger.info('Retrieved cached screenshots via POST', {
        count: screenshots.length,
        magnetLink: magnetLink.substring(0, 50) + '...',
      });

      res.json({
        success: true,
        magnetLink: magnetLink,
        screenshots: screenshots,
        count: screenshots.length,
      });
    } catch (error) {
      logger.error('Error retrieving cached screenshots via POST', {
        error: error.message,
        stack: error.stack,
        magnetLinkLength: magnetLink ? magnetLink.length : 0,
      });

      // Don't send error details in production to avoid info leakage
      const errorDetails =
        process.env.NODE_ENV === 'development' ? error.message : undefined;

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cached screenshots',
        details: errorDetails,
      });
    }
  }),

  // Get cached screenshots for a magnet link (GET version)
  getCachedScreenshotsGet: asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    const { magnetLink: encodedMagnetLink } = req.params;
    const cache = req.app.locals.cache;

    if (!encodedMagnetLink || typeof encodedMagnetLink !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: magnetLink',
      });
    }

    try {
      // URL decode the magnet link to ensure consistency with cache keys
      const magnetLink = decodeURIComponent(encodedMagnetLink);

      if (!cache) {
        return res.status(503).json({
          success: false,
          error: 'Cache not available',
        });
      }

      // Add timeout to prevent hanging requests
      const timeoutMs = 10000; // 10 seconds
      const screenshots = await Promise.race([
        videoController._getCachedScreenshots(magnetLink, cache),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        ),
      ]);

      logger.info('Retrieved cached screenshots via GET', {
        count: screenshots.length,
        magnetLink: magnetLink.substring(0, 50) + '...',
      });

      res.json({
        success: true,
        magnetLink: magnetLink,
        screenshots: screenshots,
        count: screenshots.length,
      });
    } catch (error) {
      logger.error('Error retrieving cached screenshots via GET', {
        error: error.message,
        stack: error.stack,
      });

      // Don't send error details in production to avoid info leakage
      const errorDetails =
        process.env.NODE_ENV === 'development' ? error.message : undefined;

      res.status(500).json({
        success: false,
        error: 'Failed to retrieve cached screenshots',
        details: errorDetails,
      });
    }
  }),

  // Batch screenshot generation
  generateBatchScreenshots: asyncHandler(async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept'
    );

    // Add early validation for request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
      });
    }

    const { videoUrl, timestamps, magnetLink } = req.body;

    if (
      !videoUrl ||
      typeof videoUrl !== 'string' ||
      !timestamps ||
      !Array.isArray(timestamps)
    ) {
      return res.status(400).json({
        success: false,
        error:
          'Missing required fields: videoUrl (string) and timestamps (array)',
      });
    }

    if (timestamps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Timestamps array cannot be empty',
      });
    }

    if (timestamps.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 20 timestamps allowed per batch',
      });
    }

    try {
      const results = [];
      const errors = [];

      for (let i = 0; i < timestamps.length; i++) {
        try {
          const timestamp = timestamps[i];
          if (typeof timestamp !== 'number' || isNaN(timestamp)) {
            errors.push({
              index: i,
              timestamp: timestamp,
              error: 'Timestamp must be a number',
            });
            continue;
          }

          if (timestamp < 0) {
            errors.push({
              index: i,
              timestamp: timestamp,
              error: 'Timestamp must be a positive number',
            });
            continue;
          }

          // This would need to be implemented as a separate internal method
          // For now, just indicate the structure
          results.push({
            index: i,
            timestamp: timestamp,
            success: true,
            message: 'Screenshot generation queued',
          });
        } catch (error) {
          errors.push({
            index: i,
            timestamp: timestamps[i],
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        totalRequested: timestamps.length,
        successful: results.length,
        failed: errors.length,
        results: results,
        errors: errors,
      });
    } catch (error) {
      logger.error('Error in batch screenshot generation', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error during batch processing',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }),

  // Private helper methods
  _uploadToPixhost: async (imageBuffer, filename) => {
    const fetch = require('node-fetch');
    const FormData = require('form-data');

    const form = new FormData();
    form.append('img', imageBuffer, {
      filename: filename,
      contentType: 'image/jpeg',
    });
    form.append('content_type', '1'); // 1 for adult content (prevents removal)
    form.append('max_th_size', '420');

    const pixhostResponse = await fetch('https://api.pixhost.to/images', {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'application/json',
        ...form.getHeaders(),
      },
    });

    if (pixhostResponse.ok) {
      const result = await pixhostResponse.json();
      if (result.show_url) {
        const pixhostUrl = result.show_url.replace(
          'https://pixhost.to/show/',
          'https://img1.pixhost.to/images/'
        );
        logger.info('Screenshot uploaded to pixhost', { pixhostUrl });
        return pixhostUrl;
      }
    } else {
      logger.warn('Pixhost upload failed', {
        status: pixhostResponse.status,
        statusText: pixhostResponse.statusText,
      });
      throw new Error(`Pixhost upload failed: ${pixhostResponse.statusText}`);
    }
    return null;
  },

  _getCachedScreenshots: async (magnetLink, cache) => {
    // Validate inputs
    if (!magnetLink || typeof magnetLink !== 'string') {
      throw new Error('Invalid magnetLink provided');
    }

    if (!cache) {
      throw new Error('Cache not available');
    }

    logger.info('Retrieving cached screenshots', {
      magnetLink: magnetLink.substring(0, 50) + '...',
      magnetLinkLength: magnetLink.length,
    });

    try {
      const screenshots = [];
      const crypto = require('crypto');
      const magnetHash = crypto
        .createHash('sha256')
        .update(magnetLink)
        .digest('hex')
        .substring(0, 16);

      // Use shorter, more aggressive timeouts to prevent hanging
      const INDIVIDUAL_TIMEOUT = 2000; // 2 seconds per cache operation
      const TOTAL_TIMEOUT = 5000; // 5 seconds total

      // Create timeout promise
      const createTimeoutPromise = (timeoutMs, message) => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error(message)), timeoutMs);
        });
      };

      // Check if there's a screenshots list stored with timeout
      const screenshotsListKey = `screenshots_list_${magnetHash}`;
      let screenshotsList;

      try {
        screenshotsList = await Promise.race([
          cache.get(screenshotsListKey),
          createTimeoutPromise(
            INDIVIDUAL_TIMEOUT,
            'Screenshots list retrieval timeout'
          ),
        ]);
      } catch (error) {
        logger.warn('Failed to retrieve screenshots list', {
          error: error.message,
          magnetHash,
        });
        return []; // Return empty array on failure
      }

      logger.info('Checking screenshots list', {
        hasScreenshotsList: !!screenshotsList,
        listLength: screenshotsList ? screenshotsList.length : 0,
      });

      if (
        screenshotsList &&
        Array.isArray(screenshotsList) &&
        screenshotsList.length > 0
      ) {
        logger.info('Found screenshots in list', {
          timestamps: screenshotsList
            .map((item) => item?.timestamp)
            .filter((t) => t !== undefined),
          count: screenshotsList.length,
        });

        // Limit to first 5 items to prevent excessive cache calls and improve performance
        const limitedList = screenshotsList.slice(0, 5);

        // Retrieve cached data for screenshots with individual timeouts
        const cachePromises = limitedList.map(async (item) => {
          if (!item || typeof item.timestamp === 'undefined') {
            return { timestamp: null, cacheKey: null, cachedData: null };
          }

          const cacheKey = `screenshot_${magnetHash}_${item.timestamp}`;
          try {
            const cachedData = await Promise.race([
              cache.get(cacheKey),
              createTimeoutPromise(
                INDIVIDUAL_TIMEOUT,
                'Individual cache timeout'
              ),
            ]);
            return {
              timestamp: item.timestamp,
              cacheKey,
              cachedData,
            };
          } catch (error) {
            logger.warn('Failed to get cached screenshot', {
              timestamp: item.timestamp,
              error: error.message,
            });
            return {
              timestamp: item.timestamp,
              cacheKey,
              cachedData: null,
            };
          }
        });

        let results;
        try {
          results = await Promise.race([
            Promise.all(cachePromises),
            createTimeoutPromise(
              TOTAL_TIMEOUT,
              'Total cache operation timeout'
            ),
          ]);
        } catch (error) {
          logger.warn('Cache operations timed out', {
            error: error.message,
            magnetHash,
          });
          return []; // Return empty array on timeout
        }

        for (const result of results) {
          if (result.cachedData && result.timestamp !== null) {
            screenshots.push({
              timestamp: result.timestamp,
              ...result.cachedData,
              cacheKey: result.cacheKey,
            });
          }
        }

        logger.info('Retrieved cached screenshots', {
          totalInList: screenshotsList.length,
          limitedTo: limitedList.length,
          foundInCache: screenshots.length,
        });
      } else {
        // No screenshots list found - return empty array
        logger.info('No screenshots list found for magnet link', {
          magnetHash: magnetHash,
          message:
            'Screenshots will be available after generation via screenshot API',
        });
      }

      return screenshots;
    } catch (error) {
      logger.error('Cache operation failed', {
        error: error.message,
        stack: error.stack,
        magnetLink: magnetLink.substring(0, 50) + '...',
      });
      // Return empty array instead of throwing to prevent server crashes
      return [];
    }
  },
};

// Export individual controller functions for direct route binding
module.exports = {
  generateScreenshot: videoController.generateScreenshot,
  getCachedScreenshotsPost: videoController.getCachedScreenshotsPost,
  getCachedScreenshotsGet: videoController.getCachedScreenshotsGet,
  generateBatchScreenshots: videoController.generateBatchScreenshots,
};
