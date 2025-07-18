<template>
  <div class="multi-cast-list">
    <div class="room-list">
      <div v-for="room in rooms" :key="room.roomNum" class="room-item">
        <div class="room-header">
          <div class="room-status">
            <span class="status-indicator" :class="getStatusInfo(room.status).className"></span>
            <span class="status-text">{{ getStatusInfo(room.status).text }}</span>
          </div>
          <span class="room-title">{{ room.info.nickname }} - {{ room.info.title }}</span>
          <div class="room-actions">
            <button class="close-btn" @click="removeRoom(room.roomNum)">关闭</button>
          </div>
        </div>
        <CastList :ref="el => setCastListRef(room.roomNum, el)" :room-num="room.roomNum" :types="['chat', 'gift', 'like', 'member', 'social']" />
      </div>
    </div>
    <div class="add-room">
      <input v-model="newRoomNum" placeholder="输入房间号" @keyup.enter="addRoom" />
      <button @click="addRoom">添加房间</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { DyCastManager } from '@/core/dycast';
import CastList from './CastList.vue';
import type { DyMessage, LiveRoom } from '@/core/dycast';
import { RoomWatcher } from '@/core/roomWatcher';
import { CLog } from '@/utils/logUtil';
import SkMessage from '@/components/Message';
import { formatDate } from '@/utils/commonUtil';

const manager = new DyCastManager();
const watcher = new RoomWatcher(manager);
const rooms = ref<Array<{ roomNum: string; info: any; status?: string }>>([]);
const newRoomNum = ref('');
const castListRefs = ref<{ [key: string]: any }>({});

// 用于连接后端录制服务的 WebSocket
let recorderWs: WebSocket | null = null;

let statusSyncTimer: number | undefined = undefined;

// 获取状态信息
const getStatusInfo = (status?: string) => {
  switch (status) {
    case 'living':
      return { text: '直播中', className: 'status-living' };
    case 'connecting':
      return { text: '连接中', className: 'status-connecting' };
    case 'end':
    case 'error':
    default:
      return { text: '已下播', className: 'status-end' };
  }
};

// 设置 CastList 组件引用
const setCastListRef = (roomNum: string, el: any) => {
  if (el) {
    console.log('设置 CastList 引用:', roomNum);
    castListRefs.value[roomNum] = el;
  }
};

// 监听房间状态变化
watcher.setStatusChangeCallback((roomNum, status, info) => {
  const idx = rooms.value.findIndex(r => r.roomNum === roomNum);
  if (status === 'living') {
    // 开播，获取房间信息
    if (idx === -1) {
      rooms.value.push({ roomNum, info, status });
    } else {
      rooms.value[idx].info = info;
      rooms.value[idx].status = status;
    }
  } else if (status === 'end') {
    // 下播，更新状态
    if (idx !== -1) rooms.value[idx].status = status;
  } else if (status === 'connecting') {
    if (idx !== -1) rooms.value[idx].status = status;
  } else if (status === 'error') {
    if (idx !== -1) rooms.value[idx].status = status;
  }
});

// 处理弹幕消息
const handleMessage = (messages: DyMessage[]) => {
  const roomNum = messages[0]?.roomNum;
  if (!roomNum) return; // 如果消息没有房间号，则直接忽略

  // 检查该房间是否仍在我们的监控列表中
  const isRoomActive = rooms.value.some(r => r.roomNum === roomNum);

  // 1. 如果房间是活动的，则更新UI
  if (isRoomActive) {
    const castList = castListRefs.value[roomNum];
    if (castList) {
      castList.appendCasts(messages);
      // 如果UI状态不是"直播中"，强制修正
      const room = rooms.value.find(r => r.roomNum === roomNum);
      if (room && room.status !== 'living') {
        room.status = 'living';
      }
    } else {
      CLog.warn('未找到对应的CastList组件', messages);
    }
  }

  // 2. 同样，只有当房间是活动的，才将弹幕发送给后端录制服务
  if (isRoomActive && recorderWs && recorderWs.readyState === WebSocket.OPEN) {
    recorderWs.send(JSON.stringify(messages));
  } else {
    // 如果房间已关闭，可以在这里打印一条调试日志
    if (!isRoomActive) {
      CLog.info(`已忽略来自已关闭房间 ${roomNum} 的消息`);
    } else {
      CLog.error('录制服务WebSocket未连接，无法发送弹幕');
    }
  }
};

