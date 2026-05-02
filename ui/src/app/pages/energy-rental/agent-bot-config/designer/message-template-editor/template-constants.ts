/**
 * MessageTemplateEditor 静态配置常量（任务 23）。
 *
 * 权威源对齐：
 * 1. SCENE_METADATA 的 9 个 key 与 types.ts `MessageTemplates` 接口一一对应，
 *    对应后端 go-bot/internal/telegram/designer.go 的 `MessageTemplates` struct。
 * 2. AVAILABLE_VARIABLES 的 12 个 name 与顺序严格对齐
 *    go-bot/internal/telegram/template/template.go 的 `KnownVariables`。
 *    任何偏离都会导致前端提示与后端渲染结果不一致。
 *
 * 修改此文件必须同步更新：
 * - go-bot/internal/telegram/template/template.go 的 KnownVariables 列表
 * - go-bot/internal/telegram/template/template_test.go 的 want 列表
 * - types.ts 的 MessageTemplates 接口
 */

import { MessageTemplates, createEmptyMessageTemplates } from '../types';

/** 单个消息场景的 UI 元数据。 */
export interface SceneMetadata {
  /** MessageTemplates 的字段名（联合类型，编译期可穷举）。 */
  key: keyof MessageTemplates;
  /** Tab 上展示的短标签。 */
  label: string;
  /** 场景用途的一句话说明。 */
  description: string;
  /** 用户留空时 bot 端使用的 fallback 文案——需与后端保持一致。 */
  defaultText: string;
  /** 推荐在此场景使用的变量名子集（必须是 AVAILABLE_VARIABLES 的子集）。 */
  relevantVariables: readonly string[];
}

/** 单个可用变量的 UI 元数据。 */
export interface VariableMetadata {
  /** 变量名，与后端 KnownVariables 严格一致，用于占位符 `{name}`。 */
  name: string;
  /** 展示给用户看的中文标签。 */
  label: string;
  /** 预览示例值，仅用于 tooltip 提示，不参与渲染。 */
  example: string;
  /** 变量语义说明。 */
  description: string;
}

/**
 * 9 个消息场景元数据。顺序决定 tab 的展示顺序，按"用户生命周期"排列：
 * 欢迎 → 异常提示（命令/套餐/地址）→ 订单主链路 → 钱包查询。
 */
export const SCENE_METADATA: readonly SceneMetadata[] = [
  {
    key: 'welcome',
    label: '欢迎/主菜单',
    description: '用户发送 /start 或点击主菜单时推送',
    defaultText: '你好，欢迎使用 {botName}，请选择操作：',
    relevantVariables: ['botName'],
  },
  {
    key: 'unknownCommand',
    label: '未识别命令',
    description: '用户发送机器人无法识别的命令',
    defaultText: '命令 {command} 无法识别，请使用菜单操作。',
    relevantVariables: ['command'],
  },
  {
    key: 'packageUnavailable',
    label: '套餐不可用',
    description: '用户点击的套餐已下架或停售',
    defaultText: '套餐 {packageName} 暂不可用，请选择其他套餐。',
    relevantVariables: ['packageName'],
  },
  {
    key: 'addressInvalid',
    label: '地址无效',
    description: '用户输入的 TRON 地址格式或校验不通过',
    defaultText: '地址 {address} 格式不正确，请输入合法的 TRON 地址。',
    relevantVariables: ['address'],
  },
  {
    key: 'orderCreated',
    label: '订单创建成功',
    description: '用户提交订单后的确认消息',
    defaultText:
      '订单已创建\n订单号：{orderNo}\n套餐：{packageName}\n金额：{amount}\n能量：{energy}\n收能量地址：{address}\n请向 {payAddress} 付款。',
    relevantVariables: [
      'orderNo',
      'packageName',
      'amount',
      'energy',
      'address',
      'payAddress',
    ],
  },
  {
    key: 'payPending',
    label: '支付等待中',
    description: '订单已提交，等待链上确认',
    defaultText: '订单 {orderNo} 正在确认中，请耐心等待。',
    relevantVariables: ['orderNo'],
  },
  {
    key: 'paySuccess',
    label: '支付成功',
    description: '订单已完成，能量已委托',
    defaultText:
      '订单 {orderNo} 已完成\n能量：{energy}\n交易哈希：{txHash}',
    relevantVariables: ['orderNo', 'energy', 'txHash'],
  },
  {
    key: 'payFailed',
    label: '支付失败',
    description: '订单失败、超时或链上异常',
    defaultText: '订单 {orderNo} 失败\n原因：{reason}',
    relevantVariables: ['orderNo', 'reason'],
  },
  {
    key: 'walletQueryResult',
    label: '钱包查询结果',
    description: '用户点击钱包查询后返回结果',
    defaultText:
      '地址：{address}\nTRX 余额：{balance}\n带宽：{bandwidth}',
    relevantVariables: ['address', 'balance', 'bandwidth'],
  },
];

/**
 * 12 个可用变量元数据。
 *
 * 顺序与 go-bot KnownVariables 一致（orderNo 在前，command 在最后）。
 * 前端 spec 会做"name 数组严格等于后端"断言——**禁止随意调整顺序**。
 */
export const AVAILABLE_VARIABLES: readonly VariableMetadata[] = [
  {
    name: 'orderNo',
    label: '订单号',
    example: 'ORD20260502123456',
    description: '系统生成的订单编号',
  },
  {
    name: 'packageName',
    label: '套餐名',
    example: '5万能量包',
    description: '当前套餐名称',
  },
  {
    name: 'amount',
    label: '订单金额',
    example: '10.5 TRX',
    description: '订单应付金额（含单位）',
  },
  {
    name: 'energy',
    label: '能量数量',
    example: '65000',
    description: '套餐对应的能量额度',
  },
  {
    name: 'address',
    label: 'TRON 地址',
    example: 'TN7Yt...Rj9K',
    description: '收能量地址或用户输入地址',
  },
  {
    name: 'payAddress',
    label: '付款地址',
    example: 'TPayXxx...Yyy',
    description: '用户应付款到的 TRON 地址',
  },
  {
    name: 'txHash',
    label: '交易哈希',
    example: 'a1b2c3d4e5f6...',
    description: '链上委托交易的哈希',
  },
  {
    name: 'botName',
    label: 'Bot 名',
    example: '@energybot',
    description: 'Telegram Bot 的用户名',
  },
  {
    name: 'bandwidth',
    label: '带宽',
    example: '5000',
    description: '账户当前带宽',
  },
  {
    name: 'balance',
    label: 'TRX 余额',
    example: '12.34 TRX',
    description: '账户 TRX 余额（含单位）',
  },
  {
    name: 'reason',
    label: '错误原因',
    example: '余额不足',
    description: '失败、异常时的原因说明',
  },
  {
    name: 'command',
    label: '命令文本',
    example: '/help',
    description: '用户发送的原始命令',
  },
];

/** 空模板初值工厂别名——统一通过 types.ts 的工厂函数生成，避免重复定义。 */
export function createEmptyTemplates(): MessageTemplates {
  return createEmptyMessageTemplates();
}
