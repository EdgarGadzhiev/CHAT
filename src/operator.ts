// Данные оператора сервиса. ЗАПОЛНИТЕ перед публичным запуском — они подставляются во все юридические документы.
export const OPERATOR = {
  name: 'ИП Демо Оператор', // ДЕМО — замените на реальные данные
  taxId: '000000000000',
  address: 'ЯНАО, г. Новый Уренгой (демо-адрес)',
  email: 'demo@nur-chat.example',
  dataLocation: 'демо: будет указано после переноса БД в РФ',
}

// Пока true — в админке показывается предупреждение, что реквизиты демонстрационные.
export const OPERATOR_IS_DEMO = true

export const OPERATOR_READY = !OPERATOR_IS_DEMO && Object.values(OPERATOR).every((v) => v.trim() !== '')

export const v = (x: string, hint: string) => (x.trim() ? x : `[УКАЖИТЕ: ${hint}]`)
