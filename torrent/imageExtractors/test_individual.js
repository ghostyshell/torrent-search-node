const fastpicExtractor = require('./fastpicExtractor');

// Test individual fastpic URLs
async function testIndividualUrls() {
  console.log('Testing individual fastpic URLs...\n');

  const testUrls = [
    'https://fastpic.org/view/125/2025/0630/_8f8065ead21a577bc534c04d996be983.jpg.html',
    'https://fastpic.org/view/125/2025/0630/_8589621650a647e54363a76e48e49430.jpg.html',
    'https://fastpic.org/view/125/2025/0630/_7e0a7502d2d888807f5d70a01db91191.jpg.html',
  ];

  for (const url of testUrls) {
    console.log(`Testing: ${url}`);
    try {
      const result = await fastpicExtractor(url);
      console.log(`Result: ${result}`);
      console.log(
        `Has query params: ${result && result.includes('?md5=') ? 'YES' : 'NO'}`
      );
      console.log('---');
    } catch (error) {
      console.log(`Error: ${error.message}`);
      console.log('---');
    }
  }
}

testIndividualUrls();
