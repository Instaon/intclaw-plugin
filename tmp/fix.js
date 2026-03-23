import fs from 'fs';

let code = fs.readFileSync('src/core/message-handler.ts', 'utf-8');

// Fix the syntax errors
code = code.replace(/msgType\s*:\s*'text'\s*:\s*false\s*:\s*true\s*,/g, "msgType: 'text',");

// Remove AICardTarget import
code = code.replace(/,\s*type\s*AICardTarget/g, '');
code = code.replace(/type\s*AICardTarget\s*,?/g, '');

fs.writeFileSync('src/core/message-handler.ts', code);
console.log('Fixed message-handler.ts');
