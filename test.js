const fs = require('fs');
const content = fs.readFileSync('shapez-multiplayer.js', 'utf8');
console.log(content.includes('shapez.SavegameSerializer'));
