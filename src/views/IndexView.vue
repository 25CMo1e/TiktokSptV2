<template>
  <div class="index-view">
    <div class="view-left">
      <LiveInfo
        :cover="cover"
        :title="title"
        :avatar="avatar"
        :nickname="nickname"
        :follow-count="followCount"
        :member-count="memberCount"
        :user-count="userCount"
        :like-count="likeCount"
        :status="liveStatus"
      />
      <div class="view-left-bottom">
        <div class="view-left-tools">
          <div class="view-left-tool" title="保存弹幕" @click.stop="saveCastToFile">
            <i class="ice-save"></i>
          </div>
        </div>
        <hr class="hr" />
        <LiveStatusPanel ref="panel" :status="connectStatus" />
      </div>
    </div>
    <div class="view-center">
      <!-- 主要弹幕：聊天、礼物 -->
      <CastList :types="['chat', 'gift']" ref="castEl" />
    </div>
    <div class="view-right">
      <div class="view-input">
        <ConnectInput
          ref="roomInput"
          label="房间号"
          placeholder="请输入房间号"
          v-model:value="roomNum"
          :test="verifyRoomNumber"
          @confirm="connectLive"
          @cancel="disconnectLive" />
        <ConnectInput
          ref="relayInput"
          label="WS地址"
          placeholder="请输入转发地址"
          confirm-text="转发"
          cancel-text="停止"
          v-model:value="relayUrl"
          :test="verifyWssUrl"
          @confirm="relayCast"
          @cancel="stopRelayCast" />
      </div>
      <div class="view-other">
        <!-- 其它弹幕：关注、点赞、进入、控制台等 -->
        <CastList ref="otherEl" :types="['social', 'like', 'member']" pos="left" no-prefix theme="dark" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ConnectInput from '@/components/ConnectInput.vue';
import LiveInfo from '@/components/LiveInfo.vue';
import LiveStatusPanel from '@/components/LiveStatusPanel.vue';
import CastList from '@/components/CastList.vue';
import {
  CastMethod,
  DyCast,
  DyCastCloseCode,
  RoomStatus,
  type ConnectStatus,
  type DyLiveInfo,
  type DyMessage,
  type LiveRoom
} from '@/core/dycast';
import { verifyRoomNum, verifyWsUrl } from '@/utils/verifyUtil';
import { ref, useTemplateRef, onMounted, onUnmounted } from 'vue';
import { CLog } from '@/utils/logUtil';
import { getId } from '@/utils/idUtil';
import { RelayCast } from '@/core/relay';
import SkMessage from '@/components/Message';
import { formatDate } from '@/utils/commonUtil';
import FileSaver from '@/utils/fileUtil';

// 本地存储的 Key
const LOCAL_STORAGE_KEY = 'dy-casts-autosave';
// 连接状态
const connectStatus = ref<ConnectStatus>(0);
// 转发状态
const relayStatus = ref<ConnectStatus>(0);
// 房间号
const roomNum = ref<string>('');
// 房间号输入框状态
const roomInputRef = useTemplateRef('roomInput');
// 转发地址
const relayUrl = ref<string>('');
const relayInputRef = useTemplateRef('relayInput');
// 状态面板
const statusPanelRef = useTemplateRef('panel');

/** 直播间信息 */
const cover = ref<string>('');
const title = ref<string>('*****');
const avatar = ref<string>('');
const nickname = ref<string>('***');
const followCount = ref<string | number>('*****');
const memberCount = ref<string | number>('*****');
const userCount = ref<string | number>('*****');
const likeCount = ref<string | number>('*****');
const liveStatus = ref<RoomStatus>(RoomStatus.END);

// 主要弹幕
const castRef = useTemplateRef('castEl');
// 其它弹幕
const otherRef = useTemplateRef('otherEl');
// 所有弹幕
const allCasts: DyMessage[] = [];
// 记录弹幕
const castSet = new Set<string>();
// 弹幕客户端
let castWs: DyCast | undefined;
// 转发客户端
let relayWs: RelayCast | undefined;

/** 自动保存定时器ID */
let autoSaveTimer: number | undefined;

