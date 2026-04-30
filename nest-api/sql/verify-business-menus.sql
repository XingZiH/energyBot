DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.menu
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
       OR code LIKE 'blank:other-login:%'
  ) THEN
    RAISE EXCEPTION 'template demo menu still exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu WHERE code = 'default:energy-rental'
  ) THEN
    RAISE EXCEPTION 'energy rental menu is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu
    WHERE code = 'default:energy-rental'
      AND menu_name = U&'\673A\5668\4EBA\63A7\5236'
  ) THEN
    RAISE EXCEPTION 'energy rental root menu name must match expected Chinese label';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu WHERE code = 'default:energy-rental:platform-config'
  ) THEN
    RAISE EXCEPTION 'energy rental platform config menu is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu WHERE code = 'default:energy-rental:packages:add'
  ) THEN
    RAISE EXCEPTION 'energy rental package add permission is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.menu WHERE code = 'default:energy-rental:packages:del'
  ) THEN
    RAISE EXCEPTION 'energy rental package delete permission is missing';
  END IF;
END $$;
