import './styles.css';

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0f1117');
  tg.setBackgroundColor('#0f1117');
}

const demoUser = tg?.initDataUnsafe?.user;
const userName = demoUser?.first_name || 'Гость';

const rooms = [
  { id: 'main', icon: '💬', name: 'Главный чат', members: 128, description: 'Общение жителей города' },
  { id: 'night', icon: '🌙', name: 'Ночной чат', members: 47, description: 'Для вечернего общения' },
  { id: 'city', icon: '🏙️', name: 'Город', members: 86, description: 'Новости, события и вопросы' },
  { id: 'music', icon: '🎵', name: 'Музыка', members: 32, description: 'Делимся музыкой' }
];

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">ГОРОДСКАЯ ПЛАТФОРМА</div>
        <h1>Привет, ${escapeHtml(userName)} 👋</h1>
      </div>
      <button class="balance" type="button" id="balanceButton" aria-label="Баланс Нуркоинов">
        <span class="coin">N</span>
        <span id="balanceValue">0</span>
      </button>
    </header>

    <section class="hero-card">
      <div>
        <span class="status-dot"></span>
        <span>Сейчас онлайн</span>
        <h2>Общайся. Знакомься. Будь в городе.</h2>
        <p>Чаты, знакомства, события и городские сервисы — в одном месте.</p>
      </div>
    </section>

    <nav class="quick-nav" aria-label="Разделы">
      <button class="quick-item active" data-section="chat">💬<span>Чаты</span></button>
      <button class="quick-item" data-section="dating">❤️<span>Знакомства</span></button>
      <button class="quick-item" data-section="city">🏙️<span>Город</span></button>
      <button class="quick-item" data-section="profile">👤<span>Профиль</span></button>
    </nav>

    <section id="content" class="content"></section>

    <footer class="bottom-note">
      <span>CHAT</span> · первая версия платформы
    </footer>
  </main>
