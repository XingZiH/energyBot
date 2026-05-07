-- 0003: 新增套餐组自定义文案字段（所有套餐组共享）
ALTER TABLE bot_config ADD COLUMN package_group_text TEXT;
