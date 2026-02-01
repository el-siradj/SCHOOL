const http = require('http');

// Test the PDF endpoint
const postData = JSON.stringify({
  date: '2026-01-24',
  section: null,
  min_days: 7,
  include_inactive: 0,
  stage: 0,
  student_ids: null
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/absences/notices/pdf',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'Authorization': 'Bearer fake-token-for-testing'
  }
};

console.log('Sending PDF request...');
const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', chunk => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✓ PDF generated successfully');
      console.log('Content-Type:', res.headers['content-type']);
      console.log('Size:', Buffer.byteLength(data), 'bytes');
    } else {
      console.log('✗ Error response:');
      try {
        console.log(JSON.parse(data));
      } catch {
        console.log(data.slice(0, 500));
      }
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(postData);
req.end();

// Wait 5 seconds then exit
setTimeout(() => {
  console.log('\nTest complete');
  process.exit(0);
}, 5000);
