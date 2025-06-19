// 用法：node src/utils/convertDanmuFormat.js input.json output.json

const fs = require('fs');

// 时间格式化函数
function formatDate(date, format = 'HH:mm:ss') {
  const d = new Date(date);
  const pad = n => n.toString().padStart(2, '0');
  return format
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()))
    .replace('ss', pad(d.getSeconds()));
}

// 获取命令行参数
const [,, inputFile, outputFile] = process.argv;

if (!inputFile || !outputFile) {
  console.error('用法: node src/utils/convertDanmuFormat.js input.json output.json');
  process.exit(1);
}

// 读取原始数据
const raw = fs.readFileSync(inputFile, 'utf-8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error('输入文件不是合法的 JSON');
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error('输入文件内容应为数组');
  process.exit(1);
}

// 转换格式
const newData = data.map(item => ({
  ...item,
  timeStr: item.timestamp ? formatDate(item.timestamp, 'HH:mm:ss') : ''
}));

// 写入新文件
fs.writeFileSync(outputFile, JSON.stringify(newData, null, 2), 'utf-8');
console.log(`转换完成，输出文件: ${outputFile}`); 