/**
 * 验证房间号
 * @param value
 * @returns
 */
function verifyRoomNumber(value: string) {
  const flag = verifyRoomNum(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '房间号错误' };
  }
}

/**
 * 验证转发地址 WsUrl
 * @param value
 * @returns
 */
function verifyWssUrl(value: string) {
  const flag = verifyWsUrl(value);
  if (flag) return { flag, message: '' };
  else {
    return { flag, message: '转发地址错误' };
  }
}

/** 设置房间号输入框状态 */
const setRoomInputStatus = function (flag?: boolean) {
  if (roomInputRef.value) roomInputRef.value.setStatus(flag);
};

/** 设置转发地址输入框状态 */
const setRelayInputStatus = function (flag?: boolean) {
  if (relayInputRef.value) relayInputRef.value.setStatus(flag);
};

/**
 * 设置房间统计信息
 * @param room
 * @returns
 */
const setRoomCount = function (room?: LiveRoom) {
  if (!room) return;
  if (room.audienceCount) memberCount.value = `${room.audienceCount}`;
  if (room.followCount) followCount.value = `${room.followCount}`;
  if (room.likeCount) likeCount.value = `${room.likeCount}`;
  if (room.totalUserCount) userCount.value = `${room.totalUserCount}`;
};
/**
 * 设置直播间信息
 * @param info
 */
const setRoomInfo = function (info?: DyLiveInfo) {
  if (!info) return;
  if (info.cover) cover.value = info.cover;
  if (info.title) title.value = info.title;
  if (info.avatar) avatar.value = info.avatar;
  if (info.nickname) nickname.value = info.nickname;
  if (info.status) liveStatus.value = info.status as RoomStatus;
};

/**
 * 重置直播间信息
 */
const resetRoomInfo = function () {
  cover.value = '';
  title.value = '*****';
  avatar.value = '';
  nickname.value = '***';
  followCount.value = '*****';
  memberCount.value = '*****';
  userCount.value = '*****';
  likeCount.value = '*****';
  liveStatus.value = RoomStatus.END;
};

/**
 * 处理消息列表
 */
const handleMessages = function (msgs: DyMessage[]) {
  const newCasts: DyMessage[] = [];
  const mainCasts: DyMessage[] = [];
  const otherCasts: DyMessage[] = [];
  try {
    for (const msg of msgs) {
      if (!msg.id) continue;
      if (castSet.has(msg.id)) continue;
      castSet.add(msg.id);
      
      // 如果没有时间戳，添加当前时间
      if (msg.timestamp === undefined) {
        msg.timestamp = Date.now();
      }
      
      switch (msg.method) {
        case CastMethod.CHAT:
          newCasts.push(msg);
          mainCasts.push(msg);
          break;
        case CastMethod.GIFT:
          if (!msg?.gift?.repeatEnd) {
            newCasts.push(msg);
            mainCasts.push(msg);
          }
          break;
        case CastMethod.LIKE:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.MEMBER:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.SOCIAL:
          newCasts.push(msg);
          otherCasts.push(msg);
          setRoomCount(msg.room);
          break;
        case CastMethod.EMOJI_CHAT:
          newCasts.push(msg);
          mainCasts.push(msg);
          break;
        case CastMethod.ROOM_USER_SEQ:
          setRoomCount(msg.room);
          break;
        case CastMethod.ROOM_STATS:
          setRoomCount(msg.room);
          break;
        case CastMethod.CONTROL:
          if (msg?.room?.status !== RoomStatus.LIVING) {
            // 已经下播
            newCasts.push(msg);
            otherCasts.push(msg);
            disconnectLive();
          }
          break;
      }
    }
  } catch (err) {}
  // 记录
  allCasts.push(...newCasts);
  if (castRef.value) castRef.value.appendCasts(mainCasts);
  if (otherRef.value) otherRef.value.appendCasts(otherCasts);
  if (relayWs && relayWs.isConnected()) {
    relayWs.send(JSON.stringify(msgs));
  }
};

/**
 * 添加控制台消息
 * @param msg
 */
