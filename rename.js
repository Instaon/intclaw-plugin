const fs = require('fs');
const path = require('path');

const dir = '/Users/bianhui/Documents/Code/yinta-chajian';
const ignoreFolders = ['node_modules', '.git', 'coverage', 'dist', '.github'];

function walk(directory) {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    if (ignoreFolders.includes(file)) continue;
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
    } else {
      if (!fullPath.match(/\.(ts|js|json|md|sh|mjs|env|example)$/) && !fullPath.includes('.env')) continue;
      
      let content = fs.readFileSync(fullPath, 'utf8');
      const original = content;
      
      // Brand names
      content = content.replace(/阿里钉钉/g, 'IntClaw Plugin');
      content = content.replace(/钉钉/g, 'IntClaw');
      content = content.replace(/DingTalk/g, 'IntClaw');
      content = content.replace(/dingtalk/g, 'intclaw');
      content = content.replace(/Dingtalk/g, 'Intclaw');
      
      if (content !== original) {
        fs.writeFileSync(fullPath, content);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}
walk(dir);
