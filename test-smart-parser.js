const parser = require('./smart-parser');

async function test() {
  console.log('⏳ Загрузка данных...\n');
  const results = await parser.parseAll();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 ИТОГИ:');
  console.log('='.repeat(50));
  
  let total = 0;
  for (const [key, names] of Object.entries(results)) {
    console.log(`${key.padEnd(15)} ${names.length} шт.`);
    total += names.length;
  }
  console.log('─'.repeat(30));
  console.log(`📦 ВСЕГО: ${total}`);
  
  console.log('\n✅ ГОТОВО! Если какие-то категории показывают 0,');
  console.log('отредактируйте parser-rules.json и запустите снова.');
}

test().catch(console.error);
