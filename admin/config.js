// Подключение к Supabase: Project Settings → API.
// anon public — публичный по задумке ключ, права режет сама база (supabase/schema.sql).
// service_role сюда НЕ класть никогда.
// Если очистить оба поля, админка откроется в демо-режиме (данные только в этом браузере).
window.BAZA_CONFIG = {
  supabaseUrl: 'https://kqavdgamyronvwzdfrma.supabase.co',
  supabaseAnonKey: 'sb_publishable_Gxto8N52Fir5Hw8jYvJcpA_p-Pi0T_Z',
  // Логины без «@» превращаются в почту на этом служебном домене (письма туда не ходят).
  loginDomain: 'musicdream.example',
};
