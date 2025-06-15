import { CLog } from '@/utils/logUtil';
import { Emitter, type EventMap } from './emitter';
import pako from 'pako';
import {
  decodeChatMessage,
  decodeControlMessage,
  decodeEmojiChatMessage,
  decodeGiftMessage,
  decodeLikeMessage,
  decodeMemberMessage,
  decodePushFrame,
  decodeResponse,
  decodeRoomRankMessage,
  decodeRoomStatsMessage,
  decodeRoomUserSeqMessage,
  decodeSocialMessage,
  encodePushFrame
} from './model';
import type {
  GiftStruct,
  Message,
  RoomRankMessage_RoomRank,
  RoomUserSeqMessage_Contributor,
  Text,
  User
} from './model';
import { getImInfo, getLiveInfo } from './request';
import { getSignature } from './signature';

/**
 * 连接状态
 *  - 0 - 未连接
 *  - 1 - 连接中(连接完成)
 *  - 2 - 连接失败
 *  - 3 - 已断开
 */
export type ConnectStatus = 0 | 1 | 2 | 3;

/** 直播间信息 */
export interface LiveRoom {
  /**
   * 在线观众数
   */
  audienceCount?: number | string;
  /**
   * 本场点赞数
   */
  likeCount?: number | string;
  /**
   * 主播粉丝数
   */
  followCount?: number | string;
  /**
   * 累计观看人数
   */
  totalUserCount?: number | string;
  /** 房间状态 */
  status?: number;
}

/** 直播间信息-连接信息 */
export interface DyLiveInfo {
  roomNum?: string;
  roomId: string;
  uniqueId: string;
  avatar: string;
  cover: string;
  nickname: string;
  title: string;
  status: number;
}
/** 直播间信息-初次连接信息 */
export interface DyImInfo {
  cursor?: string;
  fetchInterval?: string;
  now?: string;
  internalExt?: string;
  fetchType?: number;
  pushServer?: string;
  liveCursor?: string;
}

/**
 * 送礼点赞榜
 */
export interface LiveRankItem {
  nickname: string;
  avatar: string;
  rank: number | string;
}

export interface CastUser {
  // user.sec_uid | user.id_str
  id?: string;
  // user.nickname
  name?: string;
  // user.avatar_thumb.url_list.0
  avatar?: string;
  // 性别 0 | 1 | 2 => 未知 | 男 | 女
  gender?: number;
}

export interface CastGift {
  id?: string;
  name?: string;
  // 抖音币 diamond_count
  price?: number;
  type?: number;
  // 描述
  desc?: string;
  // 图片
  icon?: string;
  // 数量 repeat_count | combo_count
  count?: number | string;
  // 礼物消息可能重复发送，0 表示第一次，未重复
  repeatEnd?: number;
}

/**
 * 富文本类型
 *  1 - 普通文本
 *  2 - 合并表情
 */
export enum CastRtfContentType {
  TEXT = 1,
  EMOJI = 2
}

// 富文本
export interface CastRtfContent {
  type?: CastRtfContentType;
  text?: string;
  url?: string;
}

export interface DyMessage {
  id?: string;
  method?: CastMethod;
  user?: CastUser;
  gift?: CastGift;
  content?: string;
  rtfContent?: CastRtfContent[];
  room?: LiveRoom;
  rank?: LiveRankItem[];
  roomNum?: string;
  timestamp?: number;
}

export enum CastMethod {
  CHAT = 'WebcastChatMessage',
  GIFT = 'WebcastGiftMessage',
  LIKE = 'WebcastLikeMessage',
  MEMBER = 'WebcastMemberMessage',
  SOCIAL = 'WebcastSocialMessage',
  ROOM_USER_SEQ = 'WebcastRoomUserSeqMessage',
  CONTROL = 'WebcastControlMessage',
  ROOM_RANK = 'WebcastRoomRankMessage',
  ROOM_STATS = 'WebcastRoomStatsMessage',
  EMOJI_CHAT = 'WebcastEmojiChatMessage',
  FANSCLUB = 'WebcastFansclubMessage',
  ROOM_DATA_SYNC = 'WebcastRoomDataSyncMessage',
  /** 自定义消息 */
  CUSTOM = 'CustomMessage'
}

/**
 * 直播间直播状态
 */