const addConsoleMessage = function (content: string) {
  if (otherRef.value)
    otherRef.value.appendCasts([
      {
        id: getId(),
        method: CastMethod.CUSTOM,
        content,
        user: { name: '控制台' }
      }
    ]);
};

/**
 * 清理列表
 */
function clearMessageList() {
  castSet.clear();
  allCasts.length = 0;
  if (castRef.value) castRef.value.clearCasts();
  if (otherRef.value) otherRef.value.clearCasts();
}

/**
 * 连接房间
 */
const connectLive = function () {
  try {
    // 清空上一次连接的消息
    clearMessageList();
    resetRoomInfo();
    CLog.debug('正在连接:', roomNum.value);
    SkMessage.info(`正在连接：${roomNum.value}`);
    const cast = new DyCast(roomNum.value);
    cast.on('open', (ev, info) => {
      CLog.info('DyCast 房间连接成功');
      SkMessage.success(`房间连接成功[${roomNum.value}]`);
      setRoomInputStatus(true);
      connectStatus.value = 1;
      setRoomInfo(info);
      addConsoleMessage('直播间已连接');
      
      // 启用自动重连功能
      cast.setAutoReconnect(true);
    });
    cast.on('error', err => {
      CLog.error('DyCast 连接出错 =>', err);
      SkMessage.error(`连接出错: ${err}`);
      connectStatus.value = 2;
      setRoomInputStatus(false);
    });
    cast.on('close', (code, reason) => {
      CLog.info(`DyCast 房间已关闭[${code}] => ${reason}`);
      connectStatus.value = 3;
      setRoomInputStatus(false);
      // 非重连中导致的关闭，都需要重置状态
      if (code !== 4004) {
        liveStatus.value = RoomStatus.END;
      }
      switch (code) {
        case DyCastCloseCode.NORMAL:
          SkMessage.success('断开成功');
          break;
        case DyCastCloseCode.LIVE_END:
          SkMessage.info('主播已下播');
          break;
        case DyCastCloseCode.CANNOT_RECEIVE:
          SkMessage.error('无法正常接收信息，已关闭');
          break;
        default:
          SkMessage.info('房间已关闭');
      }
      if (code === DyCastCloseCode.LIVE_END) {
        addConsoleMessage(reason || '主播尚未开播或已下播');
      } else {
        if (statusPanelRef.value) addConsoleMessage(`连接已关闭，共持续: ${statusPanelRef.value.getDuration()}`);
        else addConsoleMessage('连接已关闭');
      }
    });
    cast.on('message', msgs => {
      handleMessages(msgs);
    });
    cast.on('reconnecting', (count, code, reason) => {
      switch (code) {
        case DyCastCloseCode.CANNOT_RECEIVE:
          // 无法正常接收信息
          SkMessage.warning('无法正常接收弹幕，准备重连中');
          break;
        default:
          CLog.warn('DyCast 重连中 =>', count);
          SkMessage.warning(`正在重连中: ${count}`);
      }
    });
    cast.on('reconnect', ev => {
      CLog.info('DyCast 重连成功');
      SkMessage.success('房间重连完成');
    });
    cast.on('statusChange', (oldStatus, newStatus) => {
      CLog.info(`直播间状态变化: ${oldStatus} -> ${newStatus}`);
      liveStatus.value = newStatus;

      const getStatusText = (status: RoomStatus) => {
        switch (status) {
          case RoomStatus.PREPARE:
            return '准备中';
          case RoomStatus.LIVING:
            return '直播中';
          case RoomStatus.PAUSE:
          case RoomStatus.END:
            return '已下播';
          default:
            return '未知';
        }
      };
      
      const oldText = getStatusText(oldStatus);
      const newText = getStatusText(newStatus);

      if (oldText !== newText) {
        SkMessage.info(`直播间状态: ${newText}`);
        addConsoleMessage(`直播间状态变化: ${oldText} -> ${newText}`);
      }
    });
    cast.connect();
    castWs = cast;
  } catch (err) {
    CLog.error('房间连接过程出错:', err);
    SkMessage.error('房间连接过程出错');
    setRoomInputStatus(false);
    castWs = void 0;
  }
};
/** 断开连接 */
const disconnectLive = function () {
  if (castWs) castWs.close(1000, '断开连接');
  resetRoomInfo();
};

