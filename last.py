import sys
import json

if len(sys.argv) < 2:
    print('用法: python last_json.py <输入文件.jsonl>')
    sys.exit(1)

input_path = sys.argv[1]
last_valid = None
buffer = ''

with open(input_path, 'r', encoding='utf-8') as fin:
    for line in fin:
        line = line.rstrip('\n')
        if not line:
            continue
        if buffer:
            buffer += '\n' + line
        else:
            buffer = line
        try:
            last_valid = json.loads(buffer)
            buffer = ''
        except Exception:
            continue  # 继续拼接下一行

if last_valid is not None:
    print(json.dumps(last_valid, ensure_ascii=False, indent=2))
else:
    print('没有找到任何完整的 JSON 数据。')