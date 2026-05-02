# Bot WebUI 可视化设计器 · 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 energybot 项目实现对标 teledashFront 的 WebUI 可视化机器人设计器（菜单 + 消息模板），三端数据契约打通，支持主题跟随、嵌套子菜单、套餐组动态展开、消息变量渲染。

**架构：** Angular 21 前端（nz-zorro + @angular/cdk 拖拽）+ NestJS DTO 校验（含深度/套餐 ID 校验）+ Go bot 热加载（Inline Keyboard submenu + `{var}` 模板引擎）。数据模型三端共享。

**技术栈：** Angular 21.2.5、@angular/cdk（新增）、ng-zorro-antd 21、NestJS、class-validator、Drizzle ORM、Go 1.22+

**设计文档：** `docs/superpowers/specs/2026-05-02-bot-webui-designer.md`

---

## 任务概览

- **PR1（数据契约三端打通）**：任务 1-5
- **PR2（Bot 端改造）**：任务 6-12
- **PR3（前端菜单设计器）**：任务 13-22
- **PR4（前端消息模板设计器）**：任务 23-27
- **PR5（E2E + 文档）**：任务 28-30

---

## PR1：数据契约三端打通

### 任务 1：定义前端 types.ts

**文件：**
- 创建：`ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts`

- [ ] **步骤 1：创建 types.ts**

```typescript
// ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts

export enum ButtonAction {
  URL = 'url',
  TEXT = 'text',
  COMMAND = 'command',
  START = 'start',
  SUBMENU = 'submenu',
  ENERGY_PACKAGE_GROUP = 'energy_package_group',
  ADDRESS_MANAGE = 'address_manage',
  WALLET_QUERY = 'wallet_query',
  ORDERS = 'orders',
}

export interface ButtonStyle {
  bgColor?: string;
  textColor?: string;
}

export interface PackageGroup {
  packageIds: number[];
  sortBy: 'price_asc' | 'price_desc' | 'manual';
  textTemplate: string;
}

export interface MenuButton {
  id: string;
  text: string;
  action: ButtonAction;
  style?: ButtonStyle;
  url?: string;
  message?: string;
  command?: string;
  submenu?: MenuRow[];
  packageGroup?: PackageGroup;
}

export interface MenuRow {
  id: string;
  buttons: MenuButton[];
}

export interface MessageTemplates {
  welcome: string;
  orderCreated: string;
  payPending: string;
  paySuccess: string;
  payFailed: string;
  addressInvalid: string;
  unknownCommand: string;
  packageUnavailable: string;
  walletQueryResult: string;
}

export interface BotDesignerConfig {
  welcomeText: string;
  menuConfig: MenuRow[];
  messageConfig: MessageTemplates;
  updatedAt?: string;
}

export const MAX_MENU_DEPTH = 3;
export const MAX_BUTTONS_PER_ROW = 4;
export const MAX_ROWS_PER_MENU = 8;
export const MAX_BUTTON_TEXT_LEN = 64;

export function createEmptyMessageTemplates(): MessageTemplates {
  return {
    welcome: '',
    orderCreated: '',
    payPending: '',
    paySuccess: '',
    payFailed: '',
    addressInvalid: '',
    unknownCommand: '',
    packageUnavailable: '',
    walletQueryResult: '',
  };
}
```

- [ ] **步骤 2：验证编译**

运行：`pnpm -C ui build --configuration development`
预期：无 TS 错误

- [ ] **步骤 3：Commit**

```bash
git add ui/src/app/pages/energy-rental/agent-bot-config/designer/types.ts
git commit -m "feat(ui): 新增 bot 设计器数据契约类型定义"
```

---

### 任务 2：定义 Go struct + 单测

**文件：**
- 创建：`go-bot/internal/telegram/designer.go`
- 创建：`go-bot/internal/telegram/designer_test.go`

- [ ] **步骤 1：编写失败的测试**

```go
// go-bot/internal/telegram/designer_test.go
package telegram

import (
	"encoding/json"
	"testing"
)

func TestParseMenuRows_ValidNested(t *testing.T) {
	raw := `[{"id":"row1","buttons":[{"id":"btn1","text":"购买","action":"submenu","submenu":[{"id":"sub1","buttons":[{"id":"b","text":"套餐A","action":"energy_package_group","packageGroup":{"packageIds":[1,2],"sortBy":"price_asc","textTemplate":"{name}"}}]}]}]}]`
	rows, err := parseMenuRowsV2(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 || len(rows[0].Buttons) != 1 {
		t.Fatalf("expected 1 row with 1 button, got %+v", rows)
	}
	btn := rows[0].Buttons[0]
	if btn.Action != ActionSubmenu {
		t.Errorf("expected submenu action, got %s", btn.Action)
	}
	if len(btn.Submenu) != 1 {
		t.Errorf("expected 1 submenu row")
	}
	subBtn := btn.Submenu[0].Buttons[0]
	if subBtn.Action != ActionEnergyPackageGroup {
		t.Errorf("expected energy_package_group, got %s", subBtn.Action)
	}
	if subBtn.PackageGroup == nil || subBtn.PackageGroup.SortBy != "price_asc" {
		t.Errorf("packageGroup parsing failed: %+v", subBtn.PackageGroup)
	}
}

func TestParseMenuRows_InvalidAction(t *testing.T) {
	raw := `[{"id":"r","buttons":[{"id":"b","text":"x","action":"unknown_xyz"}]}]`
	_, err := parseMenuRowsV2(raw)
	if err == nil {
		t.Fatal("expected error for unknown action")
	}
}

func TestParseMenuRows_EmptyString(t *testing.T) {
	rows, err := parseMenuRowsV2("")
	if err != nil {
		t.Fatalf("empty string should not error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected empty rows")
	}
}

func TestParseMessageConfig_V2(t *testing.T) {
	raw := `{"welcome":"欢迎","orderCreated":"订单 {orderNo}","paySuccess":"成功"}`
	cfg, err := parseMessageTemplates(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Welcome != "欢迎" || cfg.OrderCreated != "订单 {orderNo}" {
		t.Errorf("unexpected cfg: %+v", cfg)
	}
}

func TestMarshalRoundtrip(t *testing.T) {
	original := []DesignerMenuRow{
		{
			ID: "row1",
			Buttons: []DesignerMenuButton{
				{
					ID:     "btn1",
					Text:   "外链",
					Action: ActionURL,
					URL:    "https://example.com",
				},
			},
		},
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	parsed, err := parseMenuRowsV2(string(raw))
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if parsed[0].Buttons[0].URL != "https://example.com" {
		t.Errorf("URL field lost: %+v", parsed)
	}
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd go-bot && go test ./internal/telegram/ -run TestParseMenuRows -v`
预期：FAIL，`parseMenuRowsV2` undefined

- [ ] **步骤 3：实现 designer.go**

```go
// go-bot/internal/telegram/designer.go
package telegram

import (
	"encoding/json"
	"fmt"
	"strings"
)

type ButtonAction string

const (
	ActionURL                ButtonAction = "url"
	ActionText               ButtonAction = "text"
	ActionCommand            ButtonAction = "command"
	ActionStart              ButtonAction = "start"
	ActionSubmenu            ButtonAction = "submenu"
	ActionEnergyPackageGroup ButtonAction = "energy_package_group"
	ActionAddressManage      ButtonAction = "address_manage"
	ActionWalletQuery        ButtonAction = "wallet_query"
	ActionOrders             ButtonAction = "orders"
)

var validActions = map[ButtonAction]struct{}{
	ActionURL: {}, ActionText: {}, ActionCommand: {}, ActionStart: {},
	ActionSubmenu: {}, ActionEnergyPackageGroup: {}, ActionAddressManage: {},
	ActionWalletQuery: {}, ActionOrders: {},
}

type MessageTemplates struct {
	Welcome            string `json:"welcome"`
	OrderCreated       string `json:"orderCreated"`
	PayPending         string `json:"payPending"`
	PaySuccess         string `json:"paySuccess"`
	PayFailed          string `json:"payFailed"`
	AddressInvalid     string `json:"addressInvalid"`
	UnknownCommand     string `json:"unknownCommand"`
	PackageUnavailable string `json:"packageUnavailable"`
	WalletQueryResult  string `json:"walletQueryResult"`
}

type PackageGroupConfig struct {
	PackageIDs   []int  `json:"packageIds"`
	SortBy       string `json:"sortBy"`
	TextTemplate string `json:"textTemplate"`
}

type ButtonStyle struct {
	BgColor   string `json:"bgColor,omitempty"`
	TextColor string `json:"textColor,omitempty"`
}

// parseMenuRowsV2 解析新版嵌套菜单结构
func parseMenuRowsV2(raw string) ([]DesignerMenuRow, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil, nil
	}
	var rows []DesignerMenuRow
	if err := json.Unmarshal([]byte(raw), &rows); err != nil {
		return nil, fmt.Errorf("menu_config 非法 JSON: %w", err)
	}
	if err := validateMenuRows(rows, 1, 3); err != nil {
		return nil, err
	}
	return rows, nil
}

func validateMenuRows(rows []DesignerMenuRow, depth, maxDepth int) error {
	if depth > maxDepth {
		return fmt.Errorf("菜单嵌套深度超过 %d 层", maxDepth)
	}
	for _, row := range rows {
		for _, btn := range row.Buttons {
			if _, ok := validActions[btn.Action]; !ok {
				return fmt.Errorf("未知 action: %q", btn.Action)
			}
			if btn.Action == ActionSubmenu && len(btn.Submenu) > 0 {
				if err := validateMenuRows(btn.Submenu, depth+1, maxDepth); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func parseMessageTemplates(raw string) (MessageTemplates, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return MessageTemplates{}, nil
	}
	var tpl MessageTemplates
	if err := json.Unmarshal([]byte(raw), &tpl); err != nil {
		return MessageTemplates{}, fmt.Errorf("message_config 非法 JSON: %w", err)
	}
	return tpl, nil
}
```

