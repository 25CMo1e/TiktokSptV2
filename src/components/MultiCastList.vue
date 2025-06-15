<template>
  <div class="multi-cast-list">
    <div class="room-list">
      <div v-for="room in rooms" :key="room.roomNum" class="room-item">
        <div class="room-header">
          <span class="room-title">{{ room.info.nickname }} - {{ room.info.title }}</span>
          <div class="room-actions">
            <button class="save-btn" @click="saveRoomMessages(room.roomNum)">保存弹幕</button>
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
import type { DyMessage } from '@/core/dycast';
import { RoomWatcher } from '@/core/roomWatcher';

const manager = new DyCastManager();
const watcher = new RoomWatcher(manager);
const rooms = ref<Array<{ roomNum: string; info: any; status?: string }>>([]);
const newRoomNum = ref('');
const castListRefs = ref<{ [key: string]: any }>({});

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

// 保存房间弹幕
const saveRoomMessages = (roomNum: string) => {
  const castList = castListRefs.value[roomNum];
  if (!castList) return;
  const room = rooms.value.find(r => r.roomNum === roomNum);
  if (!room) return;
  const messages = castList.getAllCasts();
  const data = JSON.stringify(messages, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[${roomNum}]${new Date().toISOString().replace(/[:.]/g, '-')}(${messages.length}).json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// 处理弹幕消息
const handleMessage = (messages: DyMessage[]) => {
  console.log('收到消息:', messages);
  // 找到对应的 CastList 组件并添加消息
  const roomNum = messages[0]?.roomNum;
  console.log('房间号:', roomNum);
  console.log('当前房间列表:', rooms.value);
  console.log('CastList引用:', castListRefs.value);
  
  if (roomNum && castListRefs.value[roomNum]) {
    console.log('找到对应的CastList组件，添加消息');
    castListRefs.value[roomNum].appendCasts(messages);
  } else {
    console.log('未找到对应的CastList组件');
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

onMounted(() => {
  // 监听弹幕消息事件
  manager.on('message', handleMessage);
});

onUnmounted(() => {
  manager.closeAll();
  manager.off('message', handleMessage);
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
}

.room-title {
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-actions {
  display: flex;
  gap: 8px;
}

.save-btn {
  padding: 4px 8px;
  background-color: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.save-btn:hover {
  background-color: #40a9ff;
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