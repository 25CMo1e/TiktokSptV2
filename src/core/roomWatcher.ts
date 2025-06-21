import { DyCastManager, CastMethod, RoomStatus } from './dycast';
import type { DyCast } from './dycast';

/**
 * 房间监控器：通过WebSocket事件检测房间开播/下播，自动连接和断开
 */
export class RoomWatcher {
  private manager: DyCastManager;
  private roomNums: Set<string> = new Set();
  private statusMap: Map<string, boolean> = new Map(); // true=已连接/开播，false=未开播
  private onStatusChange?: (roomNum: string, status: 'living' | 'end' | 'connecting' | 'error', info?: any) => void;
  private eventBound: Set<string> = new Set(); // 记录已绑定事件的房间
  private roomPollTimers: Map<string, any> = new Map();
  private pollAttempts: Map<string, number> = new Map();
  private connectionQueue: string[] = [];
  private isProcessingQueue = false;
  /**
   * 平台级API请求间隔(ms)
   * 防止在短时间内对多个房间同时发起连接请求，导致被服务器误判为恶意攻击
   */
  private fetchDelay = 500;

  constructor(manager: DyCastManager) {
    this.manager = manager;
  }

  /** 设置状态变更回调 */
  setStatusChangeCallback(cb: (roomNum: string, status: 'living' | 'end' | 'connecting' | 'error', info?: any) => void) {
    this.onStatusChange = cb;
  }

  /** 添加房间号到监控队列 */
  addRoom(roomNum: string) {
    if (this.roomNums.has(roomNum)) return;
    this.roomNums.add(roomNum);
    this.statusMap.set(roomNum, false);
    this.pollAttempts.set(roomNum, 0);
    this.connectRoom(roomNum); // 立即尝试连接
  }

  /** 移除房间号 */
  removeRoom(roomNum: string) {
    this.roomNums.delete(roomNum);
    this.statusMap.delete(roomNum);
    this.eventBound.delete(roomNum);
    this.pollAttempts.delete(roomNum);

    const timer = this.roomPollTimers.get(roomNum);
    if (timer) {
      clearTimeout(timer);
      this.roomPollTimers.delete(roomNum);
    }

    const cast = this.manager.getRoom(roomNum);
    if (cast) cast.close();
  }

  /**
   * 将房间加入连接队列，并触发队列处理
   * @param roomNum 房间号
   */
  private connectRoom(roomNum: string) {
    // 如果房间已在队列中，或已连接，则不重复添加
    if (this.connectionQueue.includes(roomNum) || this.statusMap.get(roomNum)) {
      return;
    }
    console.log(`[RoomWatcher] Queuing connection for room: ${roomNum}`);
    this.connectionQueue.push(roomNum);
    this._processConnectionQueue();
  }

  /**
   * 按顺序处理连接队列，确保请求之间有延迟
   */
  private async _processConnectionQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.connectionQueue.length > 0) {
      const roomNum = this.connectionQueue.shift()!;

      // 在处理之前再次检查房间是否仍然有效且未连接
      if (this.roomNums.has(roomNum) && !this.statusMap.get(roomNum)) {
        await this._performConnection(roomNum);
      }

      // 如果队列中还有其他房间，则等待
      if (this.connectionQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.fetchDelay));
      }
    }

    this.isProcessingQueue = false;
  }

  /** 执行单个房间的连接逻辑 */
  private async _performConnection(roomNum: string) {
    try {
      // 获取或创建房间实例
      let cast = this.manager.getRoom(roomNum);
      if (!cast) {
        cast = this.manager.addRoom(roomNum);
      }

      // 绑定事件（如果未绑定）
      this.bindRoomEvents(cast, roomNum);

      // 只在未连接时尝试连接
      if (!this.statusMap.get(roomNum)) {
        this.onStatusChange?.(roomNum, 'connecting');
        const attempts = this.pollAttempts.get(roomNum) || 0;
        this.pollAttempts.set(roomNum, attempts + 1);
        await cast.connect();
      }
    } catch (err) {
      // 连接失败，安排下一次轮询
      this.scheduleNextPoll(roomNum);
    }
  }

  /** 绑定房间事件 */
  private bindRoomEvents(cast: DyCast, roomNum: string) {
    if (this.eventBound.has(roomNum)) return;
    
    cast.on('open', (ev, info) => {
      this.statusMap.set(roomNum, true);
      this.onStatusChange?.(roomNum, 'living', info);

      // 连接成功，停止轮询
      const timer = this.roomPollTimers.get(roomNum);
      if (timer) {
        clearTimeout(timer);
        this.roomPollTimers.delete(roomNum);
      }
      this.pollAttempts.set(roomNum, 0);
    });

    const handleDisconnect = (reason: any, isError: boolean) => {
      const wasConnected = !!this.statusMap.get(roomNum);
      this.statusMap.set(roomNum, false);
      this.onStatusChange?.(roomNum, isError ? 'error' : 'end', reason);
      
      // 修正：无论之前是否连接，都要继续轮询
      this.scheduleNextPoll(roomNum);
    };

    cast.on('close', (code, reason) => {
      handleDisconnect(reason, false);
    });

    cast.on('error', (err) => {
      handleDisconnect(err, true);
    });

    cast.on('message', (messages) => {
      // 检查开播/下播消息
      for (const msg of messages) {
        if (msg.method === CastMethod.CONTROL) {
          if (msg.room?.status === RoomStatus.LIVING) {
            // 主播开播
            const isConnected = this.statusMap.get(roomNum);
            this.statusMap.set(roomNum, true);
            this.onStatusChange?.(roomNum, 'living', msg.room);
            // 如果未连接，则连接
            if (!isConnected) {
              this.connectRoom(roomNum);
            }
          } else if (msg.room?.status === RoomStatus.END) {
            // 主播下播
            this.statusMap.set(roomNum, false);
            this.onStatusChange?.(roomNum, 'end', '主播已下播');
          }
          break;
        }
      }
    });

    this.eventBound.add(roomNum);
  }

  /** 获取所有监控房间号 */
  getRooms() {
    return Array.from(this.roomNums);
  }

  /** 安排下一次轮询 */
  private scheduleNextPoll(roomNum: string) {
    if (!this.roomNums.has(roomNum)) return; // 如果房间已被移除，则不安排

    const attempts = this.pollAttempts.get(roomNum) || 0;
    // 首次重试（第二次尝试）间隔5秒，后续间隔5min
    const interval = attempts <= 1 ? 5000 : 300000;
    
    console.log(`[RoomWatcher] Scheduling next poll for ${roomNum} in ${interval / 1000}s. Attempt: ${attempts}`);

    const timer = setTimeout(() => {
      this.connectRoom(roomNum);
    }, interval);

    this.roomPollTimers.set(roomNum, timer);
  }
} 