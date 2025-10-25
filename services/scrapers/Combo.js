// Import torrent modules directly
const limeTorrent = require('./limeTorrent');
const nyaaSI = require('./nyaaSI');
const pirateBay = require('./pirateBay');
const torrentProject = require('./torrentProject');
const yts = require('./yts');

// Create torrents object
const torrents = {
  limetorrent: limeTorrent,
  nyaasi: nyaaSI,
  piratebay: pirateBay,
  torrentproject: torrentProject,
  yts: yts,
};

async function combo(query, page, options = {}) {
  let comboTorrent = [];
  let functions = [];

  // Add individual timeouts for each provider
  const PROVIDER_TIMEOUT = 6000; // 6 seconds per provider

  for (let torrent in torrents) {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve([]), PROVIDER_TIMEOUT);
    });

    const providerPromise = torrents[torrent](query, page, options).catch(
      () => {
        return []; // Return empty array on error
      }
    );

    functions.push(Promise.race([providerPromise, timeoutPromise]));
  }

  // Use allSettled instead of all to get partial results
  const results = await Promise.allSettled(functions);

  for (let result of results) {
    if (
      result.status === 'fulfilled' &&
      result.value &&
      result.value.length > 0
    ) {
      comboTorrent.push(...result.value);
    }
  }

  // Apply additional filtering to the combined results
  if (options.minSeeders) {
    comboTorrent = comboTorrent.filter((torrent) => {
      const seeders = parseInt(torrent.Seeders) || 0;
      return seeders >= options.minSeeders;
    });
  }

  // Apply maxResults filter if specified
  if (options.maxResults && comboTorrent.length > options.maxResults) {
    comboTorrent = comboTorrent.slice(0, options.maxResults);
  }

  return comboTorrent;
}
module.exports = combo;
