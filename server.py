import asyncio
import websockets
import time
import json
import os

# --- 设置 ---
# 是否在控制台打印每一批弹幕的录制记录
VERBOSE_LOGGING = True
# 创建用于存放弹幕记录的文件夹
RECORDINGS_DIR = "recordings"
if not os.path.exists(RECORDINGS_DIR):
    os.makedirs(RECORDINGS_DIR)

async def handler(websocket):
    print(f"[{time.ctime()}] New client connected from {websocket.remote_address}")
    try:
        async for message in websocket:
            try:
                # 假设前端发来的是JSON字符串数组
                casts = json.loads(message)
                
                # 按房间号分组
                casts_by_room = {}
                for cast in casts:
                    room_num = cast.get("roomNum")
                    if not room_num:
                        continue
                    if room_num not in casts_by_room:
                        casts_by_room[room_num] = []
                    casts_by_room[room_num].append(cast)

                # 将弹幕写入对应文件
                for room_num, room_casts in casts_by_room.items():
                    file_path = os.path.join(RECORDINGS_DIR, f"{room_num}.jsonl")
                    with open(file_path, "a", encoding="utf-8") as f:
                        for cast in room_casts:
                            f.write(json.dumps(cast, ensure_ascii=False) + "\\n")
                    
                    if VERBOSE_LOGGING:
                        print(f"[{time.ctime()}] Recorded {len(room_casts)} casts for room {room_num}")

            except json.JSONDecodeError:
                print(f"[{time.ctime()}] Received non-JSON message: {message}")
            except Exception as e:
                print(f"[{time.ctime()}] Error processing message: {e}")

    except websockets.exceptions.ConnectionClosed as e:
        print(f"[{time.ctime()}] Client disconnected: {e}")
    except Exception as e:
        print(f"[{time.ctime()}] An unexpected error occurred: {e}")


async def main():
    print('WebSocket 服务启动成功，可在 ws://localhost:8765 访问')
    print(f'弹幕记录将保存在 ./{RECORDINGS_DIR} 文件夹中')
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("服务已手动停止.")

'''
# 创建一个WebSocket服务端
# 用于接收解析到的弹幕数据
# 测试弹幕转发功能
'''