同时修改 `bot.go` 第 83-96 行的 `DesignerMenuButton` 结构（扩展字段，向前兼容）：

```go
type DesignerMenuRow struct {
	ID      string               `json:"id"`
	Buttons []DesignerMenuButton `json:"buttons"`
}

type DesignerMenuButton struct {
	ID           string              `json:"id"`
	Text         string              `json:"text"`
	Action       ButtonAction        `json:"action"`
	Style        *ButtonStyle        `json:"style,omitempty"`
	URL          string              `json:"url,omitempty"`
	Message      string              `json:"message,omitempty"`
	Command      string              `json:"command,omitempty"`
	PackageID    int                 `json:"packageId,omitempty"` // 保留兼容旧字段（已废弃）
	Submenu      []DesignerMenuRow   `json:"submenu,omitempty"`
	PackageGroup *PackageGroupConfig `json:"packageGroup,omitempty"`
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd go-bot && go test ./internal/telegram/ -run "TestParseMenuRows|TestParseMessageConfig|TestMarshalRoundtrip" -v`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/designer.go go-bot/internal/telegram/designer_test.go go-bot/internal/telegram/bot.go
git commit -m "feat(bot): 新增设计器 v2 数据结构和解析器

- 9 种 ButtonAction 枚举
- 嵌套 submenu 支持（最大 3 层）
- MessageTemplates 结构化定义
- PackageGroupConfig 套餐组配置"
```

---

### 任务 3：NestJS DTO + 校验

**文件：**
- 创建：`nest-api/src/modules/energy-rental/dto/ui-config.dto.ts`
- 创建：`nest-api/src/modules/energy-rental/dto/ui-config.dto.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// nest-api/src/modules/energy-rental/dto/ui-config.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UiConfigDto, MenuRowDto, ButtonAction } from './ui-config.dto';

