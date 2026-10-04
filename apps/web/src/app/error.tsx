'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="page-container"><h1>Не удалось загрузить пространство</h1><p>Сервис временно недоступен или ещё не настроен. Попробуйте снова.</p><button className="button primary" onClick={reset}>Повторить</button></div>;
}