export enum RoomStatus {
  PREPARE = 1,
  LIVING = 2,
  PAUSE = 3,
  END = 4
}
/** 客户端状态 */
enum WSRoomStatus {
  /** 未连接 */
  UNCONNECTED = 1,
  /** 正在连接 */
  CONNECTING = 2,
  /** 连接中|已连接 */
  CONNECTED = 3,
  /** 重连中 */
  RECONNECTING = 4,
  /** 已关闭 */
  CLOSED = 5
}

/**
 * DyCast Event
 */
interface DyCastEvent extends EventMap {
  /**
   * 监听ws打开
   * @param ev
   * @returns
   */
  open: (ev?: Event, info?: DyLiveInfo) => void;
  /**
   * 监听关闭
   * @param code
   * @param reason
   * @returns
   */
  close: (code: number, reason: string) => void;
  /**
   * 监听错误
   * @param e
   * @returns
   */
  error: (e: Error) => void;
  /**
   * 监听弹幕
   * @param messages
   * @returns
   */
  message: (messages: DyMessage[]) => void;
  /** 重连中 */
  reconnecting: (count?: number, code?: DyCastCloseCode, reason?: string) => void;
  /** 重连完成 */
  reconnect: (ev?: Event) => void;
  /** 直播状态变化 */
  statusChange: (oldStatus: RoomStatus, newStatus: RoomStatus) => void;
}

/**
 * 自定义关闭码
 */
export enum DyCastCloseCode {
  /** 正常关闭 */
  NORMAL = 1000,
  /** 终端离开，可能因为服务端错误，也可能因为浏览器正从打开连接的页面跳转离开 */
  GOING_AWAY = 1001,
  /** 由于协议错误而中断连接 */
  PROTOCOL_ERROR = 1002,
  /** 接收到不允许的数据类型而断开连接 */
  UNSUPPORTED = 1003,
  /** 没有收到预期的状态码 */
  NO_STATUS = 1005,
  /** 没有处理关闭帧 */
  ABNORMAL = 1006,
  /** 应用自定义状态码 */
  /** 主播未开播 */
  LIVE_END = 4001,
  /** 连接过程错误 */
  CONNECTING_ERROR = 4002,
  /** 无法正常接收信息 */
  CANNOT_RECEIVE = 4003,
  /** 因重连关闭 */
  RECONNECTING = 4004
}

// 配置
export interface DyCastOptions {
  aid?: string;
  app_name?: string;
  browser_language?: string;
  browser_name?: string;
  browser_online?: boolean;
  browser_platform?: string;
  browser_version?: string;
  compress?: string;
  cookie_enabled?: boolean;
  cursor: string;
  device_platform?: string;
  did_rule?: number;
  endpoint?: string;
  heartbeatDuration?: string;
  host?: string;
  identity?: string;
  im_path?: string;
  insert_task_id?: string;
  internal_ext: string;
  live_id?: number;
  live_reason?: string;
  need_persist_msg_count?: string;
  room_id: string;
  screen_height?: number;
  screen_width?: number;
  signature: string;
  support_wrds?: number;
  tz_name?: string;
  update_version_code?: string;
  user_unique_id: string;
  version_code?: string;
  webcast_sdk_version?: string;
  // 添加钩子配置
  hooks?: {
    onLiveStart?: string; // 开播时执行的命令
    onLiveEnd?: string;   // 下播时执行的命令
  };
}

interface DyCastCursor {
  cursor?: string;
  firstCursor?: string;
  internalExt?: string;
}

/**
 * dycast 自定义关闭信息
 */
interface DyCastCloseEvent {
  code: number;
  msg: string;
}

// 消息体类型
enum PayloadType {
  Ack = 'ack',
  Close = 'close',
  Hb = 'hb',
  Msg = 'msg'
}

/** API */
// const BASE_URL = 'wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/';
const BASE_URL = `${location.origin.replace(/^http/, 'ws')}/socket/webcast/im/push/v2/`;

/** SDK 版本 */
const VERSION = '1.0.14-beta.0';

/**
 * 默认配置
 */
const defaultOpts: Partial<DyCastOptions> = {
  aid: '6383',
  app_name: 'douyin_web',
  browser_language: 'zh-CN',
  browser_name: 'Mozilla',
  browser_online: true,
  browser_platform: 'Win32',
  browser_version:
    '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  compress: 'gzip',
  cookie_enabled: true,
  device_platform: 'web',
  did_rule: 3,
  endpoint: 'live_pc',
  heartbeatDuration: '0',
  host: 'https://live.douyin.com',
  identity: 'audience',
  im_path: '/webcast/im/fetch/',
  insert_task_id: '',
  live_id: 1,
  live_reason: '',
  need_persist_msg_count: '15',
  screen_height: 1080,
  screen_width: 1920,
  support_wrds: 1,
  tz_name: 'Asia/Shanghai',
  update_version_code: VERSION,
  version_code: '180800',
  webcast_sdk_version: VERSION
};

