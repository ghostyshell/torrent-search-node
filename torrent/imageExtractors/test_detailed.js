const { extractImageLinks } = require('./index');

// Test function to see what URLs we actually extract
async function testFastpicExtractorDetailed() {
  console.log('Testing Fastpic Extractor - Detailed Analysis...');

  const testDescription = `
  SCREENLIST LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html
  
  SCREENSHOTS LINK
  BELOW
  
  https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html
  `;

  try {
    console.log('Processing URLs...');
    const imageLinks = await extractImageLinks(testDescription);

    console.log('\nExtracted image links:');
    imageLinks.forEach((link, index) => {
      console.log(`\n${index + 1}. Original: ${link.originalUrl}`);
      console.log(`   Direct:   ${link.directUrl}`);
      console.log(
        `   Has query params: ${
          link.directUrl.includes('?md5=') ? 'YES' : 'NO'
        }`
      );
    });
  } catch (error) {
    console.error('Error testing fastpic extractor:', error);
  }
}

// Run the test
testFastpicExtractorDetailed();
