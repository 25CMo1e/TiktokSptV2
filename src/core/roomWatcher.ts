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

  constructor(manager: DyCastManager) {
    this.manager = manager;
  }

  /** 设置状态变更回调 */
  setStatusChangeCallback(cb: (roomNum: string, status: 'living' | 'end' | 'connecting' | 'error', info?: any) => void) {
    this.onStatusChange = cb;
  }

  /** 添加房间号到监控队列 */
  addRoom(roomNum: string) {
    this.roomNums.add(roomNum);
    this.statusMap.set(roomNum, false);
    this.connectRoom(roomNum);
  }

  /** 移除房间号 */
  removeRoom(roomNum: string) {
    this.roomNums.delete(roomNum);
    this.statusMap.delete(roomNum);
    this.eventBound.delete(roomNum);
    const cast = this.manager.getRoom(roomNum);
    if (cast) cast.close();
  }

  /** 连接房间 */
  private async connectRoom(roomNum: string) {
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
        await cast.connect();
      }
    } catch (err) {
      this.statusMap.set(roomNum, false);
      this.onStatusChange?.(roomNum, 'error', err);
    }
  }

  /** 绑定房间事件 */
  private bindRoomEvents(cast: DyCast, roomNum: string) {
    if (this.eventBound.has(roomNum)) return;
    
    cast.on('open', (ev, info) => {
      this.statusMap.set(roomNum, true);
      this.onStatusChange?.(roomNum, 'living', info);
    });

    cast.on('close', (code, reason) => {
      this.statusMap.set(roomNum, false);
      this.onStatusChange?.(roomNum, 'end', reason);
    });

    cast.on('error', (err) => {
      this.statusMap.set(roomNum, false);
      this.onStatusChange?.(roomNum, 'error', err);
    });

    cast.on('message', (messages) => {
      // 检查下播消息
      for (const msg of messages) {
        if (msg.method === CastMethod.CONTROL && msg.room?.status !== RoomStatus.LIVING) {
          this.statusMap.set(roomNum, false);
          this.onStatusChange?.(roomNum, 'end', '主播已下播');
          cast.close();
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
} 