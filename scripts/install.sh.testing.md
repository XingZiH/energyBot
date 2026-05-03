# install.sh 手工测试步骤

本文件记录 `scripts/install.sh` 的手工测试清单，不引入 bats 依赖；CI 阶段只做 `shellcheck --severity=warning --shell=sh` 和签名对拍两类自动化验证。

## 1. 静态检查（必须 CI 通过）

```sh
# 1.1 零 warning
shellcheck --severity=warning --shell=sh scripts/install.sh

# 1.2 签名与后端 HMAC util 字节级对拍
node - <<'NODE'
import('crypto').then(({ createHmac, createHash }) => {
  const secret = 'testSecretXyz123';
  const ts = '1714694400000';
  const nonce = '0123456789abcdef0123456789abcdef';
  const bodyHash = createHash('sha256').update('').digest('hex');
  const canonical = ['POST','/api/v1/license/precheck',ts,nonce,bodyHash].join('\n');
  console.log(createHmac('sha256', secret).update(canonical).digest('hex'));
});
NODE
# 期望输出：0ba862ab1d294a56d100228cab6ca40bb3807fae192d9c6b0ea84bb42726630e

sh -c '
  canonical="$(printf "%s\n%s\n%s\n%s\n%s" POST /api/v1/license/precheck 1714694400000 \
    0123456789abcdef0123456789abcdef e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)"
  printf "%s" "$canonical" | openssl dgst -sha256 -hmac testSecretXyz123 -hex | awk "{print \$NF}"
'
# 期望输出：与 Node 版本完全一致
```

## 2. 参数/交互层（开发机，无需 root）

| # | 命令 | 预期 |
|---|---|---|
| 2.1 | `scripts/install.sh --version` | 打印 `energybot-install 1.0.0-a`，rc=0 |
| 2.2 | `scripts/install.sh --help` | 打印用法说明，rc=0 |
| 2.3 | `scripts/install.sh --unknown` | 打印 `未知参数：--unknown`，rc=2 |
| 2.4 | `scripts/install.sh`（非 root） | 走到 `check_root` 后报 `必须以 root 运行`，rc=4 |
| 2.5 | `LICENSE_KEY=foo scripts/install.sh`（root） | 走到 `prompt_license` 报 `LICENSE_KEY 必须以 ebt_ 开头`，rc=7 |
| 2.6 | `LICENSE_KEY=ebt_short scripts/install.sh`（root） | 报 `长度不合法`，rc=7 |

## 3. Precheck 联调（需要 nest-api 本地运行）

**前置**：启动 nest-api + pg + redis，创建一个测试客户拿 licenseKey/secret。

```sh
# 3.1 正常 VERIFY_ONLY 流程（不改机器）
sudo LICENSE_KEY=ebt_xxx LICENSE_SECRET=yyy SERVER_URL=http://localhost:9999 \
  scripts/install.sh --verify-only
# 预期：输出 [ OK ] License 有效 — 客户：<name>，banner 提示 VERIFY_ONLY 模式；rc=0

# 3.2 错误 secret 触发 signature_invalid
sudo LICENSE_KEY=ebt_xxx LICENSE_SECRET=wrong SERVER_URL=http://localhost:9999 \
  scripts/install.sh --verify-only
# 预期：[ERR ] 签名校验失败：LICENSE_SECRET 错误或已轮换；rc=9

# 3.3 吊销后的 key
# （先在 UI 上吊销对应 license）
sudo LICENSE_KEY=ebt_revoked LICENSE_SECRET=yyy SERVER_URL=http://localhost:9999 \
  scripts/install.sh --verify-only
# 预期：[ERR ] License 已被吊销；rc=9

# 3.4 客户停用
# （UI 上把 customer 切 suspended）
# 预期：[ERR ] 客户账号已停用；rc=9

# 3.5 未知 key
sudo LICENSE_KEY=ebt_notexist000000000000000 LICENSE_SECRET=y SERVER_URL=http://localhost:9999 \
  scripts/install.sh --verify-only
# 预期：[ERR ] License Key 不存在；rc=9

# 3.6 时钟偏移（机器调快 10min 再试）
# 预期：[ERR ] 时钟偏移超限；rc=9

# 3.7 Nonce 重放（同一 nonce+ts 连发两次——脚本每次都重新生成 nonce，
#     所以需要手动 curl 重放；这里仅作协议说明，不强制测试）
```

## 4. 完整安装流（生产级，需要可丢弃的 Linux VM）

**前置**：干净 Ubuntu 22.04 VM，已通公网，本地 agent 未安装。

```sh
# 4.1 从 HTTPS 拉脚本 + 完整装 Docker + 写 license
curl -fsSL https://www.feiyijt.com/install.sh \
  | LICENSE_KEY=ebt_xxx LICENSE_SECRET=yyy sh

# 验证：
ls -la /etc/energybot/license.conf      # 权限 600，owner root
cat /etc/energybot/license.conf          # LICENSE_KEY/SECRET/SERVER_URL/CUSTOMER_NAME/INSTALLED_AT
docker --version                          # Docker CE 已装
cat /var/log/energybot-install.log       # 有完整执行记录

# 4.2 幂等：再跑一遍不该报错
curl -fsSL https://www.feiyijt.com/install.sh \
  | LICENSE_KEY=ebt_xxx LICENSE_SECRET=yyy sh
# 预期：[INFO] License 文件已存在且 key 一致——视为幂等成功；rc=0

# 4.3 Key 冲突
curl -fsSL https://www.feiyijt.com/install.sh \
  | LICENSE_KEY=ebt_different LICENSE_SECRET=zzz sh
# 预期：报 key 不一致，建议 --reinstall；rc=11

# 4.4 强制换绑
curl -fsSL https://www.feiyijt.com/install.sh \
  | LICENSE_KEY=ebt_different LICENSE_SECRET=zzz sh -s -- --reinstall
# 预期：覆盖写入新 key；rc=0

# 4.5 卸载
curl -fsSL https://www.feiyijt.com/install.sh | sh -s -- --uninstall
# 预期：/etc/energybot 被清理；Docker 保留；rc=0
```

## 5. 跨平台兼容抽样

| 发行版 | 关键点 | 预期 |
|---|---|---|
| Ubuntu 24.04 LTS | systemd + apt | 正常 |
| Debian 12 | systemd + apt | 正常 |
| CentOS Stream 9 | systemd + dnf | 正常 |
| Rocky 9 / Alma 9 | systemd + dnf | 正常 |
| 阿里 Linux 3 | systemd + yum | 正常 |
| Alpine 3.19（仅 verify-only） | busybox sh + openrc | prompt_license / HMAC 能跑；Docker 安装跳过（get.docker.com 不支持 alpine） |

## 6. 回归检查点

每次改 `install.sh` 后必做：

- [ ] `shellcheck --severity=warning --shell=sh scripts/install.sh` 零输出
- [ ] 签名对拍脚本（§1.2）输出一致
- [ ] `scripts/install.sh --version` / `--help` 不 crash
- [ ] 本地 nest-api 起一次 + UI 颁发一张 license + VERIFY_ONLY 跑通（§3.1）