/** 连接转发房间 */
const relayCast = function () {
  try {
    CLog.info('正在连接转发中 =>', relayUrl.value);
    SkMessage.info(`转发连接中: ${relayUrl.value}`);
    const cast = new RelayCast(relayUrl.value);
    cast.on('open', () => {
      CLog.info(`DyCast 转发连接成功`);
      SkMessage.success(`已开始转发`);
      setRelayInputStatus(true);
      relayStatus.value = 1;
      addConsoleMessage('转发客户端已连接');
      if (castWs) {
        // 发送直播间信息给转发地址
        cast.send(JSON.stringify(castWs.getLiveInfo()));
      }
    });
    cast.on('close', (code, msg) => {
      CLog.info(`(${code})dycast 转发已关闭: ${msg || '未知原因'}`);
      if (code === 1000) SkMessage.info(`已停止转发`);
      else SkMessage.warning(`转发已停止: ${msg || '未知原因'}`);
      setRelayInputStatus(false);
      relayStatus.value = 0;
      addConsoleMessage('转发已关闭');
    });
    cast.on('error', ev => {
      CLog.warn(`dycast 转发出错: ${ev.message}`);
      SkMessage.error(`转发出错了: ${ev.message}`);
      setRelayInputStatus(false);
      relayStatus.value = 2;
    });
    cast.connect();
    relayWs = cast;
  } catch (err) {
    CLog.error('弹幕转发出错:', err);
    SkMessage.error('转发出错: ${err.message}');
    setRelayInputStatus(false);
    relayStatus.value = 2;
    relayWs = void 0;
  }
};
/** 暂停转发 */
const stopRelayCast = function () {
  if (relayWs) relayWs.close(1000);
};

/** 将弹幕保存到本地文件 */
const saveCastToFile = function () {
  if (connectStatus.value === 1) {
    SkMessage.warning('请断开连接后再保存');
    return;
  }

  // 合并内存中和浏览器缓存中的弹幕
  let finalCasts: DyMessage[] = [];
  try {
    const savedCastsJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedCastsJSON) {
      finalCasts = JSON.parse(savedCastsJSON);
    }
  } catch (e) {
    CLog.error('加载本地缓存弹幕失败', e);
    SkMessage.error('加载本地缓存弹幕失败，可能需要手动清除浏览器缓存');
  }
  // 合并当前内存中的弹幕
  finalCasts.push(...allCasts);

  const len = finalCasts.length;
  if (len <= 0) {
    SkMessage.warning('暂无弹幕需要保存');
    return;
  }
  const date = formatDate(new Date(), 'yyyy-MM-dd_HHmmss');
  const fileName = `[${roomNum.value}]${date}(${len})`;
  const data = JSON.stringify(finalCasts, null, 2);
  FileSaver.save(data, {
    name: fileName,
    ext: '.json',
    mimeType: 'application/json',
    description: '弹幕数据',
    existStrategy: 'new'
  })
    .then(res => {
      if (res.success) {
        SkMessage.success('弹幕保存成功，已包含所有自动备份的弹幕');
        // 保存成功后，只清除浏览器缓存中的备份，不清空内存和屏幕
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      } else {
        SkMessage.error('弹幕保存失败');
        CLog.error('弹幕保存失败 =>', res.message);
      }
    })
    .catch(err => {
      SkMessage.error('弹幕保存出错了');
      CLog.error('弹幕保存出错了 =>', err);
    });
};