const addRoom = async () => {
  if (!newRoomNum.value) return;
  watcher.addRoom(newRoomNum.value);
  // UI先显示，状态由回调更新
  if (!rooms.value.find(r => r.roomNum === newRoomNum.value)) {
    rooms.value.push({ roomNum: newRoomNum.value, info: {}, status: 'connecting' });
  }
  newRoomNum.value = '';
};

const removeRoom = (roomNum: string) => {
  watcher.removeRoom(roomNum);
  rooms.value = rooms.value.filter(room => room.roomNum !== roomNum);
  delete castListRefs.value[roomNum];
};

// 连接到后端录制服务
const connectRecorder = () => {
  const wsUrl = 'ws://localhost:8765';
  recorderWs = new WebSocket(wsUrl);

  recorderWs.onopen = () => {
    CLog.info('成功连接到本地录制服务');
    SkMessage.success('已连接到录制服务，将自动保存弹幕');
  };

  recorderWs.onmessage = (event) => {
    // 后端现在不回传消息，但保留以备将来扩展
    CLog.info('收到录制服务消息:', event.data);
  };

  recorderWs.onclose = () => {
    CLog.warn('与本地录制服务的连接已断开');
    SkMessage.warning('录制服务已断开，请检查server.py是否在运行');
    // 可在此处添加自动重连逻辑
  };

  recorderWs.onerror = (error) => {
    CLog.error('连接本地录制服务时出错:', error);
    SkMessage.error('无法连接到录制服务，请确保已启动server.py');
    recorderWs = null;
  };
};

onMounted(() => {
  manager.on('message', handleMessage);
  connectRecorder();

  // 定时同步底层状态到UI
  statusSyncTimer = window.setInterval(() => {
    rooms.value.forEach(room => {
      const cast = manager.getRoom(room.roomNum);
      if (cast) {
        // 这里假设 cast.isLiving() 返回 true/false
        if (cast.isLiving && cast.isLiving() && room.status !== 'living') {
          room.status = 'living';
        } else if (cast.isLiving && !cast.isLiving() && room.status === 'living') {
          room.status = 'end';
        }
      }min
    });
  }, 300000); // 每5min同步一次
});

onUnmounted(() => {
  manager.closeAll();
  manager.off('message', handleMessage);
  if (recorderWs) recorderWs.close();
  if (statusSyncTimer) clearInterval(statusSyncTimer);
});
</script>

<style scoped>
.multi-cast-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px;
}

.room-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 10px;
  padding: 10px;
}

.room-item {
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 500px;
}

.room-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background-color: #f5f5f5;
  border-bottom: 1px solid #ddd;
  gap: 8px;
}

.room-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-living {
  background-color: #52c41a; /* antd green */
  box-shadow: 0 0 5px #52c41a;
}

.status-connecting {
  background-color: #faad14; /* antd gold */
  animation: pulse 1.5s infinite;
}

.status-end {
  background-color: #bfbfbf; /* antd gray */
}

.status-text {
  font-size: 12px;
  font-weight: bold;
}

.room-title {
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.room-actions {
  display: flex;
  gap: 8px;
}

.close-btn {
  padding: 4px 8px;
  background-color: #ff4d4f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.close-btn:hover {
  background-color: #ff7875;
}

.add-room {
  display: flex;
  gap: 10px;
  padding: 10px;
  background-color: #f5f5f5;
  border-top: 1px solid #ddd;
}

.add-room input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.add-room button {
  padding: 8px 16px;
  background-color: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.add-room button:hover {
  background-color: #40a9ff;
}
</style> 