export class DyCast {
  /** 房间号 */
  private roomNum: string;

  /** 房间信息 */
  private info: DyLiveInfo;

  // 初次连接信息
  private imInfo: DyImInfo;

  /** WS客户端 */
  private ws: WebSocket | undefined;

  /** 连接 url */
  private url: string | undefined;

  // 连接状态
  private state: boolean;

  /** 客户端状态 */
  private wsRoomStatus: WSRoomStatus;

  /** 直播间直播状态 */
  private status: RoomStatus;

  /** 连接配置 */
  private options: DyCastOptions | undefined;

  // 心跳
  // 主要用于检查消息接收是否正常
  private heartbeatDuration: number = 10000;
  // 心跳次数
  private pingCount: number = 0;
  // 心跳阈值
  // 如果 heartbeatDuration ms 内心跳次数大于等于该值，证明消息接收出错
  // 即 如果 10000 ms 内都没接收到新消息，证明消息接收出错
  private downgradePingCount: number = 2;

  private pingTimer: number | undefined = void 0;

  // 上次接收时间
  private lastReceiveTime: number;

  private cursor: DyCastCursor;

  /**
   * 自定义实现的 错误信息提示
   *  - 由于 dycast 的服务端并不会正确处理关闭帧
   *  - 调用 websocket close 后，关闭监听返回 1006
   */
  private closeEvent: DyCastCloseEvent;

  /** 当前重连次数 */
  private reconnectCount: number;
  /** 最大重连尝试次数 */
  private maxReconnectCount: number;
  // 是否需要重连
  private shouldReconnect: boolean;
  // 正在重连中
  private isReconnecting: boolean;

  // 订阅者
  private emitter: Emitter<DyCastEvent>;

  constructor(roomNum: string) {
    // 初始化
    this.roomNum = roomNum;
    this.state = !1;
    // 10秒心跳
    this.heartbeatDuration = 10000;
    this.pingCount = 0;
    this.downgradePingCount = 2;
    this.cursor = {
      cursor: '',
      firstCursor: '',
      internalExt: ''
    };
    // 当前重连次数
    this.reconnectCount = 0;
    // 最大重连次数
    this.maxReconnectCount = 3;
    // 上一次接收消息时间
    this.lastReceiveTime = Date.now();
    // 当前客户端状态
    this.wsRoomStatus = WSRoomStatus.UNCONNECTED;
    this.shouldReconnect = !1;
    /**
     * 默认情况
     *  - 即未收到预期的状态码
     */
    this.closeEvent = { code: 1005, msg: 'CLOSE_NO_STATUS' };
    this.info = {
      roomId: '',
      uniqueId: '',
      avatar: '',
      cover: '',
      nickname: '',
      title: '',
      status: 4
    };
    this.imInfo = {};
    this.status = RoomStatus.END;
    this.emitter = new Emitter<DyCastEvent>();
    this.isReconnecting = false;
  }

