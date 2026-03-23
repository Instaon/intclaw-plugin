import fs from 'fs';

const files = [
  'src/services/messaging/send.ts',
  'src/gateway-methods.ts',
  'src/core/message-handler.ts',
  'src/channel.ts',
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf-8');

  // Interface attributes
  code = code.replace(/cardInstanceId\?:\s*string;\n?/g, '');
  code = code.replace(/usedAICard\?:\s*boolean;\n?/g, '');
  code = code.replace(/useAICard\?:\s*boolean;\n?/g, '');
  code = code.replace(/fallbackToNormal\?:\s*boolean;\n?/g, '');

  // Returns
  code = code.replace(/,\s*usedAICard:\s*(false|true)/g, '');
  code = code.replace(/usedAICard:\s*(false|true),?[ \t]*/g, '');

  // Destructurings (like const { ..., useAICard, fallbackToNormal } = ...)
  code = code.replace(/,\s*useAICard/g, '');
  code = code.replace(/useAICard\s*,/g, '');
  code = code.replace(/,\s*fallbackToNormal/g, '');
  code = code.replace(/fallbackToNormal\s*,/g, '');

  // Object assignments (like useAICard: useAICard !== false,)
  code = code.replace(/useAICard:\s*[^,\n]+,?[ \t]*\n?/g, '');
  code = code.replace(/fallbackToNormal:\s*[^,\n]+,?[ \t]*\n?/g, '');

  fs.writeFileSync(file, code);
}
console.log('Finished sweeping remaining AI Card flags');
