const { extractImageLinks } = require('./index');

// Test function for fastpic extractor with debugging
async function testFastpicExtractorDebug() {
  console.log('Testing Fastpic Extractor with Debug...');

  const testDescription = `
  SCREENLIST LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html
  
  POSTER LINK
  BELOW
  
  https://i125.fastpic.org/big/2025/0630/13/09a2b3698a8c098ff135929c5102d213.jpg
  
  SCREENSHOTS LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html
  https://fastpic.org/view/125/2025/0630/_7e0a7502d2d888807f5d70a01db91191.jpg.html
  `;

  // Test the regex patterns manually first
  console.log('\nTesting patterns manually:');
  const imageHostPatterns = [
    /https?:\/\/trafficimage\.club\/image\/[a-zA-Z0-9]+/g,
    /https?:\/\/imgbb\.com\/[a-zA-Z0-9]+/g,
    /https?:\/\/postimg\.cc\/[a-zA-Z0-9]+/g,
    /https?:\/\/imgur\.com\/[a-zA-Z0-9]+/g,
    /https?:\/\/i\.imgur\.com\/[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)/g,
    /https?:\/\/fastpic\.org\/view\/\d+\/\d{4}\/\d{4}\/_[a-zA-Z0-9]+\.(jpg|jpeg|png|gif|webp)\.html/g,
    /https?:\/\/i\d+\.fastpic\.org\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g,
    /https?:\/\/[^.\s]+\.(jpg|jpeg|png|gif|webp)/g,
  ];

  const foundUrls = new Set();
  imageHostPatterns.forEach((pattern, index) => {
    const matches = testDescription.match(pattern);
    console.log(`Pattern ${index + 1}:`, matches);
    if (matches) {
      matches.forEach((url) => foundUrls.add(url));
    }
  });

  console.log('\nFound URLs:', Array.from(foundUrls));

  try {
    const imageLinks = await extractImageLinks(testDescription);
    console.log(
      '\nExtracted image links:',
      JSON.stringify(imageLinks, null, 2)
    );
  } catch (error) {
    console.error('Error testing fastpic extractor:', error);
  }
}

// Run the test
testFastpicExtractorDebug();