`;

const content = document.querySelector('#content');

function renderChat() {
  content.innerHTML = `
    <div class="section-heading">
      <div><span class="eyebrow">ОБЩЕНИЕ</span><h2>Комнаты</h2></div>
      <button class="ghost-button" id="rulesButton">Правила</button>
    </div>
    <div class="rooms-list">
      ${rooms.map(room => `
        <button class="room-card" data-room="${room.id}">
          <span class="room-icon">${room.icon}</span>
          <span class="room-copy">
            <strong>${room.name}</strong>
            <small>${room.description}</small>
          </span>
          <span class="room-meta">${room.members} <span>›</span></span>
        </button>
      `).join('')}
    </div>
    <div class="feature-grid">
      <button class="feature-card" data-action="gift"><span>🎁</span><strong>Подарки</strong><small>Скоро</small></button>
      <button class="feature-card" data-action="nickname"><span>🎨</span><strong>Цветной ник</strong><small>Скоро</small></button>
      <button class="feature-card" data-action="contest"><span>🏆</span><strong>Конкурсы</strong><small>Скоро</small></button>
    </div>
  `;

  document.querySelectorAll('[data-room]').forEach(button => {
    button.addEventListener('click', () => openRoom(button.dataset.room));
  });
  document.querySelector('#rulesButton').addEventListener('click', showRules);
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => notify('Эта функция будет подключена следующим этапом.'));
  });
}

function openRoom(roomId) {
  const room = rooms.find(item => item.id === roomId);
  content.innerHTML = `
    <div class="chat-header">
      <button class="back-button" id="backButton">‹</button>
      <div><strong>${room.icon} ${room.name}</strong><small>${room.members} участников</small></div>
    </div>
    <div class="messages">
      <div class="system-message">Добро пожаловать в комнату. Соблюдайте правила общения.</div>
      <article class="message"><div class="avatar">А</div><div><b>Алина</b><p>Всем привет 👋</p><time>21:41</time></div></article>
      <article class="message"><div class="avatar">М</div><div><b>Макс</b><p>Как город сегодня?</p><time>21:42</time></div></article>
    </div>
    <form class="composer" id="composer">
      <input id="messageInput" maxlength="500" autocomplete="off" placeholder="Написать сообщение..." />
      <button aria-label="Отправить">➤</button>
    </form>
  `;

  document.querySelector('#backButton').addEventListener('click', renderChat);
  document.querySelector('#composer').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.querySelector('#messageInput');
    const text = input.value.trim();
    if (!text) return;
    notify('Realtime-чат подключим следующим этапом.');
    input.value = '';
  });
}

function renderDating() {
  content.innerHTML = `
    <div class="section-heading"><div><span class="eyebrow">18+</span><h2>Знакомства</h2></div></div>
    <div class="empty-card">
      <div class="empty-icon">❤️</div>
      <h3>Случайные знакомства</h3>
      <p>На следующем этапе здесь появится подбор пользователей, анкеты, лайки и платный вход за Нуркоины.</p>
      <button class="primary-button" id="datingInfo">Подробнее</button>
    </div>
  `;
  document.querySelector('#datingInfo').addEventListener('click', () => notify('Модуль знакомств пока находится в разработке.'));
}

function renderCity() {
  content.innerHTML = `
    <div class="section-heading"><div><span class="eyebrow">ГОРОД</span><h2>Сервисы</h2></div></div>
    <div class="service-list">
      <button class="service-card"><span>🎟️</span><div><strong>Афиша</strong><small>События и билеты</small></div><b>›</b></button>
      <button class="service-card"><span>📋</span><div><strong>Объявления</strong><small>Купить, продать, найти</small></div><b>›</b></button>
      <button class="service-card"><span>🛠️</span><div><strong>Мастера</strong><small>Услуги города</small></div><b>›</b></button>
      <button class="service-card"><span>📚</span><div><strong>Книги</strong><small>Чтение онлайн</small></div><b>›</b></button>
    </div>
    <div class="notice-card"><span>📌</span><div><strong>Закрепить объявление</strong><p>Информер на главном экране на 24 часа — 500 Нуркоинов.</p></div></div>
  `;
}

function renderProfile() {
  const username = demoUser?.username ? `@${demoUser.username}` : 'Telegram-профиль';
  content.innerHTML = `
    <div class="section-heading"><div><span class="eyebrow">АККАУНТ</span><h2>Профиль</h2></div></div>
    <div class="profile-card">
      <div class="profile-avatar">${escapeHtml((userName[0] || 'Г').toUpperCase())}</div>
      <div><h3>${escapeHtml(userName)}</h3><p>${escapeHtml(username)}</p></div>
    </div>
    <div class="wallet-card"><div><span class="eyebrow">БАЛАНС</span><strong><span class="coin">N</span> 0 Нуркоинов</strong></div><button class="primary-button" id="topupButton">Пополнить</button></div>
    <div class="settings-list">
      <button>⚙️ Настройки <span>›</span></button>
      <button>🛡️ Безопасность и блокировки <span>›</span></button>
      <button>📜 История операций <span>›</span></button>
    </div>
  `;
  document.querySelector('#topupButton').addEventListener('click', () => notify('Пополнение через ЮKassa подключим после настройки backend.'));
}

function showRules() {
  const text = 'Уважайте других участников. Запрещены оскорбления, спам, угрозы и контент, нарушающий законодательство. Модераторы могут ограничить доступ к чату.';
  tg?.showPopup?.({ title: 'Правила чата', message: text, buttons: [{ type: 'ok' }] });
  if (!tg?.showPopup) alert(text);
}

function notify(message) {
  tg?.showAlert?.(message);
  if (!tg?.showAlert) console.info(message);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

document.querySelectorAll('.quick-item').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.quick-item').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const section = button.dataset.section;
    ({ chat: renderChat, dating: renderDating, city: renderCity, profile: renderProfile }[section])();
  });
});

document.querySelector('#balanceButton').addEventListener('click', () => {
  notify('Баланс Нуркоинов появится после подключения базы данных.');
});

renderChat();