  /**
   * 监听
   * @param event
   * @param listener
   */
  public on<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.on(event, listener);
  }

  /**
   * 取消监听
   * @param event
   * @param listener
   */
  public off<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.off(event, listener);
  }

  /**
   * 一次性监听
   *  - 如监听打开关闭
   * @param event
   * @param listener
   */
  public once<K extends keyof DyCastEvent>(event: K, listener: DyCastEvent[K]) {
    this.emitter.once(event, listener);
  }

  /**
   * 连接
   * @returns
   */
  public async connect() {
    try {
      if (this.state) {
        this.emitter.emit('error', Error('已连接，请勿重复连接'));
        return;
      }
      await this.fetchConnectInfo(this.roomNum);
      const params = this.getWssParam();
      if (this.isLiving()) {
        // 连接中
        this.wsRoomStatus = WSRoomStatus.CONNECTING;
        this._connect(params);
      } else {
        // 主播未开播
        const liveStatus = this.getLiveStatus();
        this.wsRoomStatus = WSRoomStatus.CLOSED;
        this.emitter.emit('close', DyCastCloseCode.LIVE_END, liveStatus.msg);
      }
    } catch (err) {
      // 过程错误
      CLog.error('房间连接前错误 =>', err);
      // 关闭
      this.emitter.emit('close', DyCastCloseCode.CONNECTING_ERROR, '房间连接前出错');
      this._afterClose();
      // 报错
      this.emitter.emit('error', err as Error);
    }
  }

  /**
   * 获取当前连接状态
   */
  public getRoomStatus() {
    return this.wsRoomStatus;
  }

  /**
   * 实际连接逻辑
   * @param opts
   */
  private _connect(opts: DyCastOptions) {
    // 连接前的初始化
    this.options = opts;
    this.url = this._getSocketUrl(opts);
    this.cursor = {
      cursor: '',
      firstCursor: opts.cursor,
      internalExt: opts.internal_ext
    };
    this.lastReceiveTime = Date.now();
    this.pingCount = 0;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.addEventListener('open', (ev: Event) => {
        // 可能初次打开，也可能是重连打开
        if (this.reconnectCount > 0) {
          // 重连成功
          this.reconnectCount = 0;
          this.emitter.emit('reconnect', ev);
        } else {
          // 初次连接
          this.emitter.emit('open', ev, this.info);
        }
        this.ping();
        this._afterOpen();
      });
      this.ws.addEventListener('close', (ev: CloseEvent) => {
        this.handleClose(ev);
      });
      this.ws.addEventListener('error', (ev: Event) => {
        this.emitter.emit('error', Error(ev.type || 'Unknown Error'));
      });
      this.ws.addEventListener('message', (ev: MessageEvent) => {
        this.handleMessage(ev.data);
      });
    } catch (err) {
      CLog.error('房间连接过程错误 =>', err);
      // 可能原因为 WebSocket 不可用
      // 关闭
      this.emitter.emit('close', DyCastCloseCode.CONNECTING_ERROR, '房间连接过程出错');
      this._afterClose();
      // 报错
      this.emitter.emit('error', err as Error);
    }
  }

  /** 处理关闭 */
  private handleClose(ev: CloseEvent) {
    let { code, reason } = ev;
    let msg: string = reason.toString();
    switch (code) {
      case DyCastCloseCode.NO_STATUS:
      case DyCastCloseCode.ABNORMAL:
        code = this.closeEvent.code || code;
        msg = this.closeEvent.msg || msg || 'closed';
        break;
    }
    this._afterClose();
    if (this.shouldReconnect || this.reconnectCount > 0) {
      // 需要重连
      this.reconnect();
    } else {
      // 正常关闭
      this.emitter.emit('close', code, msg);
    }
  }

  /**
   * 处理消息
   */
  private async handleMessage(data: ArrayBuffer) {
    this.pingCount = 0;
    this.lastReceiveTime = Date.now();
    let res;
    try {
      res = await this._decodeFrame(new Uint8Array(data));
      console.log('解码后的消息:', res);
    } catch (err) {
      console.error('消息解码错误:', err);
      res = null;
    }
    if (!res) return;
    const { response, frame, cursor, needAck, internalExt } = res;
    if (needAck) {
      // 发送 ack
      const ack = this._ack(internalExt, frame?.logId);
      this.setCursor(cursor, internalExt);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(ack);
      } else {
        // 重连
        CLog.error(`ACK发送异常 => 直播间[${this.roomNum}]已关闭`);
        this._afterClose();
      }
    }
    // 处理消息体
    if (frame) {
      // 判断消息体类型
      if (frame.payloadType === PayloadType.Msg) {
        console.log('处理消息体:', response.messages);
        this._dealMessages(response.messages);
      }
      if (frame.payloadType === PayloadType.Close) {
        // 关闭连接
        this.close(DyCastCloseCode.NORMAL, 'Close By PayloadType');
      }
    }
  }

  /**
   * 重连
   */
  private reconnect() {
    // 还未关闭
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.close(DyCastCloseCode.RECONNECTING, '因重连而关闭');
    }
    this.shouldReconnect = !1;
    const opts: DyCastOptions = Object.assign({}, this.options, {
      cursor: this.cursor.cursor,
      internal_ext: this.cursor.internalExt
    });
    this.reconnectCount++;
    if (this.reconnectCount > this.maxReconnectCount) {
      CLog.error('已超过最大重连次数，请稍后重试');
      this.emitter.emit('error', Error('已超过最大重连次数，请稍后重试'));
      return;
    }
    this.wsRoomStatus = WSRoomStatus.RECONNECTING;
    this.emitter.emit('reconnecting', this.reconnectCount);
    this.isReconnecting = true;
    this._connect(opts);
  }

  /**
   * 关闭
   */
  public close(code: number = 1005, reason: string = 'close') {
    if (this.ws) {
      this.state = !1;
      this.closeEvent = { code, msg: reason };
      // 无需传 code，因为抖音弹幕ws服务端并不会处理关闭帧
      this.ws.close();
      this.ws = void 0;
    }
  }

  /**
   * 发送心跳帧
   */
  private ping() {
    try {
      let dur = Math.max(10000, Number(this.heartbeatDuration));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // 连接正常
        // 发送心跳 => hb
        this.ws.send(this._ping());
        this.pingCount++;
        if (this.pingCount >= this.downgradePingCount) {
          return this.cannotReceiveMessage();
        }
      }
      // 心跳：大概每 10 秒发送一次
      this.pingTimer = setTimeout(() => {
        this.state && this.ping();
      }, dur);
    } catch (err) {
      // 发送过程出错
      CLog.error('DyCast Ping Error =>', err);
    }
  }

  /**
   * 无法正常接收消息
   *  - 长时间未接收到消息
   */
  private cannotReceiveMessage() {
    // 先关闭
    this.close(DyCastCloseCode.CANNOT_RECEIVE, '客户端无法正常接收信息');
    let tmp = Date.now() - this.lastReceiveTime;
    CLog.error(`DyCast Cannot Receive Message => after ${tmp} ms`);
    // 重连
    this.emitter.emit('reconnecting', this.reconnectCount, DyCastCloseCode.CANNOT_RECEIVE, '客户端无法正常接收信息');
    this.reconnectCount < this.maxReconnectCount && (this.shouldReconnect = !0);
  }

  /**
   * 设置 cursor
   * @param cur
   * @param ext
   */
  private setCursor(cur: string, ext: string) {
    this.cursor.cursor = cur;
    this.cursor.internalExt = ext;
    if (!this.cursor.firstCursor) {
      this.cursor.firstCursor = cur;
    }
  }

  /**
   * 处理消息列表
   * @param messages
   */
  private async _dealMessages(messages: Message[]) {
    console.log('开始处理消息列表:', messages);
    const list: DyMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const data = await this._dealMessage(msg);
      if (data) {
        // 如果没有时间戳，添加当前时间
        if (data.timestamp === undefined) {
          data.timestamp = Date.now();
        }
        list.push(data);
      }
    }
    console.log('处理完成的消息列表:', list);
    if (list.length) {
      this.emitter.emit('message', list);
    }
  }

  /**
   * 处理一条消息
   * @param msg
   */
  private async _dealMessage(msg: Message) {
    const method = msg.method;
    const data: DyMessage | null = {};
    data.id = msg.msgId;
    data.roomNum = this.roomNum;
    let message = null;
    let payload = msg.payload;
    if (!payload) return null;
    try {
      // 处理消息
      switch (method) {
        case CastMethod.CHAT:
          message = decodeChatMessage(payload);
          data.method = CastMethod.CHAT;
          data.user = this._getCastUser(message.user);
          data.content = message.content;
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          // 获取富文本：包含合并表情
          data.rtfContent = this._getCastRtfContent(message.rtfContentV2);
          break;
        case CastMethod.GIFT:
          message = decodeGiftMessage(payload);
          data.method = CastMethod.GIFT;
          data.user = this._getCastUser(message.user);
          data.gift = this._getCastGift(message.gift, message.repeatCount || message.comboCount, message.repeatEnd);
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.LIKE:
          message = decodeLikeMessage(payload);
          data.method = CastMethod.LIKE;
          data.user = this._getCastUser(message.user);
          data.content = `为主播点赞了(${message.count})`;
          data.room = { likeCount: message.total };
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.MEMBER:
          message = decodeMemberMessage(payload);
          data.method = CastMethod.MEMBER;
          data.user = this._getCastUser(message.user);
          data.content = '进入直播间';
          data.room = { audienceCount: message.memberCount };
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.SOCIAL:
          message = decodeSocialMessage(payload);
          data.method = CastMethod.SOCIAL;
          data.user = this._getCastUser(message.user);
          data.content = '关注了主播';
          data.room = { followCount: message.followCount };
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.EMOJI_CHAT:
          message = decodeEmojiChatMessage(payload);
          data.method = CastMethod.EMOJI_CHAT;
          data.user = this._getCastUser(message.user);
          data.content = this._getCastEmoji(message.emojiContent);
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.ROOM_USER_SEQ:
          message = decodeRoomUserSeqMessage(payload);
          data.method = CastMethod.ROOM_USER_SEQ;
          data.rank = this._getCastRanksA(message.ranks);
          data.room = { audienceCount: message.total, totalUserCount: message.totalUser };
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.CONTROL:
          message = decodeControlMessage(payload);
          data.method = CastMethod.CONTROL;
          data.content = message.common?.describe;
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          const newStatus = parseInt(message.action || '') || void 0;
          if (newStatus !== undefined && newStatus !== this.status) {
            const oldStatus = this.status;
            this.status = newStatus;
            // 触发状态变化事件
            this.emitter.emit('statusChange', oldStatus, newStatus);
            // 执行钩子命令
            this._executeHooks(oldStatus, newStatus);
          }
          data.room = { status: newStatus };
          break;
        case CastMethod.ROOM_RANK:
          message = decodeRoomRankMessage(payload);
          data.method = CastMethod.ROOM_RANK;
          data.rank = this._getCastRanksB(message.ranks);
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
        case CastMethod.ROOM_STATS:
          message = decodeRoomStatsMessage(payload);
          data.method = CastMethod.ROOM_STATS;
          data.room = { audienceCount: message.displayMiddle };
          data.timestamp = message.common?.createTime ? parseInt(message.common.createTime) : undefined;
          break;
      }
      if (!data.method) return null;
    } catch (err) {
      CLog.error('处理消息错误 =>', err);
      return null;
    }
    return data;
  }

  /**
   * 获取当前的送礼榜单
   * @param data
   */
  private _getCastRanksA(data?: RoomUserSeqMessage_Contributor[]): LiveRankItem[] | undefined {
    if (!data || !data.length) return void 0;
    const list: LiveRankItem[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      list.push({
        avatar: item.user?.avatarThumb?.urlList?.[0] || '',
        nickname: item.user?.nickname || '',
        rank: item.rank || i + 1
      });
    }
    return list;
  }

  /**
   * 获取当前的送礼榜单
   * @param data
   */
  private _getCastRanksB(data?: RoomRankMessage_RoomRank[]): LiveRankItem[] | undefined {
    if (!data || !data.length) return void 0;
    const list: LiveRankItem[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      list.push({
        avatar: item.user?.avatarThumb?.urlList?.[0] || '',
        nickname: item.user?.nickname || '',
        rank: item.scoreStr || i + 1
      });
    }
    return list;
  }

  /**
   * 获取弹幕用户
   * @param data
   * @returns
   */
  private _getCastUser(data?: User): CastUser | undefined {
    if (!data) return void 0;
    return {
      id: data.secUid,
      name: data.nickname,
      gender: data.gender,
      avatar: data.avatarThumb?.urlList?.[0]
    };
  }

  /**
   * 获取弹幕礼物
   * @param data
   * @returns
   */
  private _getCastGift(data?: GiftStruct, count?: string, end?: number): CastGift | undefined {
    if (!data) return void 0;
    return {
      id: data.id,
      name: data.name,
      price: data.diamondCount,
      type: data.type,
      desc: data.describe,
      icon: data.image?.urlList?.[0],
      count: count,
      repeatEnd: end
    };
  }

  /**
   * 获取会员表情
   * @param data
   * @returns
   */
  private _getCastEmoji(data?: Text): string | undefined {
    if (!data) return void 0;
    return data.pieces?.[0]?.imageValue?.image?.urlList?.[0];
  }

  /**
   * 获取弹幕富文本内容
   * @param data
   * @returns
   */
  private _getCastRtfContent(data?: Text): CastRtfContent[] | undefined {
    if (!data) return void 0;
    if (!data.pieces) return void 0;
    const pieces = data.pieces;
    const list: CastRtfContent[] = [];
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].imageValue) {
        list.push({
          type: CastRtfContentType.TEXT,
          text: pieces[i].stringValue
        });
      } else {
        let url = pieces[i].imageValue?.image?.urlList?.[0];
        let name = pieces[i].imageValue?.image?.content?.name;
        list.push({
          type: CastRtfContentType.EMOJI,
          text: name,
          url
        });
      }
    }
    return list;
  }

  /**
   * 处理接收的二进制消息
   * @param data
   */
  private async _decodeFrame(data: Uint8Array) {
    const frame = decodePushFrame(data);
    let payload = frame.payload;
    const headers = frame.headersList;
    let cursor = '';
    let internalExt = '';
    let needAck = !1;
    if (!payload) return null;
    if (headers) {
      if (headers['compress_type'] && headers['compress_type'] === 'gzip') {
        payload = pako.ungzip(payload);
      }
      if (headers['im-cursor']) {
        cursor = headers['im-cursor'];
      }
      if (headers['im-internal_ext']) {
        internalExt = headers['im-internal_ext'];
      }
    }
    const res = decodeResponse(payload);
    if (!cursor && res.cursor) cursor = res.cursor;
    if (!internalExt && res.internalExt) internalExt = res.internalExt;
    if (res.needAck) needAck = res.needAck;
    return {
      response: res,
      frame,
      cursor,
      needAck,
      internalExt
    };
  }

  /** 心跳数据 */
  private _ping() {
    return encodePushFrame({
      payloadType: PayloadType.Hb
    });
  }

  /**
   * Ack 数据
   * @param ext Frame im-internal_ext | Response internalExt
   * @param logId
   */
  private _ack(ext: string = '', logId?: string) {
    const getPayload = function (_ext: string) {
      let arr = [];
      for (let s of _ext) {
        let index = s.charCodeAt(0);
        index < 128
          ? arr.push(index)
          : index < 2048
          ? (arr.push(192 + (index >> 6)), arr.push(128 + (63 & index)))
          : index < 65536 &&
            (arr.push(224 + (index >> 12)), arr.push(128 + ((index >> 6) & 63)), arr.push(128 + (63 & index)));
      }
      return new Uint8Array(arr);
    };
    return encodePushFrame({
      payloadType: PayloadType.Ack,
      payload: getPayload(ext),
      logId
    });
  }

  /** 关闭后 */
  private _afterClose() {
    this.state = !1;
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = void 0;
    }
    this.cursor = {
      cursor: '',
      firstCursor: '',
      internalExt: ''
    };
    this.wsRoomStatus = WSRoomStatus.CLOSED;
    this.closeEvent = { code: DyCastCloseCode.NO_STATUS, msg: 'CLOSE_NO_STATUS' };
    this.ws = void 0;
    this.isReconnecting = false;
  }

  /** 打开后 */
  private _afterOpen() {
    this.state = !0;
    this.wsRoomStatus = WSRoomStatus.CONNECTED;
    this.isReconnecting = false;
    this.reconnectCount = 0;
  }

  /**
   * 获取完整的 wss 地址
   * @param opts
   * @returns
   */
  private _getSocketUrl(opts: DyCastOptions) {
    const fullOpt = Object.assign({}, defaultOpts, opts);
    return `${BASE_URL}?${this._mergeOptions(fullOpt)}`;
  }

  /**
   * 将配置转换为 url 参数字符串
   *  - 如：item1=value1&item2=value2&...
   * @param opts
   * @returns
   */
  private _mergeOptions(opts: any): string {
    return Object.keys(opts).reduce((t, n) => {
      let r;
      return `${t}${t ? '&' : ''}${n}=${null != (r = opts[n]) ? r : ''}`;
    }, '');
  }

  /**
   * 获取连接信息
   * @param roomNum
   * @returns
   */
  private async fetchConnectInfo(roomNum: string) {
    try {
      const info = await getLiveInfo(roomNum);
      this.info = info;
      this.status = info.status;
      const res = await getImInfo(info.roomId, info.uniqueId);
      this.imInfo = res;
    } catch (err) {
      // CLog.error('DyCast LiveInfo Request Error =>', err);
      return Promise.reject(err);
    }
  }

  /**
   * 整理连接参数对象
   */
  private getWssParam(): DyCastOptions {
    const { roomId, uniqueId } = this.info;
    const sign = getSignature(roomId, uniqueId);
    return {
      room_id: roomId,
      user_unique_id: uniqueId,
      cursor: this.imInfo.cursor || '',
      internal_ext: this.imInfo.internalExt || '',
      signature: sign
    };
  }

  /**
   * 是否已经直播
   */
  private isLiving() {
    return this.status === RoomStatus.LIVING;
  }

  /** 获取直播状态 */
  private getLiveStatus() {
    let type = 'Unknown';
    let code = 0;
    let msg = '未知状态';
    switch (this.status) {
      case RoomStatus.PREPARE:
        type = 'PREPARE';
        code = RoomStatus.PREPARE;
        msg = '主播正在准备中';
        break;
      case RoomStatus.LIVING:
        type = 'LIVING';
        code = RoomStatus.LIVING;
        msg = '主播正在直播中';
        break;
      case RoomStatus.PAUSE:
        type = 'PAUSE';
        code = RoomStatus.PAUSE;
        msg = '主播暂时离开了';
        break;
      case RoomStatus.END:
        type = 'END';
        code = RoomStatus.END;
        msg = '主播已下播';
        break;
    }
    return {
      type,
      code,
      msg
    };
  }

  /**
   * 获取直播间信息
   */
  public getLiveInfo(): DyLiveInfo {
    return {
      ...this.info,
      roomNum: this.roomNum
    };
  }

  /**
   * 执行钩子命令
   * @param oldStatus 旧状态
   * @param newStatus 新状态
   */
  private _executeHooks(oldStatus: RoomStatus, newStatus: RoomStatus) {
    if (!this.options?.hooks) return;

    // 开播时执行
    if (oldStatus !== RoomStatus.LIVING && newStatus === RoomStatus.LIVING) {
      if (this.options.hooks.onLiveStart) {
        this._runCommand(this.options.hooks.onLiveStart);
      }
    }
    
    // 下播时执行
    if (oldStatus === RoomStatus.LIVING && newStatus === RoomStatus.END) {
      if (this.options.hooks.onLiveEnd) {
        this._runCommand(this.options.hooks.onLiveEnd);
      }
    }
  }

  /**
   * 执行命令
   * @param command 要执行的命令
   */
  private _runCommand(command: string) {
    try {
      const { exec } = require('child_process');
      exec(command, (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error(`执行命令出错: ${error}`);
          return;
        }
        if (stderr) {
          console.error(`命令错误输出: ${stderr}`);
          return;
        }
        console.log(`命令输出: ${stdout}`);
      });
    } catch (err) {
      console.error('执行命令失败:', err);
    }
  }
}

