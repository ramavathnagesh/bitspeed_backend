// This file forwards to the compiled TypeScript output
// It's needed because Render looks for index.js in the root

// First, build if needed
const fs = require('fs');
const path = require('path');

const distIndex = path.join(__dirname, 'dist', 'src', 'index.js');

if (!fs.existsSync(distIndex)) {
  console.log('Building TypeScript...');
  require('child_process').execSync('npm run build', { stdio: 'inherit' });
}

// Start the server
require('./dist/src/index.js');

