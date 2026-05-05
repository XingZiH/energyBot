-- B3-T11.3a：补 platform_receive_address 列
--
-- 0001 schema 漏掉了这一列，但 executor.go 仍在订单支付检测、TronGrid transfer
-- 过滤、JustLend 归还退款校验 3 处使用它。不加此列 LoadFromDatabase SQL 会炸。
--
-- 幂等性：SQLite 没有 ADD COLUMN IF NOT EXISTS（3.35+ 才有，运行时版本不可控），
-- 重复执行会报 `duplicate column name`。配套改了 storage.applyMigrations 识别此错
-- 静默吞掉——见 storage.go 的 isDuplicateColumnErr。

ALTER TABLE energy_platform_config
  ADD COLUMN platform_receive_address TEXT;
