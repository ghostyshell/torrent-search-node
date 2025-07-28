const { extractImageLinks } = require('./imageExtractor');

// Test with the description from the torrent
const testDescription = `
Babes Thirst over Sharing BBC Together 2160p

Details On The Screens, Enjoy
Watching!

-=.SCRENS.=-

https://xxxwebdlxxx.top/img-6849e4c9ba87a.html

https://xxxwebdlxxx.top/img-6849e4c9c40ea.html

https://xxxwebdlxxx.top/img-6849e4ca0ef8b.html

https://xxxwebdlxxx.top/img-6849e4ca6f419.html

Big Ass, Big Cock, Blowjob,
Cowgirl, Cum On Tits, Doggy Style, FFM, Handjob, Interracial, Missionary,
Natural Tits, Redhead, Reverse Cowgirl, Straight, Teen, Threesome
`;

async function testXxxwebdlxxxExtractor() {
  console.log('Testing xxxwebdlxxx.top extractor...');

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log('Found image links:', imageLinks.length);

    for (const link of imageLinks) {
      console.log(`Original: ${link.originalUrl}`);
      console.log(`Direct: ${link.directUrl || 'Failed to extract'}`);
      console.log('---');
    }
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// Run the test
testXxxwebdlxxxExtractor();