/** 自动将弹幕备份到浏览器本地存储 */
const autoSaveToLocalStorage = () => {
  // 诊断日志：检查定时器是否触发，以及当时内存中的弹幕数量
  CLog.info(`[自动备份] 定时器触发，检查到内存中待备份弹幕数量为: ${allCasts.length}`);

  if (allCasts.length === 0) return;
  try {
    const existing = localStorage.getItem(LOCAL_STORAGE_KEY);
    const existingCasts = existing ? JSON.parse(existing) : [];
    const combinedCasts = [...existingCasts, ...allCasts];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(combinedCasts));

    // 清空内存中的弹幕，UI列表中的不清空，以保持展示
    allCasts.length = 0;
    // 使用一个温和的提示告知用户
    SkMessage.info('弹幕已自动备份');
    CLog.info(`已自动备份 ${combinedCasts.length} 条弹幕至浏览器缓存`);
  } catch (e) {
    CLog.error('自动备份到 localStorage 失败', e);
    SkMessage.error('自动备份弹幕失败，浏览器存储空间可能已满');
    // 如果存储失败，停止定时器，防止反复失败
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer);
      autoSaveTimer = undefined;
    }
  }
};

onMounted(() => {
  console.log('[DEBUG] 组件已挂载(onMounted)。准备设置自动备份定时器...');
  // 检查是否有上次未保存的弹幕
  try {
    const savedCasts = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedCasts) {
      const parsedCasts = JSON.parse(savedCasts);
      if (Array.isArray(parsedCasts) && parsedCasts.length > 0) {
        SkMessage.info(`发现 ${parsedCasts.length} 条未导出的弹幕，点击"保存弹幕"按钮可一并导出。`);
      }
    }
  } catch (e) {
    CLog.error('加载本地缓存弹幕失败', e);
    // 清理可能已损坏的数据
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  }

  // 每小时自动保存一次, 你可以改为20000(20秒)测试
  autoSaveTimer = window.setInterval(autoSaveToLocalStorage, 20000);
  console.log('[DEBUG] 定时器已设置。ID:', autoSaveTimer);
});

onUnmounted(() => {
  console.log('[DEBUG] 组件已卸载(onUnmounted)。准备清除定时器。ID:', autoSaveTimer);
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = undefined;
  }
});
</script>

<style lang="scss" scoped>
$bg: #f7f6f5;
$bd: #b2bfc3;
$theme: #68be8d;
$tool: #8b968d;

.index-view {
  position: relative;
  background-color: $bg;
  display: flex;
  width: 100%;
  height: 100%;
  .view-left,
  .view-center,
  .view-right {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    width: 0;
    flex-shrink: 0;
  }
  .view-left {
    flex-grow: 2.5;
    border-right: 1px solid $bd;
    justify-content: space-between;
  }
  .view-left-bottom {
    width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 12px 0;
    .hr {
      height: 0;
      border: 0;
      border-top: 1px solid $bd;
      margin: 5px 0;
    }
  }
  .view-left-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    box-sizing: border-box;
    padding: 0 12px;
  }
  .view-left-tool {
    font-size: 21px;
    width: 1.2em;
    height: 1.2em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: $tool;
    transition: color 0.2s ease-in-out, background-color 0.3s ease-in-out, opacity 0.2s ease;
    background-color: transparent;
    border-radius: 0.4em;
    i {
      font-size: 1em;
    }
    &:hover {
      color: #fff;
      background-color: $theme;
    }
    &:active {
      opacity: 0.8;
    }
  }
  .view-center {
    flex-grow: 4.5;
    padding: 18px 12px;
  }
  .view-right {
    flex-grow: 3;
    border-left: 1px solid $bd;
    padding: 18px 12px;
    gap: 12px;
  }
  .view-input {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .view-other {
    display: flex;
    width: 100%;
    height: 0;
    flex-grow: 1;
    box-sizing: border-box;
  }
}

@media (max-width: 768px) {
  .index-view {
    flex-direction: column;
    height: auto;
    .view-left,
    .view-center,
    .view-right {
      width: 100%;
      flex-grow: 0;
      border: none;
    }
    .view-left {
      margin-top: 250px;
      justify-content: flex-start;
    }
    .view-center {
      height: 100vh;
    }
    .view-right {
      height: 80vh;
    }
    .view-input {
      position: absolute;
      top: 0;
      left: 0;
      box-sizing: border-box;
      padding: 18px 12px;
    }
    .view-left-bottom {
      position: absolute;
      top: 150px;
      left: 0;
    }
  }
}
</style>
