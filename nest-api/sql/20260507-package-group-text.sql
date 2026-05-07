-- 20260507: 新增套餐组自定义文案字段（所有套餐组共享）
-- 用户点击任意「能量套餐组」按钮后，显示此文案 + 套餐列表（替代硬编码的"请选择套餐："）
ALTER TABLE agent_bot_configs ADD COLUMN package_group_text TEXT;
