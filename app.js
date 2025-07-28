const express = require('express');
const combo = require('./torrent/COMBO');
const path = require('path');

let torrents = require('./torrent/torrents')();

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

// New endpoint for torrent details (must come before the general search route)
app.get('/api/torrent-details/:website/:torrentUrl', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  const website = req.params.website.toLowerCase();
  const torrentUrl = decodeURIComponent(req.params.torrentUrl);

  console.log(`Fetching details for ${website}: ${torrentUrl}`);
  console.log('Available torrents:', Object.keys(torrents));
  console.log('Torrent module for', website, ':', torrents[website]);
  console.log(
    'Has getDetails?',
    torrents[website] && typeof torrents[website].getDetails === 'function'
  );

  if (
    website === 'piratebay' &&
    torrents[website] &&
    torrents[website].getDetails
  ) {
    torrents[website]
      .getDetails(torrentUrl)
      .then((details) => {
        console.log('Details fetched successfully');
        res.json(details);
      })
      .catch((error) => {
        console.error('Error fetching details:', error);
        res.status(500).json({
          error: 'Failed to fetch torrent details',
          message: error.message,
        });
      });
  } else {
    res.status(404).json({
      error: `Torrent details not supported for "${website}" or website not found`,
      debug: {
        website,
        hasModule: !!torrents[website],
        hasGetDetails: !!(torrents[website] && torrents[website].getDetails),
      },
    });
  }
});

app.use('/api/:website/:query/:page?', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );

  let website = req.params.website.toLowerCase();
  let query = req.params.query;
  let page = req.params.page;

  // Extract query parameters for filtering options
  const options = {
    minSeeders: req.query.minSeeders ? parseInt(req.query.minSeeders) : null,
    maxResults: req.query.maxResults ? parseInt(req.query.maxResults) : null,
  };

  if (website == 'all') {
    combo(query, page, options).then((v) => {
      console.log(v);
      res.json(v);
    });
  } else if (torrents[website]) {
    torrents[website](query, page, options).then((v) => {
      console.log(v);
      res.json(v);
    });
  } else {
    res.json({
      error: `Please select "${Object.keys(torrents).join(' | ')}"`,
    });
  }
});

app.get('/api/torrents', (req, res) => {
  res.json(Object.keys(torrents));
});

app.use('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
console.log('Listening on PORT : ', PORT);
app.listen(PORT);