/**
 * 多直播间管理器
 */
export class DyCastManager {
  private casts: Map<string, DyCast> = new Map();
  private emitter: Emitter<DyCastEvent>;

  constructor() {
    this.emitter = new Emitter<DyCastEvent>();
  }

  /**
   * 添加直播间
   * @param roomNum 房间号
   * @returns DyCast实例
   */
  public addRoom(roomNum: string): DyCast {
    if (this.casts.has(roomNum)) {
      return this.casts.get(roomNum)!;
    }

    const cast = new DyCast(roomNum);
    this.casts.set(roomNum, cast);

    // 转发事件
    cast.on('open', (ev, info) => this.emitter.emit('open', ev, info));
    cast.on('close', (code, reason) => this.emitter.emit('close', code, reason));
    cast.on('error', (e) => this.emitter.emit('error', e));
    cast.on('message', (messages) => this.emitter.emit('message', messages));
    cast.on('reconnecting', (count, code, reason) => this.emitter.emit('reconnecting', count, code, reason));
    cast.on('reconnect', (ev) => this.emitter.emit('reconnect', ev));

    return cast;
  }

  /**
   * 移除直播间
   * @param roomNum 房间号
   */
  public removeRoom(roomNum: string): void {
    const cast = this.casts.get(roomNum);
    if (cast) {
      cast.close();
      this.casts.delete(roomNum);
    }
  }

  /**
   * 获取直播间实例
   * @param roomNum 房间号
   * @returns DyCast实例
   */
  public getRoom(roomNum: string): DyCast | undefined {
    return this.casts.get(roomNum);
  }

  /**
   * 获取所有直播间
   * @returns 所有直播间实例
   */
  public getAllRooms(): DyCast[] {
    return Array.from(this.casts.values());
  }

  /**
   * 关闭所有直播间
   */
  public closeAll(): void {
    this.casts.forEach(cast => cast.close());
    this.casts.clear();
  }

  /**
   * 事件监听
   */
  public on<K extends keyof DyCastEvent>(event: K, callback: DyCastEvent[K]): void {
    this.emitter.on(event, callback);
  }

  /**
   * 移除事件监听
   */
  public off<K extends keyof DyCastEvent>(event: K, callback: DyCastEvent[K]): void {
    this.emitter.off(event, callback);
  }
}
