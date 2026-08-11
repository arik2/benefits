-- מסד הנתונים הפרטי של מערכת ההטבות.
--
-- להרצה פעם אחת: Supabase → SQL Editor → הדבקה → Run.
--
-- עקרון מנחה: Row Level Security מופעל על כל טבלה, ואין אף מדיניות
-- שמתירה גישה ללקוח האנונימי. המשמעות היא שגם אם המפתח הציבורי של
-- הפרויקט ידלוף, הוא לא פותח שום דלת. כל הגישה עוברת דרך הבוט,
-- שמשתמש במפתח השירות ומאמת בעצמו מי המשתמש.

-- ---------- הטבות ----------

create table if not exists benefits (
  id            text primary key,
  provider      text not null,
  title         text not null,
  merchants     text[] default '{}',
  categories    text[] default '{}',
  kind          text not null,
  value         numeric,
  cap_per_tx    numeric,
  min_spend     numeric default 0,
  requires_card text,
  variants      jsonb default '[]'::jsonb,
  valid_from    date,
  valid_until   date,
  valid_days    int[],
  blackout      jsonb default '[]'::jsonb,
  conditions    text,
  source        text,
  tags          text[] default '{}',
  status        text not null default 'unverified',
  checked_at    date,
  updated_at    timestamptz default now()
);

create index if not exists benefits_provider_idx  on benefits (provider);
create index if not exists benefits_merchants_idx on benefits using gin (merchants);

-- ---------- המצב האישי ----------
-- כאן יושב מה שקודם נאלץ להישאר מחוץ לסנכרון, כי המאגר היה ציבורי.

create table if not exists my_status (
  provider     text primary key,
  points       numeric,
  points_unit  text,
  tier         text,
  quota_left   int,
  quota_total  int,
  balance_ils  numeric,
  evidence     jsonb default '{}'::jsonb,
  source       text,
  captured_at  date,
  updated_at   timestamptz default now()
);

-- ---------- ממסר ה-OTP ----------
-- הסורק כותב שורה כשהוא צריך קוד; הבוט ממלא אותה כשהמשתמש עונה.

create table if not exists otp_requests (
  id         uuid primary key default gen_random_uuid(),
  club       text not null,
  status     text not null default 'pending',  -- pending | answered | expired
  code       text,
  created_at timestamptz default now(),
  answered_at timestamptz
);

create index if not exists otp_pending_idx on otp_requests (status, created_at desc);

-- ---------- עוגיות התחברות ----------
-- שמירתן היא מה שמאפשר לרוב הסריקות לרוץ בלי סיסמה ובלי OTP.

create table if not exists sessions (
  club       text primary key,
  cookies    jsonb not null,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- ---------- זיכרון קצר לכל שיחה ----------
-- כפתור בטלגרם נושא 64 בתים בלבד, ולא ניתן להחזיק בו שאלה בעברית.
-- לכן השאלה האחרונה נשמרת כאן, וכפתור הבחירה מפנה אליה.

create table if not exists chat_state (
  chat_id    text primary key,
  last_query text,
  updated_at timestamptz default now()
);

-- ---------- מי מורשה לדבר עם הבוט ----------

create table if not exists allowed_users (
  chat_id text primary key,
  name    text,
  added_at timestamptz default now()
);

-- ---------- יומן סריקות ----------
-- כדי שאפשר יהיה לראות מה נשבר בלי לחפור בלוגים של GitHub.

create table if not exists scrape_runs (
  id         uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  results    jsonb default '{}'::jsonb,
  ok         boolean
);

-- ---------- נעילה ----------
-- RLS דולק בלי מדיניות מתירה = אין גישה ללקוח אנונימי, לשום טבלה.

alter table benefits      enable row level security;
alter table my_status     enable row level security;
alter table otp_requests  enable row level security;
alter table sessions      enable row level security;
alter table allowed_users enable row level security;
alter table scrape_runs   enable row level security;
alter table chat_state    enable row level security;
