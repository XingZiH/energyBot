import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.provider';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../drizzle/schema';
import {
  agentBotConfigsTable,
  agentProfilesTable,
  agentWalletAccountsTable,
  menuTable,
  roleTable,
  sysRolePermTable,
  sysUserRoleTable,
  userTable,
} from '../../drizzle/schema';
import { asc, eq, inArray } from 'drizzle-orm';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigEnum } from '../../enum/config.enum';
import * as argon2 from 'argon2';
import { SignupUserDto } from './dto/signin-user.dto';
import { normalizeMenuAuthCodes } from './auth-menu-policy';

const USER_ROLE_NAME = '用户';
const LEGACY_AGENT_ROLE_NAME = '代理商';
const AGENT_PERMISSION_CODES = [
  'default:energy-rental',
  'default:energy-rental:dashboard',
  'default:energy-rental:bot-config',
  'default:energy-rental:agent-recharge',
  'default:energy-rental:addresses',
  'default:energy-rental:orders',
  'default:energy-rental:wallet-transactions',
];

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private jwt: JwtService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject(DrizzleAsyncProvider) private conn: NodePgDatabase<typeof schema>,
  ) {}

  // 登录
  async signIn(userName: string, password: string) {
    const res = await this.userService.findOneByUserName(userName);
    if (!res) {
      throw new ForbiddenException('用户不存在，请注册');
    }
    const isPasswordValid = await argon2.verify(res.password, password);
    if (!isPasswordValid) {
      // 为了安全不要明确告诉用户是用户名还是密码错误
      throw new ForbiddenException('用户名或密码错误');
    }
    // 生成token
    return await this.jwt.signAsync({
      userName: userName,
      sub: res.id,
    });
  }
  async signup(dto: SignupUserDto) {
    const userName = String(dto.userName ?? '').trim();
    const password = String(dto.password ?? '');
    if (!userName) {
      throw new BadRequestException('请输入账号');
    }
    if (password.length < 6) {
      throw new BadRequestException('密码至少 6 位');
    }

    const existing = await this.conn
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.userName, userName));
    if (existing.length > 0) {
      throw new ConflictException('账号已存在');
    }

    const passwordHash = await argon2.hash(password);
    const agentName = String(dto.agentName || userName).trim();
    const result = await this.conn.transaction(async (db) => {
      const roleId = await this.ensureAgentRole(db);
      await this.ensureAgentPermissions(db, roleId);

      const [createdUser] = await db
        .insert(userTable)
        .values({
          userName,
          password: passwordHash,
          available: true,
          sex: 1,
          mobile: String(dto.mobile ?? '').trim(),
          email: String(dto.email ?? '').trim() || null,
          departmentId: 1,
          lastLoginTime: new Date(),
        })
        .returning({ id: userTable.id });

      await db.insert(sysUserRoleTable).values({
        userId: createdUser.id,
        roleId,
      });

      const [agent] = await db
        .insert(agentProfilesTable)
        .values({
          userId: createdUser.id,
          agentName,
          status: 'active',
        })
        .returning({ id: agentProfilesTable.id });

      await db.insert(agentWalletAccountsTable).values({
        agentId: agent.id,
        balanceSun: '0',
        totalRechargeSun: '0',
        totalDeductedSun: '0',
        status: 'active',
      });

      await db.insert(agentBotConfigsTable).values({
        agentId: agent.id,
        botStatus: 'disabled',
      });

      return { userId: createdUser.id, agentId: agent.id };
    });

    return result;
  }
  async signOut() {
    await this.cacheManager.del(ConfigEnum.AUTH_CODE);
  }

  async getMenuByUserAuthCode(authCode: string[]) {
    const menuAuthCode = normalizeMenuAuthCodes(authCode);
    const data = await this.conn
      .select()
      .from(menuTable)
      .where(inArray(menuTable.code, menuAuthCode))
      .orderBy(
        asc(menuTable.fatherId),
        asc(menuTable.orderNum),
        asc(menuTable.id),
      );
    return data;
  }

  private async ensureAgentRole(db: NodePgDatabase<typeof schema>) {
    const roles = await db
      .select({ id: roleTable.id, roleName: roleTable.roleName })
      .from(roleTable)
      .where(
        inArray(roleTable.roleName, [USER_ROLE_NAME, LEGACY_AGENT_ROLE_NAME]),
      );
    const userRole = roles.find((item) => item.roleName === USER_ROLE_NAME);
    if (userRole) {
      return userRole.id;
    }
    const legacyRole = roles.find(
      (item) => item.roleName === LEGACY_AGENT_ROLE_NAME,
    );
    if (legacyRole) {
      await db
        .update(roleTable)
        .set({ roleName: USER_ROLE_NAME, roleDesc: '注册用户默认角色' })
        .where(eq(roleTable.id, legacyRole.id));
      return legacyRole.id;
    }
    const [role] = await db
      .insert(roleTable)
      .values({ roleName: USER_ROLE_NAME, roleDesc: '注册用户默认角色' })
      .returning({ id: roleTable.id });
    return role.id;
  }

  private async ensureAgentPermissions(
    db: NodePgDatabase<typeof schema>,
    roleId: number,
  ) {
    const existing = await db
      .select({ permCode: sysRolePermTable.permCode })
      .from(sysRolePermTable)
      .where(eq(sysRolePermTable.roleId, roleId));
    const existingCodes = new Set(existing.map((item) => item.permCode));
    const missing = AGENT_PERMISSION_CODES.filter(
      (code) => !existingCodes.has(code),
    );
    if (missing.length === 0) return;
    await db.insert(sysRolePermTable).values(
      missing.map((permCode) => ({
        roleId,
        permCode,
      })),
    );
  }
}