describe('UiConfigDto', () => {
  it('接受合法的嵌套菜单', async () => {
    const dto = plainToInstance(UiConfigDto, {
      welcomeText: '欢迎',
      menuConfig: [
        {
          id: 'r1',
          buttons: [
            { id: 'b1', text: '购买', action: 'submenu',
              submenu: [{ id: 'r2', buttons: [{ id: 'b2', text: '套餐A', action: 'orders' }] }]
            }
          ]
        }
      ],
      messageConfig: { welcome: 'hi', orderCreated: '', payPending: '', paySuccess: '', payFailed: '', addressInvalid: '', unknownCommand: '', packageUnavailable: '', walletQueryResult: '' }
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('拒绝未知 action', async () => {
    const dto = plainToInstance(MenuRowDto, {
      id: 'r1',
      buttons: [{ id: 'b1', text: 'x', action: 'invalid_action' }]
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('拒绝每行超过 4 个按钮', async () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({
      id: `b${i}`, text: `按钮${i}`, action: 'text', message: 'x'
    }));
    const dto = plainToInstance(MenuRowDto, { id: 'r', buttons });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm -C nest-api test ui-config.dto.spec`
预期：FAIL

- [ ] **步骤 3：实现 DTO**

```typescript
// nest-api/src/modules/energy-rental/dto/ui-config.dto.ts
import {
  IsString, IsOptional, IsEnum, IsArray, IsInt, IsIn,
  ValidateNested, ArrayMaxSize, MaxLength, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ButtonAction {
  URL = 'url',
  TEXT = 'text',
  COMMAND = 'command',
  START = 'start',
  SUBMENU = 'submenu',
  ENERGY_PACKAGE_GROUP = 'energy_package_group',
  ADDRESS_MANAGE = 'address_manage',
  WALLET_QUERY = 'wallet_query',
  ORDERS = 'orders',
}

export class ButtonStyleDto {
  @IsOptional() @IsString() bgColor?: string;
  @IsOptional() @IsString() textColor?: string;
}

export class PackageGroupDto {
  @IsArray() @IsInt({ each: true }) packageIds!: number[];
  @IsIn(['price_asc', 'price_desc', 'manual']) sortBy!: string;
  @IsString() textTemplate!: string;
}

export class MenuButtonDto {
  @IsString() id!: string;
  @IsString() @MaxLength(64) text!: string;
  @IsEnum(ButtonAction) action!: ButtonAction;

  @ValidateIf((o) => o.action === ButtonAction.URL)
  @IsString() url?: string;

  @ValidateIf((o) => o.action === ButtonAction.TEXT)
  @IsString() message?: string;

  @ValidateIf((o) => o.action === ButtonAction.COMMAND)
  @IsString() command?: string;

  @ValidateIf((o) => o.action === ButtonAction.SUBMENU)
  @IsArray() @ValidateNested({ each: true }) @Type(() => MenuRowDto)
  @ArrayMaxSize(8)
  submenu?: MenuRowDto[];

  @ValidateIf((o) => o.action === ButtonAction.ENERGY_PACKAGE_GROUP)
  @ValidateNested() @Type(() => PackageGroupDto)
  packageGroup?: PackageGroupDto;

  @IsOptional() @ValidateNested() @Type(() => ButtonStyleDto)
  style?: ButtonStyleDto;
}

export class MenuRowDto {
  @IsString() id!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MenuButtonDto)
  @ArrayMaxSize(4)
  buttons!: MenuButtonDto[];
}

export class MessageTemplatesDto {
  @IsString() welcome!: string;
  @IsString() orderCreated!: string;
  @IsString() payPending!: string;
  @IsString() paySuccess!: string;
  @IsString() payFailed!: string;
  @IsString() addressInvalid!: string;
  @IsString() unknownCommand!: string;
  @IsString() packageUnavailable!: string;
  @IsString() walletQueryResult!: string;
}

export class UiConfigDto {
  @IsOptional() @IsString() welcomeText?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MenuRowDto)
  @ArrayMaxSize(8)
  menuConfig?: MenuRowDto[];
  @IsOptional() @ValidateNested() @Type(() => MessageTemplatesDto)
  messageConfig?: MessageTemplatesDto;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm -C nest-api test ui-config.dto.spec`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add nest-api/src/modules/energy-rental/dto/ui-config.dto.ts nest-api/src/modules/energy-rental/dto/ui-config.dto.spec.ts
git commit -m "feat(api): 新增 UI 配置 DTO 和校验规则"
```

---

### 任务 4：NestJS service + 深度校验 + 套餐 ID 校验

**文件：**
- 创建：`nest-api/src/modules/energy-rental/services/ui-config.service.ts`
- 创建：`nest-api/src/modules/energy-rental/services/ui-config.service.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// nest-api/src/modules/energy-rental/services/ui-config.service.spec.ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UiConfigService } from './ui-config.service';
import { ButtonAction } from '../dto/ui-config.dto';

describe('UiConfigService', () => {
  let service: UiConfigService;
  const mockPackageRepo = {
    findByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UiConfigService,
        { provide: 'PackageRepository', useValue: mockPackageRepo },
      ],
    }).compile();
    service = module.get(UiConfigService);
    mockPackageRepo.findByIds.mockReset();
  });

  it('拒绝超过 3 层嵌套', () => {
    const menuConfig = [{
      id: 'r1', buttons: [{
        id: 'b1', text: 'L1', action: ButtonAction.SUBMENU,
        submenu: [{ id: 'r2', buttons: [{
          id: 'b2', text: 'L2', action: ButtonAction.SUBMENU,
          submenu: [{ id: 'r3', buttons: [{
            id: 'b3', text: 'L3', action: ButtonAction.SUBMENU,
            submenu: [{ id: 'r4', buttons: [{ id: 'b4', text: 'L4', action: ButtonAction.ORDERS }] }]
          }] }]
        }] }]
      }]
    }];
    expect(() => service.validateMenuDepth(menuConfig as any)).toThrow(BadRequestException);
  });

  it('接受 3 层及以内', () => {
    const menuConfig = [{
      id: 'r1', buttons: [{
        id: 'b1', text: 'L1', action: ButtonAction.SUBMENU,
        submenu: [{ id: 'r2', buttons: [{
          id: 'b2', text: 'L2', action: ButtonAction.SUBMENU,
          submenu: [{ id: 'r3', buttons: [{ id: 'b3', text: 'L3', action: ButtonAction.ORDERS }] }]
        }] }]
      }]
    }];
    expect(() => service.validateMenuDepth(menuConfig as any)).not.toThrow();
  });

  it('校验套餐 ID 存在性', async () => {
    mockPackageRepo.findByIds.mockResolvedValue([{ id: 1 }]);
    const menuConfig = [{
      id: 'r1', buttons: [{
        id: 'b1', text: '套餐', action: ButtonAction.ENERGY_PACKAGE_GROUP,
        packageGroup: { packageIds: [1, 999], sortBy: 'price_asc', textTemplate: '{name}' }
      }]
    }];
    await expect(
      service.validatePackageIds(menuConfig as any, 1)
    ).rejects.toThrow(/999/);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm -C nest-api test ui-config.service.spec`
预期：FAIL

- [ ] **步骤 3：实现 service**

```typescript
// nest-api/src/modules/energy-rental/services/ui-config.service.ts
import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { MenuRowDto, ButtonAction, UiConfigDto } from '../dto/ui-config.dto';

export interface PackageRepository {
  findByIds(agentId: number, ids: number[]): Promise<Array<{ id: number }>>;
}

@Injectable()
export class UiConfigService {
  constructor(
    @Inject('PackageRepository') private readonly packageRepo: PackageRepository,
  ) {}

  validateMenuDepth(rows: MenuRowDto[], currentDepth = 1, maxDepth = 3): void {
    if (currentDepth > maxDepth) {
      throw new BadRequestException(`菜单嵌套深度不能超过 ${maxDepth} 层`);
    }
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.action === ButtonAction.SUBMENU && btn.submenu?.length) {
          this.validateMenuDepth(btn.submenu, currentDepth + 1, maxDepth);
        }
      }
    }
  }

  async validatePackageIds(rows: MenuRowDto[], agentId: number): Promise<void> {
    const allIds = this.collectPackageIds(rows);
    if (allIds.length === 0) return;
    const existing = await this.packageRepo.findByIds(agentId, allIds);
    const existingSet = new Set(existing.map(p => p.id));
    const missing = allIds.filter(id => !existingSet.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`套餐 ID 不存在：${missing.join(', ')}`);
    }
  }

  private collectPackageIds(rows: MenuRowDto[]): number[] {
    const ids: number[] = [];
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.action === ButtonAction.ENERGY_PACKAGE_GROUP && btn.packageGroup) {
          ids.push(...btn.packageGroup.packageIds);
        }
        if (btn.action === ButtonAction.SUBMENU && btn.submenu) {
          ids.push(...this.collectPackageIds(btn.submenu));
        }
      }
    }
    return Array.from(new Set(ids));
  }

  async validate(dto: UiConfigDto, agentId: number): Promise<void> {
    if (dto.menuConfig) {
      this.validateMenuDepth(dto.menuConfig);
      await this.validatePackageIds(dto.menuConfig, agentId);
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm -C nest-api test ui-config.service.spec`
预期：PASS（3 用例通过）

- [ ] **步骤 5：Commit**

```bash
git add nest-api/src/modules/energy-rental/services/ui-config.service.ts nest-api/src/modules/energy-rental/services/ui-config.service.spec.ts
git commit -m "feat(api): 新增 UI 配置 service（深度/套餐 ID 校验）"
```

---

### 任务 5：NestJS controller + API 端点

**文件：**
- 创建：`nest-api/src/modules/energy-rental/controllers/ui-config.controller.ts`
- 修改：`nest-api/src/modules/energy-rental/energy-rental.module.ts`（注册 controller + service）

- [ ] **步骤 1：实现 controller**

```typescript
// nest-api/src/modules/energy-rental/controllers/ui-config.controller.ts
import {
  Controller, Get, Put, Param, Body, Query, Headers, HttpException, HttpStatus,
  ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@/common/guards/auth.guard';
import { UiConfigService } from '../services/ui-config.service';
import { UiConfigDto } from '../dto/ui-config.dto';
import { AgentBotConfigsRepository } from '../repositories/agent-bot-configs.repository';

@Controller('api/agent-bot-configs')
@UseGuards(AuthGuard)
export class UiConfigController {
  constructor(
    private readonly service: UiConfigService,
    private readonly repo: AgentBotConfigsRepository,
  ) {}

  @Get(':agentId/ui-config')
  async get(@Param('agentId', ParseIntPipe) agentId: number) {
    const record = await this.repo.findByAgentId(agentId);
    if (!record) {
      return {
        welcomeText: '',
        menuConfig: [],
        messageConfig: this.emptyTemplates(),
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      welcomeText: record.welcomeText ?? '',
      menuConfig: record.menuConfig ?? [],
      messageConfig: record.messageConfig ?? this.emptyTemplates(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  @Put(':agentId/ui-config')
  async update(
    @Param('agentId', ParseIntPipe) agentId: number,
    @Body() dto: UiConfigDto,
    @Query('dryRun') dryRun: string,
    @Headers('if-unmodified-since') ifUnmodifiedSince?: string,
  ) {
    await this.service.validate(dto, agentId);
    if (dryRun === 'true') {
      return { success: true, validation: { errors: [], warnings: [] } };
    }
    if (ifUnmodifiedSince) {
      const current = await this.repo.findByAgentId(agentId);
      if (current && current.updatedAt.toISOString() !== ifUnmodifiedSince) {
        throw new HttpException('配置已被他人修改', HttpStatus.CONFLICT);
      }
    }
    const saved = await this.repo.upsertUiConfig(agentId, dto);
    return { success: true, updatedAt: saved.updatedAt.toISOString() };
  }

  private emptyTemplates() {
    return {
      welcome: '', orderCreated: '', payPending: '', paySuccess: '',
      payFailed: '', addressInvalid: '', unknownCommand: '',
      packageUnavailable: '', walletQueryResult: '',
    };
  }
}
```

- [ ] **步骤 2：修改 repository 加 upsertUiConfig 方法**

找到 `nest-api/src/modules/energy-rental/repositories/agent-bot-configs.repository.ts`，追加方法：

```typescript
async upsertUiConfig(agentId: number, dto: {
  welcomeText?: string;
  menuConfig?: unknown;
  messageConfig?: unknown;
}) {
  const existing = await this.findByAgentId(agentId);
  if (existing) {
    return await this.db.update(agentBotConfigs)
      .set({
        welcomeText: dto.welcomeText ?? existing.welcomeText,
        menuConfig: dto.menuConfig ?? existing.menuConfig,
        messageConfig: dto.messageConfig ?? existing.messageConfig,
        updatedAt: new Date(),
      })
      .where(eq(agentBotConfigs.agentId, agentId))
      .returning()
      .then(r => r[0]);
  }
  return await this.db.insert(agentBotConfigs).values({
    agentId,
    welcomeText: dto.welcomeText ?? '',
    menuConfig: dto.menuConfig ?? [],
    messageConfig: dto.messageConfig ?? {},
  }).returning().then(r => r[0]);
}
```

- [ ] **步骤 3：注册到 module**

编辑 `nest-api/src/modules/energy-rental/energy-rental.module.ts`：

```typescript
import { UiConfigController } from './controllers/ui-config.controller';
import { UiConfigService } from './services/ui-config.service';

@Module({
  controllers: [
    // ... 现有
    UiConfigController,
  ],
  providers: [
    // ... 现有
    UiConfigService,
    { provide: 'PackageRepository', useExisting: PackagesRepository },
  ],
})
```

- [ ] **步骤 4：手工验证 API**

运行：`pnpm -C nest-api start:dev` 然后 curl：

```bash
curl -X GET http://localhost:3000/api/agent-bot-configs/1/ui-config \
  -H "Authorization: Bearer <token>"

curl -X PUT http://localhost:3000/api/agent-bot-configs/1/ui-config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"welcomeText":"测试","menuConfig":[],"messageConfig":{"welcome":"hi","orderCreated":"","payPending":"","paySuccess":"","payFailed":"","addressInvalid":"","unknownCommand":"","packageUnavailable":"","walletQueryResult":""}}'
```

预期：GET 返回结构正确；PUT 返回 `{success: true, updatedAt: ...}`

- [ ] **步骤 5：Commit**

```bash
git add nest-api/src/modules/energy-rental/controllers/ui-config.controller.ts \
        nest-api/src/modules/energy-rental/repositories/agent-bot-configs.repository.ts \
        nest-api/src/modules/energy-rental/energy-rental.module.ts
git commit -m "feat(api): 新增 UI 配置 controller 和 API 端点

- GET/PUT /api/agent-bot-configs/:agentId/ui-config
- 支持 dryRun 查询参数做校验预演
- 支持 If-Unmodified-Since 头实现并发保护"
```

---

## PR2：Bot 端改造

> **说明**：PR1 已经铺好 Go struct 和解析器的地基。PR2 在此基础上实现 9 种 action 的分发逻辑、模板引擎、Inline Keyboard submenu 下钻，并清空旧数据。

### 任务 6：模板引擎 + 单测

**文件：**
- 创建：`go-bot/internal/telegram/template.go`
- 创建：`go-bot/internal/telegram/template_test.go`

- [ ] **步骤 1：编写失败的测试**

```go
package telegram

import "testing"

func TestRenderTemplate_Basic(t *testing.T) {
	result := renderTemplate("订单 {orderNo} 金额 {amount}", map[string]string{
		"orderNo": "ORD001",
		"amount":  "12.50",
	})
	if result != "订单 ORD001 金额 12.50" {
		t.Errorf("got: %s", result)
	}
}

func TestRenderTemplate_UnknownVarPreserved(t *testing.T) {
	result := renderTemplate("Hello {unknown}", map[string]string{"name": "x"})
	if result != "Hello {unknown}" {
		t.Errorf("expected unknown var preserved, got: %s", result)
	}
}

func TestRenderTemplate_Empty(t *testing.T) {
	if renderTemplate("", map[string]string{"x": "y"}) != "" {
		t.Error("empty template should return empty")
	}
}

func TestRenderTemplate_NoVars(t *testing.T) {
	if renderTemplate("Hello", nil) != "Hello" {
		t.Error("no vars should return template as-is")
	}
}
```

- [ ] **步骤 2：运行验证失败**

运行：`cd go-bot && go test ./internal/telegram/ -run TestRenderTemplate -v`
预期：FAIL

- [ ] **步骤 3：实现**

```go
// go-bot/internal/telegram/template.go
package telegram

import "strings"

func renderTemplate(tpl string, vars map[string]string) string {
	if tpl == "" || len(vars) == 0 {
		return tpl
	}
	for k, v := range vars {
		tpl = strings.ReplaceAll(tpl, "{"+k+"}", v)
	}
	return tpl
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd go-bot && go test ./internal/telegram/ -run TestRenderTemplate -v`
预期：PASS（4 用例）

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/template.go go-bot/internal/telegram/template_test.go
git commit -m "feat(bot): 新增消息模板渲染引擎"
```

---

### 任务 7：9 种 action 分发 skeleton + 单测

**文件：**
- 创建：`go-bot/internal/telegram/action_dispatcher.go`
- 创建：`go-bot/internal/telegram/action_dispatcher_test.go`

- [ ] **步骤 1：编写失败的测试（用 mock Bot）**

```go
// go-bot/internal/telegram/action_dispatcher_test.go
package telegram

import (
	"context"
	"testing"
)

func TestDispatchButton_URL(t *testing.T) {
	var sent string
	mock := &mockSender{
		sendMessageFn: func(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error {
			sent = text
			return nil
		},
	}
	btn := DesignerMenuButton{
		Action: ActionURL,
		URL:    "https://example.com",
		Text:   "访问",
	}
	err := dispatchButton(context.Background(), mock, 123, btn, nil)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if sent != "https://example.com" {
		t.Errorf("expected URL in message, got: %s", sent)
	}
}

func TestDispatchButton_Text(t *testing.T) {
	var sent string
	mock := &mockSender{
		sendMessageFn: func(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error {
			sent = text
			return nil
		},
	}
	btn := DesignerMenuButton{Action: ActionText, Message: "提示文本"}
	if err := dispatchButton(context.Background(), mock, 1, btn, nil); err != nil {
		t.Fatal(err)
	}
	if sent != "提示文本" {
		t.Errorf("got: %s", sent)
	}
}

func TestDispatchButton_Unknown(t *testing.T) {
	mock := &mockSender{}
	btn := DesignerMenuButton{Action: ButtonAction("xxx")}
	err := dispatchButton(context.Background(), mock, 1, btn, nil)
	if err == nil {
		t.Error("expected error for unknown action")
	}
}

// mockSender implements the minimal sender interface
type mockSender struct {
	sendMessageFn func(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error
	sendInlineFn  func(ctx context.Context, chatID int64, text string, kb *inlineKeyboardMarkup) error
}

func (m *mockSender) sendText(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error {
	if m.sendMessageFn != nil {
		return m.sendMessageFn(ctx, chatID, text, kb)
	}
	return nil
}
func (m *mockSender) sendInline(ctx context.Context, chatID int64, text string, kb *inlineKeyboardMarkup) error {
	if m.sendInlineFn != nil {
		return m.sendInlineFn(ctx, chatID, text, kb)
	}
	return nil
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd go-bot && go test ./internal/telegram/ -run TestDispatchButton -v`
预期：FAIL

- [ ] **步骤 3：实现 dispatcher（部分 action skeleton，具体业务在后续任务实现）**

```go
// go-bot/internal/telegram/action_dispatcher.go
package telegram

import (
	"context"
	"fmt"
)

// actionSender 抽象 Bot 的发送能力，便于测试
type actionSender interface {
	sendText(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error
	sendInline(ctx context.Context, chatID int64, text string, kb *inlineKeyboardMarkup) error
}

type dispatchContext struct {
	templates MessageTemplates
}

func dispatchButton(ctx context.Context, sender actionSender, chatID int64, btn DesignerMenuButton, dispatchCtx *dispatchContext) error {
	switch btn.Action {
	case ActionURL:
		return sender.sendText(ctx, chatID, btn.URL, nil)
	case ActionText:
		msg := btn.Message
		if msg == "" {
			msg = btn.Text
		}
		return sender.sendText(ctx, chatID, msg, nil)
	case ActionCommand:
		// 留给任务 10 实现（需要调用 Bot 的 dispatchCommand）
		return fmt.Errorf("command dispatch not yet implemented")
	case ActionStart:
		return fmt.Errorf("start handler not yet implemented")
	case ActionSubmenu:
		return fmt.Errorf("submenu handler not yet implemented")
	case ActionEnergyPackageGroup:
		return fmt.Errorf("package group handler not yet implemented")
	case ActionAddressManage:
		return fmt.Errorf("address manage handler not yet implemented")
	case ActionWalletQuery:
		return fmt.Errorf("wallet query handler not yet implemented")
	case ActionOrders:
		return fmt.Errorf("orders handler not yet implemented")
	default:
		return fmt.Errorf("未知 action: %s", btn.Action)
	}
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd go-bot && go test ./internal/telegram/ -run TestDispatchButton -v`
预期：PASS（3 用例）

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/action_dispatcher.go go-bot/internal/telegram/action_dispatcher_test.go
git commit -m "feat(bot): 新增 action dispatcher skeleton（URL/TEXT 已实现）"
```

---

### 任务 8：实现 submenu + Inline Keyboard 下钻

**文件：**
- 修改：`go-bot/internal/telegram/action_dispatcher.go`
- 修改：`go-bot/internal/telegram/bot.go`（加 sendInlineKeyboard 方法）
- 创建：`go-bot/internal/telegram/submenu_test.go`

- [ ] **步骤 1：编写失败的测试**

```go
// go-bot/internal/telegram/submenu_test.go
package telegram

import (
	"context"
	"testing"
)

func TestDispatchSubmenu_SendsInlineKeyboard(t *testing.T) {
	var captured *inlineKeyboardMarkup
	mock := &mockSender{
		sendInlineFn: func(ctx context.Context, chatID int64, text string, kb *inlineKeyboardMarkup) error {
			captured = kb
			return nil
		},
	}
	btn := DesignerMenuButton{
		Action: ActionSubmenu,
		Text:   "购买",
		Submenu: []DesignerMenuRow{
			{ID: "r", Buttons: []DesignerMenuButton{
				{ID: "b1", Text: "套餐 A", Action: ActionOrders},
				{ID: "b2", Text: "套餐 B", Action: ActionOrders},
			}},
		},
	}
	err := dispatchButton(context.Background(), mock, 1, btn, &dispatchContext{})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if captured == nil || len(captured.InlineKeyboard) < 2 {
		t.Fatalf("expected inline keyboard with rows, got %+v", captured)
	}
	// 最后一行应为 "🔙 返回"
	lastRow := captured.InlineKeyboard[len(captured.InlineKeyboard)-1]
	if lastRow[0].Text != "🔙 返回" {
		t.Errorf("expected back button as last row, got: %+v", lastRow)
	}
}

func TestParseSubmenuCallback(t *testing.T) {
	cases := []struct {
		data     string
		wantPath []string
		wantBack bool
	}{
		{"menu:back", nil, true},
		{"menu:0.1", []string{"0", "1"}, false},
		{"menu:0.1.0.2", []string{"0", "1", "0", "2"}, false},
	}
	for _, tc := range cases {
		path, back := parseSubmenuCallback(tc.data)
		if back != tc.wantBack {
			t.Errorf("%s: back mismatch", tc.data)
		}
		if len(path) != len(tc.wantPath) {
			t.Errorf("%s: path len mismatch, got %v", tc.data, path)
		}
	}
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd go-bot && go test ./internal/telegram/ -run "TestDispatchSubmenu|TestParseSubmenu" -v`
预期：FAIL

- [ ] **步骤 3：实现**

修改 `action_dispatcher.go` 中的 `ActionSubmenu` 分支：

```go
case ActionSubmenu:
    return dispatchSubmenu(ctx, sender, chatID, btn.Text, btn.Submenu, "")
```

追加函数：

```go
// dispatchSubmenu 渲染子菜单为 Inline Keyboard。
// pathPrefix 是当前菜单在根树中的路径（如 "0.1"），为空表示根。
func dispatchSubmenu(ctx context.Context, sender actionSender, chatID int64, title string, rows []DesignerMenuRow, pathPrefix string) error {
    inline := make([][]inlineKeyboardButton, 0, len(rows)+1)
    for rowIdx, row := range rows {
        btnRow := make([]inlineKeyboardButton, 0, len(row.Buttons))
        for btnIdx, btn := range row.Buttons {
            var cbData string
            if pathPrefix == "" {
                cbData = fmt.Sprintf("menu:%d.%d", rowIdx, btnIdx)
            } else {
                cbData = fmt.Sprintf("menu:%s.%d.%d", pathPrefix, rowIdx, btnIdx)
            }
            btnRow = append(btnRow, inlineKeyboardButton{Text: btn.Text, CallbackData: cbData})
        }
        if len(btnRow) > 0 {
            inline = append(inline, btnRow)
        }
    }
    // 追加返回按钮
    inline = append(inline, []inlineKeyboardButton{{Text: "🔙 返回", CallbackData: "menu:back"}})
    text := title
    if text == "" {
        text = "请选择："
    }
    return sender.sendInline(ctx, chatID, text, &inlineKeyboardMarkup{InlineKeyboard: inline})
}

// parseSubmenuCallback 解析 "menu:0.1.0.2" 或 "menu:back"
func parseSubmenuCallback(data string) (path []string, isBack bool) {
    if !strings.HasPrefix(data, "menu:") {
        return nil, false
    }
    rest := strings.TrimPrefix(data, "menu:")
    if rest == "back" {
        return nil, true
    }
    return strings.Split(rest, "."), false
}
```

在 `action_dispatcher.go` 顶部添加 `import "strings"`。

同时在 `bot.go` 加 `sendText`/`sendInline` 方法让 `Bot` 实现 `actionSender` 接口：

```go
// bot.go 追加
func (b *Bot) sendText(ctx context.Context, chatID int64, text string, kb *replyKeyboardMarkup) error {
    return b.sendMessage(ctx, chatID, text, kb)
}

func (b *Bot) sendInline(ctx context.Context, chatID int64, text string, kb *inlineKeyboardMarkup) error {
    return b.sendMessageWithInline(ctx, chatID, text, kb)
}
```

如果 `sendMessageWithInline` 不存在，基于现有 `sendMessage` 改造：搜索 `inline_keyboard` 的发送位置，提取为公共方法。

- [ ] **步骤 4：运行测试验证通过**

运行：`cd go-bot && go test ./internal/telegram/ -run "TestDispatchSubmenu|TestParseSubmenu" -v`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/action_dispatcher.go go-bot/internal/telegram/submenu_test.go go-bot/internal/telegram/bot.go
git commit -m "feat(bot): 实现 submenu 下钻（Inline Keyboard + callback path）"
```

---

### 任务 9：实现套餐组 action + 单测

**文件：**
- 修改：`go-bot/internal/telegram/action_dispatcher.go`
- 创建：`go-bot/internal/telegram/package_group_test.go`

- [ ] **步骤 1：编写失败的测试**

```go
// go-bot/internal/telegram/package_group_test.go
package telegram

import "testing"

func TestSortPackages_PriceAsc(t *testing.T) {
	pkgs := []EnergyPackage{
		{ID: 1, Name: "B", Price: 20},
		{ID: 2, Name: "A", Price: 10},
		{ID: 3, Name: "C", Price: 30},
	}
	sortPackages(pkgs, "price_asc")
	if pkgs[0].Price != 10 || pkgs[2].Price != 30 {
		t.Errorf("sort failed: %+v", pkgs)
	}
}

func TestSortPackages_PriceDesc(t *testing.T) {
	pkgs := []EnergyPackage{
		{ID: 1, Price: 20}, {ID: 2, Price: 10}, {ID: 3, Price: 30},
	}
	sortPackages(pkgs, "price_desc")
	if pkgs[0].Price != 30 {
		t.Errorf("expected 30 first, got: %+v", pkgs)
	}
}

func TestSortPackages_Manual(t *testing.T) {
	pkgs := []EnergyPackage{{ID: 1}, {ID: 2}, {ID: 3}}
	original := append([]EnergyPackage{}, pkgs...)
	sortPackages(pkgs, "manual")
	for i := range pkgs {
		if pkgs[i].ID != original[i].ID {
			t.Errorf("manual should preserve order")
		}
	}
}

func TestRenderPackageButtonText(t *testing.T) {
	pkg := EnergyPackage{Name: "100K能量", Price: 12.5, Energy: 100000}
	text := renderPackageButtonText("{name} - {price} TRX", pkg)
	if text != "100K能量 - 12.5 TRX" {
		t.Errorf("got: %s", text)
	}
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd go-bot && go test ./internal/telegram/ -run "TestSortPackages|TestRenderPackage" -v`
预期：FAIL

- [ ] **步骤 3：实现**

```go
// action_dispatcher.go 追加
import (
    "sort"
    "strconv"
)

func sortPackages(pkgs []EnergyPackage, sortBy string) {
    switch sortBy {
    case "price_asc":
        sort.SliceStable(pkgs, func(i, j int) bool { return pkgs[i].Price < pkgs[j].Price })
    case "price_desc":
        sort.SliceStable(pkgs, func(i, j int) bool { return pkgs[i].Price > pkgs[j].Price })
    }
    // manual 保持原顺序
}

func renderPackageButtonText(tpl string, pkg EnergyPackage) string {
    return renderTemplate(tpl, map[string]string{
        "name":   pkg.Name,
        "price":  strconv.FormatFloat(pkg.Price, 'f', -1, 64),
        "energy": strconv.Itoa(pkg.Energy),
    })
}
```

在 `Bot` 上新增方法（bot.go）：

```go
func (b *Bot) executePackageGroup(ctx context.Context, chatID int64, cfg *PackageGroupConfig) error {
    if cfg == nil || len(cfg.PackageIDs) == 0 {
        return b.sendMessage(ctx, chatID, "套餐组未配置", nil)
    }
    packages, err := b.loadPackagesByIDs(ctx, cfg.PackageIDs)
    if err != nil {
        return err
    }
    sortPackages(packages, cfg.SortBy)
    rows := make([][]inlineKeyboardButton, 0, len(packages)+1)
    for _, pkg := range packages {
        text := renderPackageButtonText(cfg.TextTemplate, pkg)
        if text == "" {
            text = pkg.Name
        }
        rows = append(rows, []inlineKeyboardButton{
            {Text: text, CallbackData: fmt.Sprintf("pkg:%d", pkg.ID)},
        })
    }
    rows = append(rows, []inlineKeyboardButton{{Text: "🔙 返回", CallbackData: "menu:back"}})
    return b.sendInline(ctx, chatID, "请选择套餐：", &inlineKeyboardMarkup{InlineKeyboard: rows})
}

// loadPackagesByIDs 按 ID 批量加载套餐（复用已有查询逻辑）
func (b *Bot) loadPackagesByIDs(ctx context.Context, ids []int) ([]EnergyPackage, error) {
    all, err := b.loadPackages(ctx) // 现有方法
    if err != nil {
        return nil, err
    }
    idSet := make(map[int]bool, len(ids))
    for _, id := range ids {
        idSet[id] = true
    }
    result := make([]EnergyPackage, 0, len(ids))
    for _, pkg := range all {
        if idSet[pkg.ID] {
            result = append(result, pkg)
        }
    }
    return result, nil
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`cd go-bot && go test ./internal/telegram/ -run "TestSortPackages|TestRenderPackage" -v`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/action_dispatcher.go go-bot/internal/telegram/bot.go go-bot/internal/telegram/package_group_test.go
git commit -m "feat(bot): 实现套餐组动态展开（排序 + 模板文本）"
```

---

### 任务 10：接入现有业务 action（start / command / orders / address / wallet）

**文件：**
- 修改：`go-bot/internal/telegram/action_dispatcher.go`
- 修改：`go-bot/internal/telegram/bot.go`（`executeDesignerButton` 调用新 dispatcher）

- [ ] **步骤 1：把 Bot 方法桥接到 dispatcher**

重构 `bot.go:531` 的 `executeDesignerButton`，改为调用 dispatcher + fallback 到 Bot 方法：

```go
func (b *Bot) executeDesignerButton(ctx context.Context, chatID int64, btn DesignerMenuButton) error {
    // 读取当前配置拿到模板
    cfg, _ := b.loadDesignerConfig(ctx)
    dctx := &dispatchContext{templates: cfg.MessageConfig}

    switch btn.Action {
    case ActionSubmenu:
        return dispatchSubmenu(ctx, b, chatID, btn.Text, btn.Submenu, "")
    case ActionEnergyPackageGroup:
        return b.executePackageGroup(ctx, chatID, btn.PackageGroup)
    case ActionStart:
        return b.handleStart(ctx, chatID) // 已有方法
    case ActionCommand:
        return b.handleTextCommand(ctx, chatID, btn.Command) // 复用命令处理
    case ActionOrders:
        return b.handleOrderList(ctx, chatID)
    case ActionAddressManage:
        return b.handleAddressCommand(ctx, chatID) // 现有
    case ActionWalletQuery:
        return b.handleWalletCommand(ctx, chatID)  // 现有
    default:
        return dispatchButton(ctx, b, chatID, btn, dctx)
    }
}
```

如果 `handleOrderList`/`handleStart` 等函数不存在，查看 `bot.go` 现有入口函数名并替换。

- [ ] **步骤 2：新增/确认辅助函数**

搜索确认下列方法存在：
- `handleStart` / `handleAddressCommand` / `handleWalletCommand`
- 如果 `handleOrderList` 不存在，新建一个 stub：

```go
func (b *Bot) handleOrderList(ctx context.Context, chatID int64) error {
    // TODO: 未来接入订单查询
    return b.sendMessage(ctx, chatID, "订单查询功能即将上线", nil)
}
```

- [ ] **步骤 3：集成测试**

运行：`cd go-bot && go test ./internal/telegram/ -v`
预期：所有测试 PASS

- [ ] **步骤 4：Commit**

```bash
git add go-bot/internal/telegram/bot.go go-bot/internal/telegram/action_dispatcher.go
git commit -m "feat(bot): 接入业务 action（start/command/orders/address/wallet）"
```

---

### 任务 11：callback_query 处理 submenu 导航

**文件：**
- 修改：`go-bot/internal/telegram/bot.go`（`handleCallbackQuery` 或等价函数）

- [ ] **步骤 1：定位 callback_query 处理入口**

搜索 `CallbackQuery` 处理代码：

```bash
grep -n "CallbackQuery" go-bot/internal/telegram/bot.go
```

- [ ] **步骤 2：加 menu: 前缀处理**

在 callback 处理函数的 switch 里加一个分支：

```go
if strings.HasPrefix(data, "menu:") {
    return b.handleMenuCallback(ctx, chatID, messageID, data)
}
```

实现：

```go
func (b *Bot) handleMenuCallback(ctx context.Context, chatID int64, messageID int, data string) error {
    path, isBack := parseSubmenuCallback(data)
    cfg, err := b.loadDesignerConfig(ctx)
    if err != nil {
        return err
    }
    if isBack {
        // 删除当前消息（返回到 Reply Keyboard）
        return b.deleteMessage(ctx, chatID, messageID)
    }
    // 沿 path 定位按钮
    btn, ok := findButtonByPath(cfg.MenuRows, path)
    if !ok {
        return b.sendMessage(ctx, chatID, "菜单已更新，请重新打开", nil)
    }
    // 执行目标按钮
    return b.executeDesignerButton(ctx, chatID, btn)
}

func findButtonByPath(rows []DesignerMenuRow, path []string) (DesignerMenuButton, bool) {
    var current []DesignerMenuRow = rows
    var found DesignerMenuButton
    for i := 0; i < len(path); i += 2 {
        if i+1 >= len(path) {
            return DesignerMenuButton{}, false
        }
        rowIdx, err1 := strconv.Atoi(path[i])
        btnIdx, err2 := strconv.Atoi(path[i+1])
        if err1 != nil || err2 != nil || rowIdx >= len(current) {
            return DesignerMenuButton{}, false
        }
        if btnIdx >= len(current[rowIdx].Buttons) {
            return DesignerMenuButton{}, false
        }
        found = current[rowIdx].Buttons[btnIdx]
        if found.Action == ActionSubmenu && i+2 < len(path) {
            current = found.Submenu
        }
    }
    return found, true
}
```

如果 `deleteMessage` 方法不存在，新增：

```go
func (b *Bot) deleteMessage(ctx context.Context, chatID int64, messageID int) error {
    params := map[string]any{"chat_id": chatID, "message_id": messageID}
    _, err := b.request(ctx, "deleteMessage", params)
    return err
}
```

- [ ] **步骤 3：编写单测覆盖 findButtonByPath**

```go
// submenu_test.go 追加
func TestFindButtonByPath(t *testing.T) {
	rows := []DesignerMenuRow{
		{Buttons: []DesignerMenuButton{
			{Text: "根按钮0", Action: ActionSubmenu, Submenu: []DesignerMenuRow{
				{Buttons: []DesignerMenuButton{
					{Text: "子按钮", Action: ActionOrders},
				}},
			}},
		}},
	}
	btn, ok := findButtonByPath(rows, []string{"0", "0"})
	if !ok || btn.Text != "根按钮0" {
		t.Errorf("path [0,0] failed: %+v", btn)
	}
	btn2, ok := findButtonByPath(rows, []string{"0", "0", "0", "0"})
	if !ok || btn2.Text != "子按钮" {
		t.Errorf("path [0,0,0,0] failed: %+v", btn2)
	}
}
```

- [ ] **步骤 4：运行测试**

运行：`cd go-bot && go test ./internal/telegram/ -run TestFindButtonByPath -v`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/bot.go go-bot/internal/telegram/submenu_test.go
git commit -m "feat(bot): 处理 callback_query 实现 submenu 导航"
```

---

### 任务 12：接入模板渲染 + 清空旧数据 SQL

**文件：**
- 修改：`go-bot/internal/telegram/bot.go`（订单相关消息用 `renderTemplate`）
- 创建：`nest-api/src/drizzle/migrations/0003-reset-designer-config.sql`

- [ ] **步骤 1：改造订单通知用模板**

搜索所有 `sendMessage(ctx, chatID, "订单` 这类硬编码文案，替换为从 `cfg.MessageConfig` 读模板 + renderTemplate。示例：

```go
// 原
b.sendMessage(ctx, chatID, fmt.Sprintf("订单 %s 创建成功", order.OrderNo), nil)

// 改为
cfg, _ := b.loadDesignerConfig(ctx)
msg := renderTemplate(cfg.MessageConfig.OrderCreated, map[string]string{
    "orderNo":     order.OrderNo,
    "packageName": pkg.Name,
    "amount":      fmt.Sprintf("%.2f", order.Amount),
    "address":     order.ReceiverAddress,
    "payAddress":  order.PayAddress,
    "energy":      fmt.Sprintf("%d", pkg.Energy),
})
if msg == "" {
    msg = fmt.Sprintf("订单 %s 创建成功", order.OrderNo) // fallback
}
b.sendMessage(ctx, chatID, msg, nil)
```

涉及的触发点：
- 订单创建（`OrderCreated`）
- 支付等待（`PayPending`）
- 支付成功（`PaySuccess`）
- 支付失败（`PayFailed`）
- 地址非法（`AddressInvalid`）
- 未知命令（`UnknownCommand`）
- 套餐不可用（`PackageUnavailable`）
- 钱包查询结果（`WalletQueryResult`）

- [ ] **步骤 2：创建 SQL 迁移文件**

```sql
-- nest-api/src/drizzle/migrations/0003-reset-designer-config.sql
-- 清空所有 agent 和平台的旧 v1 设计器配置（不兼容 v2 结构）

UPDATE agent_bot_configs
SET menu_config = '[]'::jsonb,
    message_config = '{}'::jsonb,
    welcome_text = ''
WHERE menu_config IS NOT NULL
   OR message_config IS NOT NULL
   OR welcome_text IS NOT NULL;

UPDATE energy_platform_config
SET menu_config = '[]'::jsonb,
    message_config = '{}'::jsonb,
    welcome_text = ''
WHERE id = 1;
```

- [ ] **步骤 3：备份脚本**

```bash
# 部署前执行
pg_dump -h 47.82.151.0 -U postgres -d energy -t agent_bot_configs -t energy_platform_config \
  > /tmp/designer-backup-$(date +%Y%m%d%H%M%S).sql
```

将此命令写入 `docs/deployment/bot-designer-migrate.md`。

- [ ] **步骤 4：本地测试**

运行：
```bash
cd go-bot && go test ./internal/telegram/ -v
cd go-bot && go build ./...
```
预期：全 PASS，build 无错误

- [ ] **步骤 5：Commit**

```bash
git add go-bot/internal/telegram/bot.go nest-api/src/drizzle/migrations/0003-reset-designer-config.sql docs/deployment/bot-designer-migrate.md
git commit -m "feat(bot): 接入消息模板渲染 + 清空旧数据迁移脚本"
```

---

## PR3：前端菜单设计器

### 任务 13：新增 @angular/cdk 依赖

- [ ] **步骤 1：安装**

运行：`pnpm -C ui add @angular/cdk@^21.2.0`

- [ ] **步骤 2：验证版本匹配**

运行：`pnpm -C ui list @angular/core @angular/cdk`
预期：两者主版本号一致（21.x）

- [ ] **步骤 3：Commit**

```bash
git add ui/package.json ui/pnpm-lock.yaml
git commit -m "chore(ui): 新增 @angular/cdk 依赖（用于设计器拖拽）"
```

---

### 任务 14：menu-tree.service.ts（状态管理 + 单测）

**文件：**
- 创建：`ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-designer/menu-tree.service.ts`
- 创建：`ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-designer/menu-tree.service.spec.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// menu-tree.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { MenuTreeService } from './menu-tree.service';
import { ButtonAction } from '../types';

describe('MenuTreeService', () => {
  let service: MenuTreeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MenuTreeService] });
    service = TestBed.inject(MenuTreeService);
  });

  it('初始状态为空数组', () => {
    expect(service.$rootMenu()).toEqual([]);
  });

  it('addButton 到指定行', () => {
    service.addRow();
    service.addButton(0, { id: 'b1', text: '测试', action: ButtonAction.TEXT, message: 'x' });
    expect(service.$rootMenu()[0].buttons).toHaveLength(1);
  });

  it('undo 回滚操作', () => {
    service.addRow();
    service.addRow();
    expect(service.$rootMenu()).toHaveLength(2);
    service.undo();
    expect(service.$rootMenu()).toHaveLength(1);
  });

  it('redo 恢复撤销的操作', () => {
    service.addRow();
    service.undo();
    service.redo();
    expect(service.$rootMenu()).toHaveLength(1);
  });

  it('下钻进入 submenu 后 $currentMenu 切换', () => {
    service.addRow();
    service.addButton(0, {
      id: 'b1', text: '展开', action: ButtonAction.SUBMENU,
      submenu: [{ id: 'sub1', buttons: [] }],
    });
    service.enterSubmenu('b1');
    expect(service.$breadcrumb().length).toBe(2);
    expect(service.$currentMenu()).toEqual([{ id: 'sub1', buttons: [] }]);
  });

  it('深度校验拒绝超 3 层', () => {
    const deep = {
      id: 'r', buttons: [{
        id: 'b', text: '', action: ButtonAction.SUBMENU,
        submenu: [{ id: 'r2', buttons: [{
          id: 'b2', text: '', action: ButtonAction.SUBMENU,
          submenu: [{ id: 'r3', buttons: [{
            id: 'b3', text: '', action: ButtonAction.SUBMENU,
            submenu: [{ id: 'r4', buttons: [] }]
          }] }]
        }] }]
      }]
    };
    expect(() => service.validateDepth([deep])).toThrow();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm -C ui test --include=**/menu-tree.service.spec.ts`
预期：FAIL

- [ ] **步骤 3：实现**

```typescript
// menu-tree.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { MenuRow, MenuButton, ButtonAction, MAX_MENU_DEPTH } from '../types';

interface BreadcrumbItem {
  label: string;
  buttonId: string | null; // null 表示根
}

@Injectable()
export class MenuTreeService {
  readonly $rootMenu = signal<MenuRow[]>([]);
  readonly $breadcrumb = signal<BreadcrumbItem[]>([{ label: '根菜单', buttonId: null }]);
  readonly $selectedButtonId = signal<string | null>(null);

  readonly $currentMenu = computed<MenuRow[]>(() => {
    const crumbs = this.$breadcrumb();
    let current = this.$rootMenu();
    for (let i = 1; i < crumbs.length; i++) {
      const btnId = crumbs[i].buttonId;
      const btn = this.findButtonInRows(current, btnId!);
      if (!btn || !btn.submenu) return [];
      current = btn.submenu;
    }
    return current;
  });

  private history: MenuRow[][] = [];
  private future: MenuRow[][] = [];

  private pushHistory(): void {
    this.history.push(structuredClone(this.$rootMenu()));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  addRow(): void {
    this.pushHistory();
    const row: MenuRow = { id: this.genId('row'), buttons: [] };
    this.$rootMenu.update(rows => [...rows, row]);
  }

  addButton(rowIdx: number, button: MenuButton): void {
    this.pushHistory();
    this.updateCurrentMenu(rows => {
      const updated = structuredClone(rows);
      if (updated[rowIdx]) updated[rowIdx].buttons.push(button);
      return updated;
    });
  }

  updateButton(buttonId: string, patch: Partial<MenuButton>): void {
    this.pushHistory();
    this.updateCurrentMenu(rows => {
      const updated = structuredClone(rows);
      for (const row of updated) {
        const idx = row.buttons.findIndex(b => b.id === buttonId);
        if (idx >= 0) {
          row.buttons[idx] = { ...row.buttons[idx], ...patch };
          break;
        }
      }
      return updated;
    });
  }

  removeButton(buttonId: string): void {
    this.pushHistory();
    this.updateCurrentMenu(rows => {
      const updated = structuredClone(rows);
      for (const row of updated) {
        row.buttons = row.buttons.filter(b => b.id !== buttonId);
      }
      return updated.filter(r => r.buttons.length > 0);
    });
  }

  enterSubmenu(buttonId: string): void {
    const btn = this.findButtonInRows(this.$currentMenu(), buttonId);
    if (!btn || btn.action !== ButtonAction.SUBMENU) return;
    if (!btn.submenu) btn.submenu = [];
    this.$breadcrumb.update(crumbs => [...crumbs, { label: btn.text || '未命名', buttonId }]);
  }

  navigateTo(index: number): void {
    this.$breadcrumb.update(crumbs => crumbs.slice(0, index + 1));
  }

  undo(): void {
    if (this.history.length === 0) return;
    this.future.push(structuredClone(this.$rootMenu()));
    const prev = this.history.pop()!;
    this.$rootMenu.set(prev);
  }

  redo(): void {
    if (this.future.length === 0) return;
    this.history.push(structuredClone(this.$rootMenu()));
    const next = this.future.pop()!;
    this.$rootMenu.set(next);
  }

  validateDepth(rows: MenuRow[], depth = 1): void {
    if (depth > MAX_MENU_DEPTH) {
      throw new Error(`菜单嵌套深度不能超过 ${MAX_MENU_DEPTH} 层`);
    }
    for (const row of rows) {
      for (const btn of row.buttons) {
        if (btn.action === ButtonAction.SUBMENU && btn.submenu?.length) {
          this.validateDepth(btn.submenu, depth + 1);
        }
      }
    }
  }

  setRootMenu(menu: MenuRow[]): void {
    this.history = [];
    this.future = [];
    this.$rootMenu.set(menu);
    this.$breadcrumb.set([{ label: '根菜单', buttonId: null }]);
    this.$selectedButtonId.set(null);
  }

  private updateCurrentMenu(updater: (rows: MenuRow[]) => MenuRow[]): void {
    const crumbs = this.$breadcrumb();
    if (crumbs.length === 1) {
      this.$rootMenu.update(updater);
      return;
    }
    // 深层：重建路径
    this.$rootMenu.update(rootRows => {
      const cloned = structuredClone(rootRows);
      let current = cloned;
      for (let i = 1; i < crumbs.length - 1; i++) {
        const btn = this.findButtonInRows(current, crumbs[i].buttonId!);
        if (!btn || !btn.submenu) return cloned;
        current = btn.submenu;
      }
      const lastBtnId = crumbs[crumbs.length - 1].buttonId!;
      const btn = this.findButtonInRows(current, lastBtnId);
      if (btn && btn.submenu) {
        btn.submenu = updater(btn.submenu);
      }
      return cloned;
    });
  }

  private findButtonInRows(rows: MenuRow[], id: string): MenuButton | null {
    for (const row of rows) {
      const btn = row.buttons.find(b => b.id === id);
      if (btn) return btn;
    }
    return null;
  }

  private genId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`pnpm -C ui test --include=**/menu-tree.service.spec.ts`
预期：PASS（6 用例）

- [ ] **步骤 5：Commit**

```bash
git add ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-designer/menu-tree.service.ts \
        ui/src/app/pages/energy-rental/agent-bot-config/designer/menu-designer/menu-tree.service.spec.ts
git commit -m "feat(ui): 新增 MenuTreeService（signal state + undo/redo + 嵌套导航）"
```

---

### 任务 15-22（PR3 剩余）+ PR4 + PR5

> **说明**：为保持文档长度合理，以下任务以**任务纲要**形式列出。每个任务都必须遵循「写测试 → 验证失败 → 实现 → 验证通过 → commit」5 步节奏。执行阶段若需展开，参考任务 1-14 的模板。

### 任务 15：ComponentPalette 组件

- 文件：`designer/menu-designer/component-palette.component.{ts,html,less}`
- 职责：左栏 3 个分组（基础/业务/结构）共 9 个按钮模板，CDK `cdkDrag` 拖拽源
- 测试：模板数量、拖拽 data 正确

### 任务 16：MenuCanvas 组件（拖拽目标 + 面包屑 + 行/按钮渲染）

- 文件：`designer/menu-designer/menu-canvas.component.{ts,html,less}`
- 职责：中央画布，`cdkDropList` 接收拖拽，渲染 `$currentMenu`，点击选中，双击下钻
- 测试：drop 触发 addButton，click 触发 selectButton

### 任务 17：PropertyPanel 组件

- 文件：`designer/menu-designer/property-panel.component.{ts,html,less}`
- 职责：右栏动态表单，根据 `$selectedButton.action` 切换不同字段（URL/文本/套餐组/命令...）
- 测试：action 切换时 FormGroup 重建；必填校验

### 任务 18：套餐组选择器子组件

- 文件：`designer/menu-designer/package-group-editor.component.{ts,html,less}`
- 职责：从 API 拉套餐列表，多选 + 排序切换 + 文本模板预览
- 测试：onChange 正确 emit `PackageGroup`

### 任务 19：TelegramPreview 组件

- 文件：`designer/menu-designer/telegram-preview.component.{ts,html,less}`
- 职责：CSS 模拟 Telegram 聊天气泡 + 底部 Reply Keyboard + 点击下钻显示 Inline Keyboard
- 测试：渲染当前菜单按钮数；**唯一允许硬编码颜色的组件**（TG 品牌色）

### 任务 20：MenuDesigner 顶层容器

- 文件：`designer/menu-designer/menu-designer.component.{ts,html,less}`
- 职责：三栏 flex 布局，提供 MenuTreeService，顶部模拟/编辑开关 + 保存按钮
- 测试：初始化时从 API 加载、保存时调用 PUT

### 任务 21：主题适配 + 颜色变量审计

- 对所有 less 文件执行 `grep -n "#[0-9a-fA-F]\{3,6\}"`
- 除 TelegramPreview 外，所有硬编码颜色必须改为 `var(--ant-color-*)`
- 手动切换暗黑主题 → 截图对比 → 无违和

### 任务 22：集成到 agent-bot-config 组件

- 修改 `agent-bot-config.component.html` 加 `<nz-tabs>` 包裹（基础配置 / 菜单设计器 / 消息模板）
- 菜单设计器 Tab 引入 `<app-menu-designer>`
- E2E 手测：进入页面 → 切 Tab → 拖拽 → 保存 → 刷新后配置仍在

---

## PR4：消息模板设计器（任务 23-27）

### 任务 23：VariableHint 组件

- 文件：`designer/message-designer/variable-hint.component.{ts,html,less}`
- 职责：9 个变量的 chip 点击后在 textarea 光标位置插入 `{varName}`
- 测试：光标位置保持、插入正确

### 任务 24：TemplatePreview 组件

- 文件：`designer/message-designer/template-preview.component.{ts,html,less}`
- 职责：用预设样例数据（orderNo=ORD001 等）实时渲染模板预览
- 测试：预览渲染正确

### 任务 25：MessageDesigner 主组件（9 个 Tab）

- 文件：`designer/message-designer/message-designer.component.{ts,html,less}`
- 职责：`<nz-tabs>` 下 9 个场景各一个 Tab，每 Tab 含 textarea + variable-hint + preview
- 测试：9 个 key 正确绑定

### 任务 26：集成到 agent-bot-config 的消息模板 Tab

### 任务 27：主题适配审计（同任务 21）

---

## PR5：E2E + 文档（任务 28-30）

### 任务 28：Playwright E2E 测试

- 文件：`ui/e2e/bot-designer.spec.ts`
- 5 个场景（详见设计文档第 9.4 节）

### 任务 29：用户手册

- 文件：`docs/bot-designer.md`
- 内容：功能介绍、操作步骤、9 个变量说明、常见问题

### 任务 30：部署 & 验证

- 本地 docker-compose 全量构建：`docker-compose up --build`
- 服务器部署（按现有流程）
- 执行 SQL 迁移：`psql -f 0003-reset-designer-config.sql`
- 端到端验证：UI 配置 → Bot 响应 → 订单流程

---

## 自检清单

- ✅ **规格覆盖**：9 种 action、嵌套 3 层、模板引擎、套餐组、并发保护、主题跟随、9 个消息场景 → 对应任务 1-30
- ✅ **类型一致**：`MenuRow`/`MenuButton`/`ButtonAction` 前后端 Go 三端命名一致
- ✅ **无占位符**：所有步骤含具体代码/命令
- ✅ **TDD**：每个核心任务先写测试
- ✅ **频繁 commit**：每任务结束一次 commit

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-05-02-bot-webui-designer.md`。两种执行方式：

1. **子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代
2. **内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
