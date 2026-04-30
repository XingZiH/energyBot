-- Remove template/demo menus from ng-antd-admin.
-- Keep system management and energy rental business menus.

DELETE FROM public.sys_role_perm
WHERE perm_code = ANY (
  ARRAY[
    'default:dashboard',
    'default:about',
    'blank:other-login',
    'blank:empty-page'
  ]
)
   OR perm_code LIKE 'default:dashboard:%'
   OR perm_code LIKE 'default:page-demo%'
   OR perm_code LIKE 'default:feat%'
   OR perm_code LIKE 'default:comp%'
   OR perm_code LIKE 'default:level%'
   OR perm_code LIKE 'blank:other-login:%';

DELETE FROM public.menu
WHERE code = ANY (
  ARRAY[
    'default:dashboard',
    'default:about',
    'blank:other-login',
    'blank:empty-page'
  ]
)
   OR code LIKE 'default:dashboard:%'
   OR code LIKE 'default:page-demo%'
   OR code LIKE 'default:feat%'
   OR code LIKE 'default:comp%'
   OR code LIKE 'default:level%'
   OR code LIKE 'blank:other-login:%';

UPDATE public.menu
SET order_num = 1
WHERE code = 'default:energy-rental';

UPDATE public.menu
SET order_num = 2
WHERE code = 'default:system';
