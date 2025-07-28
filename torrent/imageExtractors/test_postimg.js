const { extractImageLinks } = require('./imageExtractor');

// Test with the actual URLs from the Vixen torrent description
const testDescription = `
SCREENLIST LINK BELOW

https://i.postimg.cc/25hp5BRs/BTM-TORRENTS.jpg

POSTER LINK BELOW

https://i.postimg.cc/PxbkSvSW/Vixen-16-09-16-August-Ames-4k.jpg

SCREENSHOTS LINK BELOW

https://i.postimg.cc/MHdJS22X/vlcsnap-2025-06-30-03h27m56s386.jpg
https://i.postimg.cc/VsR8MMr1/vlcsnap-2025-06-30-03h28m03s365.jpg
https://i.postimg.cc/zXG1kBKh/vlcsnap-2025-06-30-03h28m11s868.jpg
https://i.postimg.cc/02X1s0B/vlcsnap-2025-06-30-03h28m24s299.jpg
https://i.postimg.cc/NjyqWzNf/vlcsnap-2025-06-30-03h28m35s143.jpg
https://i.postimg.cc/ZRSGvKJC/vlcsnap-2025-06-30-03h28m54s990.jpg

Some other technical info...
`;

async function testPostimgUrls() {
  console.log('Testing i.postimg.cc extractor with Vixen URLs...');

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log(`Found ${imageLinks.length} image links:`);

    for (const link of imageLinks) {
      console.log(`Original: ${link.originalUrl}`);
      console.log(`Direct: ${link.directUrl || 'Failed to extract'}`);
      console.log('---');
    }
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Test regex pattern separately
function testRegexPattern() {
  console.log('Testing regex pattern for i.postimg.cc URLs:');

  const pattern =
    /https?:\/\/i\.postimg\.cc\/[a-zA-Z0-9]+\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g;
  const testUrls = [
    'https://i.postimg.cc/25hp5BRs/BTM-TORRENTS.jpg',
    'https://i.postimg.cc/PxbkSvSW/Vixen-16-09-16-August-Ames-4k.jpg',
    'https://i.postimg.cc/MHdJS22X/vlcsnap-2025-06-30-03h27m56s386.jpg',
    'https://i.postimg.cc/VsR8MMr1/vlcsnap-2025-06-30-03h28m03s365.jpg',
    'https://other-site.com/image.jpg', // Should not match
  ];

  testUrls.forEach((url) => {
    const matches = url.match(pattern);
    console.log(`${url} -> ${matches ? 'MATCH' : 'NO MATCH'}`);
  });

  // Test with full description
  const matches = testDescription.match(pattern);
  console.log(
    `\nFound ${matches ? matches.length : 0} URLs in Vixen description:`
  );
  if (matches) {
    matches.forEach((url) => console.log(`  ${url}`));
  }
  console.log('');
}

// Run tests
testRegexPattern();
testPostimgUrls();
