let torrents = require('./torrents')();

async function combo(query, page, options = {}) {
  let comboTorrent = [];
  let functions = [];

  for (let torrent in torrents) {
    console.log(torrent);
    functions.push(torrents[torrent](query, page, options));
  }

  console.log(functions);
  await Promise.all(functions).then((key) => {
    for (let provider of key) {
      if (provider !== null && provider.length !== 0) {
        comboTorrent.push(...provider);
      }
    }
  });

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
